"""Svenska Spel: kupong, streck, Svenska Spels egna odds, Tio tidningars tips, resultat och utdelning.

Använder de inofficiella endpoints som spela.svenskaspel.se själv anropar (se DATAKALLOR.md).
Tolkningsfunktionerna (tolka_*) är rena och testas mot sparade svar i tests/fixtures.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from .. import config
from ..http import HamtningsFel, hamta_json
from ..modeller import (Kupong, Match, MatchResultat, Odds, Resultat, Streck, Tips,
                        ValideringsFel)
from ..tid import svenskt_datum, till_utc

log = logging.getLogger(__name__)

KALLA_TTT = "Tio tidningars tips"
BOLAG_SVS = "svenskaspel"              # aktuella odds på kupongen
BOLAG_SVS_START = "svenskaspel_start"  # odds när kupongen öppnade

_UTFALL = {"1": "1", "X": "X", "x": "X", "2": "2"}


# ---------- hjälpfunktioner ----------

def _tal(v) -> Optional[float]:
    """'1,70' / '59266,00' / '65' / 5 -> float. None/'' -> None."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    return float(str(v).replace(" ", "").replace(" ", "").replace(",", "."))


def _kontrollera_streck(nr: int, p1, px, p2) -> None:
    for p in (p1, px, p2):
        if p is None or not 0 <= p <= 100:
            raise ValideringsFel(f"match {nr}: ogiltig streckprocent {p1}/{px}/{p2}")
    if not 97 <= p1 + px + p2 <= 103:  # Svenska Spel avrundar till heltal
        raise ValideringsFel(f"match {nr}: strecken summerar till {p1 + px + p2}")


def _odds_fran(nr: int, d: Optional[dict], bolag: str, tidpunkt: str) -> Optional[Odds]:
    if not d:
        return None
    o1, ox, o2 = _tal(d.get("one")), _tal(d.get("x")), _tal(d.get("two"))
    if None in (o1, ox, o2):
        return None
    if min(o1, ox, o2) <= 1.0:
        raise ValideringsFel(f"match {nr}: ogiltiga odds {o1}/{ox}/{o2} ({bolag})")
    return Odds(nr, tidpunkt, bolag, o1, ox, o2)


# ---------- tolkning ----------

def tolka_kupong(draw: dict, hamtad: str) -> Kupong:
    """Tolka ett 'draw'-objekt. `hamtad` (UTC) används som tidpunkt för odds utan egen tidsstämpel.

    Kastar ValideringsFel om själva kupongen är trasig. Enskilda trasiga streck/odds/tips loggas
    och hoppas över – de sparas aldrig.
    """
    try:
        omgang_id = int(draw["drawNumber"])
        spelstopp_raw = draw["regCloseTime"]
        events = draw["drawEvents"]
    except (KeyError, TypeError, ValueError) as e:
        raise ValideringsFel(f"kupongen saknar grundfält: {e}") from e
    if len(events) != 13:
        raise ValideringsFel(f"omgång {omgang_id}: {len(events)} matcher, väntade 13")

    matcher: List[Match] = []
    streck: List[Streck] = []
    odds: List[Odds] = []
    tips: List[Tips] = []
    starttid = till_utc(draw["regOpenTime"]) if draw.get("regOpenTime") else hamtad

    for ev in sorted(events, key=lambda e: e.get("eventNumber", 0)):
        nr = ev.get("eventNumber")
        m = ev.get("match") or {}
        deltagare = {p.get("type"): p for p in m.get("participants") or []}
        hemma, borta = deltagare.get("home", {}).get("name"), deltagare.get("away", {}).get("name")
        if not isinstance(nr, int) or not 1 <= nr <= 13 or not hemma or not borta:
            raise ValideringsFel(f"omgång {omgang_id}: match {nr} saknar nummer eller lag")
        liga = m.get("league") or {}
        matcher.append(Match(
            matchnr=nr, hemmalag=hemma, bortalag=borta,
            liga=liga.get("name"), land=(liga.get("country") or {}).get("name"),
            avspark=till_utc(m["matchStart"]) if m.get("matchStart") else None,
            svs_match_id=m.get("matchId"), installd=bool(ev.get("cancelled")),
        ))

        try:
            sf = ev.get("svenskaFolket")
            if sf and sf.get("date"):
                p1, px, p2 = _tal(sf.get("one")), _tal(sf.get("x")), _tal(sf.get("two"))
                _kontrollera_streck(nr, p1, px, p2)
                streck.append(Streck(nr, till_utc(sf["date"]), p1, px, p2))
        except (ValideringsFel, ValueError) as e:
            log.warning("Omgång %s: hoppar över streck – %s", omgang_id, e)

        for d, bolag, tid in ((ev.get("odds"), BOLAG_SVS, hamtad),
                              (ev.get("startOdds"), BOLAG_SVS_START, starttid)):
            try:
                o = _odds_fran(nr, d, bolag, tid)
                if o:
                    odds.append(o)
            except (ValideringsFel, ValueError) as e:
                log.warning("Omgång %s: hoppar över odds – %s", omgang_id, e)

        ttt = ev.get("tioTidningarsTips")
        if ttt:
            antal = {"1": _tal(ttt.get("one")) or 0, "X": _tal(ttt.get("x")) or 0,
                     "2": _tal(ttt.get("two")) or 0}
            total = sum(antal.values())
            if total > 0:
                mest = max(antal.values())
                tecken = "".join(t for t in ("1", "X", "2") if antal[t] == mest)
                tips.append(Tips(nr, KALLA_TTT, hamtad, tecken,
                                 antal["1"] / total, antal["X"] / total, antal["2"] / total,
                                 f"{int(antal['1'])}-{int(antal['X'])}-{int(antal['2'])} av {int(total)} tidningar"))

    if len({m.matchnr for m in matcher}) != 13:
        raise ValideringsFel(f"omgång {omgang_id}: dubbla matchnummer")

    return Kupong(
        omgang_id=omgang_id,
        spelstopp=till_utc(spelstopp_raw),
        datum=svenskt_datum(spelstopp_raw),
        status=draw.get("drawState", ""),
        omsattning=_tal(draw.get("currentNetSale")),
        matcher=matcher, streck=streck, odds=odds, tips=tips,
    )


