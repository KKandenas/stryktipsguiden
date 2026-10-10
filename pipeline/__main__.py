"""Kommandorad för pipelinen.

    python -m pipeline auto                 # det som schemat kör: allt som är aktuellt just nu
    python -m pipeline svenskaspel          # kupong + streck + Svenska Spels odds + Tio tidningars tips
    python -m pipeline odds                 # The Odds API för öppna omgångar
    python -m pipeline resultat             # resultat och utdelning för avslutade omgångar
    python -m pipeline backfill 4900 4973   # hämta historiska omgångar
    python -m pipeline migrera

Varje steg loggar tydligt och fortsätter med nästa om något går fel.
Avslutningskoden är 1 om ett kritiskt steg (Svenska Spel eller resultat) misslyckades.
"""
from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import datetime, timedelta, timezone

from . import config, db, lagring
from .http import HamtningsFel
from .modeller import Match, ValideringsFel
from .sources import oddsapi, svenskaspel
from .tid import nu_utc, till_utc

log = logging.getLogger("pipeline")


def _utc_om(timmar: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=timmar)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _spara_draw(conn, draw: dict) -> None:
    nu = nu_utc()
    # För en stängd omgång gäller Svenska Spels "aktuella" odds vid spelstopp, inte nu.
    spelstopp = till_utc(draw["regCloseTime"]) if draw.get("regCloseTime") else nu
    kupong = svenskaspel.tolka_kupong(draw, hamtad=min(nu, spelstopp))
    nya = lagring.spara_kupong(conn, kupong)
    log.info("Omgång %s (%s, spelstopp %s): nya matcher %d, streck %d, odds %d, tips %d",
             kupong.omgang_id, kupong.status, kupong.spelstopp,
             nya["matcher"], nya["streck"], nya["odds"], nya["tips"])


def steg_svenskaspel(conn) -> bool:
    ok = True
    try:
        oppna = svenskaspel.hamta_oppna_omgangar()
    except HamtningsFel as e:
        log.error("Svenska Spel: kunde inte hämta öppna omgångar: %s", e)
        return False
    if not oppna:
        log.info("Svenska Spel: ingen öppen omgång just nu")
    sedda = set()
    for draw in oppna:
        try:
            _spara_draw(conn, draw)
            sedda.add(int(draw["drawNumber"]))
        except (ValideringsFel, KeyError, ValueError) as e:
            log.error("Svenska Spel: trasig kupong, sparar inget: %s", e)
            ok = False

    # Nyligen stängda omgångar: hämta igen för att få slutstrecken (om lördagskörningen var sen).
    nyss = [r[0] for r in conn.execute(
        "SELECT id FROM omgangar WHERE spelstopp BETWEEN ? AND ? AND utdelning_13 IS NULL AND installd = 0",
        (_utc_om(-48), nu_utc()))]
    for omgang_id in nyss:
        if omgang_id in sedda:
            continue
        try:
            _spara_draw(conn, svenskaspel.hamta_omgang(omgang_id))
        except (HamtningsFel, ValideringsFel, KeyError, ValueError) as e:
            log.warning("Svenska Spel: kunde inte uppdatera stängd omgång %s: %s", omgang_id, e)
    return ok


def steg_odds(conn) -> bool:
    if not config.ODDS_API_KEY:
        log.info("The Odds API: ODDS_API_KEY saknas – hoppar över (valfri källa)")
        return True
    oppna = [r[0] for r in conn.execute("SELECT id FROM omgangar WHERE spelstopp > ?", (nu_utc(),))]
    if not oppna:
        log.info("The Odds API: ingen öppen omgång i databasen")
    for omgang_id in oppna:
        matcher = [Match(r["matchnr"], r["hemmalag"], r["bortalag"], r["liga"], r["land"], r["avspark"])
                   for r in conn.execute("SELECT * FROM matcher WHERE omgang_id = ? ORDER BY matchnr",
                                         (omgang_id,))]
        try:
            odds, varningar = oddsapi.hamta_odds(matcher)
        except Exception as e:  # en valfri källa får aldrig stoppa pipelinen
            log.error("The Odds API: oväntat fel: %s", e)
            continue
        for v in varningar:
            log.warning("The Odds API: %s", v)
        nya = lagring.spara_odds(conn, omgang_id, odds)
        tackta = len({o.matchnr for o in odds})
        log.info("The Odds API: omgång %s – odds för %d/13 matcher, %d nya rader", omgang_id, tackta, nya)
    return True


def steg_resultat(conn) -> bool:
    ok = True
    vantande = lagring.omgangar_utan_resultat(conn, nu_utc())
    if not vantande:
        log.info("Resultat: inga omgångar väntar på resultat")
    for omgang_id in vantande:
        try:
            data = svenskaspel.hamta_resultat(omgang_id)
            if data is None:
                log.info("Resultat: omgång %s är inte avgjord ännu", omgang_id)
                continue
            r = svenskaspel.tolka_resultat(data)
            lagring.spara_resultat(conn, r)
            if r.installd:
                log.warning("Resultat: omgång %s är inställd av Svenska Spel", omgang_id)
                continue
            log.info("Resultat: omgång %s sparad, rad %s, 13 rätt ger %.0f kr", omgang_id,
                     "".join(m.resultat for m in r.matcher), r.utdelning[13])
        except (HamtningsFel, ValideringsFel, ValueError) as e:
            log.error("Resultat: omgång %s: %s", omgang_id, e)
            ok = False
    return ok


def backfill(conn, fran: int, till: int, paus: float = 1.0) -> bool:
    ok = True
    for n in range(fran, till + 1):
        try:
            draw = svenskaspel.hamta_omgang(n)
            _spara_draw(conn, draw)
            if draw.get("drawState") == "Finalized":
                data = svenskaspel.hamta_resultat(n)
                if data:
                    lagring.spara_resultat(conn, svenskaspel.tolka_resultat(data))
        except (HamtningsFel, ValideringsFel, KeyError, ValueError) as e:
            log.error("Backfill: omgång %s hoppas över: %s", n, e)
            ok = False
        time.sleep(paus)  # var snäll mot Svenska Spels servrar
    return ok


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="python -m pipeline", description="Stryktipshjälpens datapipeline")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="kommando", required=True)
    for namn in ("auto", "svenskaspel", "odds", "resultat", "migrera"):
        sub.add_parser(namn)
    b = sub.add_parser("backfill")
    b.add_argument("fran", type=int)
    b.add_argument("till", type=int)
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    conn = db.anslut()
    nya = db.migrera(conn)
    if nya:
        log.info("Migreringar körda: %s", nya)

    kritiskt_ok = True
    if args.kommando == "auto":
        kritiskt_ok &= steg_svenskaspel(conn)
        steg_odds(conn)
        kritiskt_ok &= steg_resultat(conn)
    elif args.kommando == "svenskaspel":
        kritiskt_ok = steg_svenskaspel(conn)
    elif args.kommando == "odds":
        steg_odds(conn)
    elif args.kommando == "resultat":
        kritiskt_ok = steg_resultat(conn)
    elif args.kommando == "backfill":
        kritiskt_ok = backfill(conn, args.fran, args.till)

    conn.close()
    if not kritiskt_ok:
        log.error("Klar, men minst ett kritiskt steg misslyckades (se ovan)")
        return 1
    log.info("Klar")
    return 0


if __name__ == "__main__":
    sys.exit(main())
