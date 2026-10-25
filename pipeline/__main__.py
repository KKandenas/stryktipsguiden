"""Kommandorad för pipelinen.

    python -m pipeline planerad             # det som schemat startar: kör auto bara om en planerad tid passerats
    python -m pipeline auto                 # allt som är aktuellt just nu
    python -m pipeline svenskaspel          # kupong + streck + Svenska Spels odds + Tio tidningars tips
    python -m pipeline odds                 # The Odds API för öppna omgångar
    python -m pipeline resultat             # resultat och utdelning för avslutade omgångar
    python -m pipeline backfill 4900 4973   # hämta historiska omgångar
    python -m pipeline tips                 # tipssajter → AI → tabellen tips (kräver GEMINI_API_KEY)
    python -m pipeline prognos [--alla]     # räkna sannolikheter (odds-v2 och odds-v1, och ensemble-v1 om vikter finns)
    python -m pipeline statistik            # källstatistik, träning, backtest och modellval
    python -m pipeline kommentarer          # AI-kommentarer per match (kräver GEMINI_API_KEY)
    python -m pipeline tabeller             # ligatabeller med form + export (ingen AI, inga oddskrediter)
    python -m pipeline lagkoll              # Lagkoll: tabeller + AI-analys av lagen nu, oavsett tid till spelstopp
    python -m pipeline export [--omgang N] [--till fil] [--dolj-resultat]
    python -m pipeline migrera

Varje steg loggar tydligt och fortsätter med nästa om något går fel.
Avslutningskoden är 1 om ett kritiskt steg (Svenska Spel, resultat eller export) misslyckades.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import config, db, expertarkiv, export, lagkoll, lagring, schema, sidomatcher, tipsinsamling
from .ai import klient as ai_klient
from .ai import kommentarer as ai_kommentarer
from .http import HamtningsFel
from .model import statistik
from .model.modeller import (MODELLER, EnsembleModell, aktiv_modell, berakna_prognoser, framatmodeller,
                             ladda_modell)
from .modeller import Match, ValideringsFel
from .sources import oddsapi, svenskaspel
from .tid import nu_utc, parse_iso, till_utc

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


MIN_ODDSKREDITER = 30   # färre kvar än så: spara resten till månadsskiftet


def _installning(conn, nyckel):
    r = conn.execute("SELECT varde, uppdaterad FROM installningar WHERE nyckel = ?", (nyckel,)).fetchone()
    return (r[0], r[1]) if r else (None, None)


def _satt_installning(conn, nyckel, varde):
    with conn:
        conn.execute("""INSERT INTO installningar (nyckel, varde, uppdaterad) VALUES (?, ?, ?)
                        ON CONFLICT(nyckel) DO UPDATE SET varde = excluded.varde, uppdaterad = excluded.uppdaterad""",
                     (nyckel, str(varde), nu_utc()))


def spara_ai_status(conn) -> None:
    """Hur AI-anropen gick i den här körningen (för driftstatusen i appen). Sparas bara om AI användes."""
    k = ai_klient.KORNING
    ok, orsak = ai_klient.tillganglig()
    if not ok:
        _satt_installning(conn, "ai_status", json.dumps({"konfigurerad": False, "orsak": orsak}, ensure_ascii=False))
    elif k["lyckade"] or k["misslyckade"] or k["stoppad"]:
        _satt_installning(conn, "ai_status", json.dumps({"konfigurerad": True, **k}, ensure_ascii=False))


def steg_odds(conn) -> bool:
    if not config.ODDS_API_KEY:
        log.info("The Odds API: ODDS_API_KEY saknas – hoppar över (valfri källa)")
        return True
    kvar, nar = _installning(conn, "oddsapi_krediter_kvar")
    if kvar is not None and int(kvar) < MIN_ODDSKREDITER and nar and nar[:7] == nu_utc()[:7]:
        log.warning("The Odds API: bara %s krediter kvar den här månaden – hoppar över till månadsskiftet", kvar)
        return True
    oppna = [r[0] for r in conn.execute("SELECT id FROM omgangar WHERE spelstopp > ?", (nu_utc(),))]
    if not oppna:
        log.info("The Odds API: ingen öppen omgång i databasen")
    for omgang_id in oppna:
        matcher = [Match(r["matchnr"], r["hemmalag"], r["bortalag"], r["liga"], r["land"], r["avspark"])
                   for r in conn.execute("SELECT * FROM matcher WHERE omgang_id = ? ORDER BY matchnr",
                                         (omgang_id,))]
        krediter: dict = {}
        try:
            odds, varningar = oddsapi.hamta_odds(matcher, krediter)
        except Exception as e:  # en valfri källa får aldrig stoppa pipelinen
            log.error("The Odds API: oväntat fel: %s", e)
            continue
        if "kvar" in krediter:
            _satt_installning(conn, "oddsapi_krediter_kvar", krediter["kvar"])
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


def steg_prognos(conn, alla: bool = False) -> bool:
    try:
        # odds-v1 räknas vidare som jämförelse mot basmodellen odds-v2.
        v1 = MODELLER["odds-v1"]
        if alla:
            berakna_prognoser(conn, v1)
        else:
            berakna_prognoser(conn, v1, [r[0] for r in conn.execute(
                "SELECT id FROM omgangar WHERE spelstopp > ?", (_utc_om(-7 * 24),))])
    except Exception as e:
        log.exception("Prognos (odds-v1): misslyckades: %s", e)
    modell = aktiv_modell()
    try:
        if alla:
            sparade, utan = berakna_prognoser(conn, modell)
        else:
            # Senaste veckans omgångar räknas alltid om (nya odds); äldre bara om de saknar prognos.
            aktuella = [r[0] for r in conn.execute("SELECT id FROM omgangar WHERE spelstopp > ?", (_utc_om(-7 * 24),))]
            sparade, utan = berakna_prognoser(conn, modell, aktuella)
            s2, u2 = berakna_prognoser(conn, modell, bara_saknade=True)
            sparade, utan = sparade + s2, u2
        log.info("Prognos (%s): %d nya/ändrade, %d matcher saknar underlag", modell.version, sparade, utan)
        # ensemble-v1 och tips-v1 för öppna och nyss stängda omgångar (historiken räknas walk-forward
        # i statistiksteget)
        aktuella = [r[0] for r in conn.execute(
            "SELECT id FROM omgangar WHERE spelstopp > ? AND utdelning_13 IS NULL", (_utc_om(-7 * 24),))]
        for version in (EnsembleModell.version, "tips-v1"):
            m = ladda_modell(conn, version)
            if m.vikter is not None:
                s, u = berakna_prognoser(conn, m, aktuella)
                log.info("Prognos (%s): %d nya/ändrade, %d matcher saknar underlag", m.version, s, u)
        # Framåtmodeller (skuggmodeller som inte kan räknas om i efterhand): bara öppna omgångar,
        # så att det som sparas är den sista prognosen före spelstopp.
        oppna = [r[0] for r in conn.execute("SELECT id FROM omgangar WHERE spelstopp > ?", (nu_utc(),))]
        for version in framatmodeller():
            s, u = berakna_prognoser(conn, ladda_modell(conn, version), oppna)
            log.info("Prognos (%s, skugga): %d nya/ändrade, %d matcher saknar underlag", version, s, u)
        return True
    except Exception as e:
        log.exception("Prognos: misslyckades: %s", e)
        return False


def _ai_redo(steg: str) -> bool:
    ok, orsak = ai_klient.tillganglig()
    if not ok:
        log.info("%s: hoppar över – %s", steg, orsak)
    return ok


def steg_tips(conn) -> bool:
    if not _ai_redo("Tips"):
        return True
    try:
        with ai_klient.steg("Tips"):
            stat = tipsinsamling.samla(conn, ai_klient.anropa_json)
        log.info("Tips: %(artiklar)d artiklar, %(tolkade)d tolkade av AI, %(tips)d nya/ändrade tips, %(fel)d fel", stat)
    except Exception as e:  # valfri källa – får aldrig stoppa pipelinen
        log.exception("Tips: oväntat fel: %s", e)
    return True


def steg_sidomatcher(conn) -> bool:
    """Tips och resultat för matcher utanför kupongen (utan AI och oddskrediter), för tipsarnas vikter."""
    try:
        r = sidomatcher.uppdatera(conn)
        log.info("Sidomatcher: nya artiklar %s, nya resultat %d", r["artiklar"] or "inga", r["resultat"])
    except Exception as e:  # valfri källa – får aldrig stoppa pipelinen
        log.exception("Sidomatcher: oväntat fel: %s", e)
    return True


def steg_expertarkiv(conn, max_sidor: int = 1) -> bool:
    """Experternas kommentar per match ur Tipsmedoss arkiv (utan AI). Vanliga körningar läser bara första
    arkivsidan; kommandot expertarkiv läser hela arkivet sedan december 2020."""
    try:
        r = expertarkiv.uppdatera(conn, max_sidor=max_sidor)
        log.info("Expertarkiv: %(artiklar)d nya artiklar, %(matcher)d matcher, %(utan_omgang)d utan omgång", r)
    except Exception as e:  # valfri källa – får aldrig stoppa pipelinen
        log.exception("Expertarkiv: oväntat fel: %s", e)
    return True


def steg_kommentarer(conn) -> bool:
    if not _ai_redo("Kommentarer"):
        return True
    for (omgang_id,) in conn.execute("SELECT id FROM omgangar WHERE spelstopp > ? AND installd = 0", (nu_utc(),)).fetchall():
        try:
            with ai_klient.steg("Kommentarer"):
                n = ai_kommentarer.uppdatera(conn, ai_klient.anropa_json, export.bygg_kupong(conn, omgang_id))
            log.info("Kommentarer: omgång %s – %d nya/ändrade", omgang_id, n)
        except Exception as e:
            log.error("Kommentarer: omgång %s: %s", omgang_id, e)
    return True


def steg_tabeller(conn) -> bool:
    """Ligatabeller med form för öppna omgångar (matchdetaljen visar dem hela veckan)."""
    try:
        for (omgang_id,) in conn.execute("SELECT id FROM omgangar WHERE spelstopp > ? AND installd = 0",
                                         (nu_utc(),)).fetchall():
            lagkoll.uppdatera_tabeller(conn, omgang_id)
    except Exception as e:  # valfri källa – får aldrig stoppa pipelinen
        log.exception("Tabeller: oväntat fel: %s", e)
    return True


def steg_lagkoll(conn, tvinga: bool = False) -> bool:
    """Skuggmodellen Lagkoll: analys när spelstoppet är nära, sedan prognoser för lagkoll-v1."""
    if not _ai_redo("Lagkoll"):
        return True
    try:
        with ai_klient.steg("Lagkoll"):
            stat = lagkoll.analysera(conn, ai_klient.anropa_json, tvinga=tvinga)
        log.info("Lagkoll: %(analyserade)d analyserade, %(oforandrade)d oförändrade, "
                 "%(utan_underlag)d utan underlag, %(fel)d fel", stat)
        oppna = [r[0] for r in conn.execute("SELECT id FROM omgangar WHERE spelstopp > ?", (nu_utc(),))]
        s, _ = berakna_prognoser(conn, ladda_modell(conn, "lagkoll-v1"), oppna)
        if s:
            log.info("Prognos (lagkoll-v1, skugga): %d nya/ändrade", s)
    except Exception as e:  # skuggmodell – får aldrig stoppa pipelinen
        log.exception("Lagkoll: oväntat fel: %s", e)
    return True


def kor_auto(conn) -> bool:
    """Allt som är aktuellt just nu. Returnerar False om ett kritiskt steg misslyckades."""
    ok = steg_svenskaspel(conn)
    steg_odds(conn)
    ok &= steg_resultat(conn)
    steg_tips(conn)
    steg_sidomatcher(conn)
    steg_expertarkiv(conn)
    steg_prognos(conn)
    steg_statistik(conn)
    steg_kommentarer(conn)
    steg_tabeller(conn)
    steg_lagkoll(conn)
    spara_ai_status(conn)
    ok &= steg_export(conn)
    return ok


def steg_statistik(conn, tvinga: bool = False) -> bool:
    if not tvinga and not statistik.behover_koras(conn):
        log.info("Statistik: inga nya resultat sedan senaste körningen")
        return True
    try:
        r = statistik.kor(conn)
        log.info("Statistik: %d avgjorda matcher, %d ensemble-prognoser nya/ändrade, aktiv modell %s",
                 r["matcher"], r["ensemble_prognoser"], r["aktiv"])
        for v, m in r["modeller"].items():
            log.info("Statistik: %s – Brier %.4f, log loss %.4f", v, m["brier"], m["logloss"])
        if r["vikter"]:
            log.info("Statistik: vikter ensemble-v1 %s", {k: round(v, 3) for k, v in r["vikter"]["w"].items()})
        if r["tipsvikter"]:
            log.info("Statistik: vikter tips-v1 %s", {k: round(v, 3) for k, v in r["tipsvikter"]["w"].items()})
        return True
    except Exception as e:
        log.exception("Statistik: misslyckades: %s", e)
        return False


def steg_export(conn, omgang_id=None, till=None, dolj_resultat=False) -> bool:
    try:
        export.exportera(conn, omgang_id, Path(till) if till else None, dolj_resultat)
        return True
    except Exception as e:
        log.exception("Export: misslyckades, kupong.json lämnas orörd: %s", e)
        return False


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
    p = argparse.ArgumentParser(prog="python -m pipeline", description="Stryktipsguidens datapipeline")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="kommando", required=True)
    for namn in ("auto", "planerad", "svenskaspel", "odds", "resultat", "tips", "sidomatcher", "expertarkiv",
                 "kommentarer", "lagkoll", "tabeller", "statistik",
                 "migrera"):
        sub.add_parser(namn)
    b = sub.add_parser("backfill")
    b.add_argument("fran", type=int)
    b.add_argument("till", type=int)
    pr = sub.add_parser("prognos")
    pr.add_argument("--alla", action="store_true", help="räkna om alla matcher, inte bara aktuella")
    ex = sub.add_parser("export")
    ex.add_argument("--omgang", type=int)
    ex.add_argument("--till", help="filväg (standard docs/kupong.json)")
    ex.add_argument("--dolj-resultat", action="store_true", help="visa omgången som om den vore öppen")
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
        kritiskt_ok = kor_auto(conn)
    elif args.kommando == "planerad":
        nu = datetime.now(timezone.utc)
        fran = (nu - timedelta(days=8)).strftime("%Y-%m-%dT%H:%M:%SZ")
        rader = conn.execute(
            """SELECT o.spelstopp, MAX(m.avspark) FROM omgangar o LEFT JOIN matcher m ON m.omgang_id = o.id
               WHERE o.spelstopp > ? GROUP BY o.id""", (fran,)).fetchall()
        spelstopp = [parse_iso(r[0]) for r in rader]
        sista = [parse_iso(r[1]) for r in rader if r[1]]
        tid = schema.forfallen(_installning(conn, "senaste_planerade")[0], nu, spelstopp, sista)
        if tid is None:
            log.info("Planerad: inget att göra – den senaste planerade uppdateringen är redan körd")
        else:
            log.info("Planerad: kör uppdateringen för %s (svensk tid)",
                     tid.astimezone(schema.SVENSK_TID).strftime("%a %d %b %H:%M"))
            kritiskt_ok = kor_auto(conn)
            # Markeras som körd även om något steg misslyckades, så att nästa start inte tar samma kvot igen
            _satt_installning(conn, "senaste_planerade", tid.strftime("%Y-%m-%dT%H:%M:%SZ"))
    elif args.kommando == "svenskaspel":
        kritiskt_ok = steg_svenskaspel(conn)
    elif args.kommando == "odds":
        steg_odds(conn)
    elif args.kommando == "resultat":
        # Resultat, statistik och export: appen visar rättningen direkt, utan AI och oddskrediter
        kritiskt_ok = steg_resultat(conn)
        steg_statistik(conn)
        kritiskt_ok &= steg_export(conn)
    elif args.kommando == "backfill":
        kritiskt_ok = backfill(conn, args.fran, args.till)
    elif args.kommando == "tips":
        steg_tips(conn)
    elif args.kommando == "sidomatcher":
        steg_sidomatcher(conn)
        kritiskt_ok = steg_statistik(conn, tvinga=True) and steg_export(conn)
    elif args.kommando == "expertarkiv":
        steg_expertarkiv(conn, max_sidor=expertarkiv.MAX_SIDOR)
    elif args.kommando == "kommentarer":
        steg_kommentarer(conn)
    elif args.kommando == "tabeller":
        steg_tabeller(conn)
        kritiskt_ok = steg_export(conn)
    elif args.kommando == "lagkoll":
        steg_lagkoll(conn, tvinga=True)
    elif args.kommando == "statistik":
        kritiskt_ok = steg_statistik(conn, tvinga=True)
    elif args.kommando == "prognos":
        kritiskt_ok = steg_prognos(conn, args.alla)
    elif args.kommando == "export":
        kritiskt_ok = steg_export(conn, args.omgang, args.till, args.dolj_resultat)

    if args.kommando in ("tips", "kommentarer", "lagkoll"):
        spara_ai_status(conn)      # driftstatusen visar senaste AI-försöket även vid separata körningar
    conn.close()
    if not kritiskt_ok:
        log.error("Klar, men minst ett kritiskt steg misslyckades (se ovan)")
        return 1
    log.info("Klar")
    return 0


if __name__ == "__main__":
    sys.exit(main())