def tolka_resultat(result: dict) -> Resultat:
    try:
        omgang_id = int(result["drawNumber"])
        events = result["events"]
        fordelning = result["distribution"]
    except (KeyError, TypeError, ValueError) as e:
        raise ValideringsFel(f"resultatet saknar grundfält: {e}") from e
    if result.get("cancelled") is True:
        return Resultat(omgang_id, [], {}, {}, installd=True)
    if len(events) != 13:
        raise ValideringsFel(f"omgång {omgang_id}: {len(events)} resultat, väntade 13")

    matcher = []
    for ev in events:
        nr = ev.get("eventNumber")
        utfall = _UTFALL.get(str(ev.get("outcome", "")).strip())
        if not isinstance(nr, int) or not 1 <= nr <= 13 or utfall is None:
            raise ValideringsFel(f"omgång {omgang_id}: match {nr} har ogiltigt utfall {ev.get('outcome')!r}")
        score = ev.get("outcomeScore") or {}
        matcher.append(MatchResultat(nr, utfall, score.get("home"), score.get("away"),
                                     bool(ev.get("cancelled"))))

    utdelning, vinnare = {}, {}
    for f in fordelning:
        namn = str(f.get("name", ""))
        try:
            ratt = int(namn.split()[0])
        except (ValueError, IndexError):
            continue
        if ratt in (10, 11, 12, 13):
            utdelning[ratt] = _tal(f.get("amount"))
            vinnare[ratt] = int(f.get("winners") or 0)
    if set(utdelning) != {10, 11, 12, 13} or any(v is None for v in utdelning.values()):
        raise ValideringsFel(f"omgång {omgang_id}: ofullständig utdelning {utdelning}")

    return Resultat(omgang_id, sorted(matcher, key=lambda m: m.matchnr), utdelning, vinnare)


# ---------- hämtning ----------

def hamta_oppna_omgangar() -> List[dict]:
    """Omgångar som är öppna för spel just nu (tom lista mellan lördag 16 och måndag morgon)."""
    data, _ = hamta_json(f"{config.SVS_BASE}/draws")
    if not isinstance(data, dict) or "draws" not in data:
        raise HamtningsFel("Oväntat svar från /draws")
    return data["draws"] or []


def hamta_omgang(omgang_id: int) -> dict:
    data, _ = hamta_json(f"{config.SVS_BASE}/draws/{omgang_id}")
    if not isinstance(data, dict) or not data.get("draw"):
        raise HamtningsFel(f"Omgång {omgang_id} saknas i svaret")
    return data["draw"]


def hamta_resultat(omgang_id: int) -> Optional[dict]:
    """Resultatobjektet, eller None om omgången inte är avgjord ännu (404)."""
    data, _ = hamta_json(f"{config.SVS_BASE}/draws/{omgang_id}/result", tillat_404=True)
    if data is None:
        return None
    if not isinstance(data, dict) or not data.get("result"):
        raise HamtningsFel(f"Oväntat resultatsvar för omgång {omgang_id}")
    return data["result"]
