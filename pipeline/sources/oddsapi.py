"""The Odds API (https://the-odds-api.com). Valfri – utan ODDS_API_KEY hoppas källan över.

Ett anrop per liga och körning kostar 1 kredit per region (eu,uk = 2). Gratisnivån ger 500/månad.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .. import config
from ..http import HamtningsFel, hamta_json
from ..lagnamn import likhet
from ..modeller import Match, Odds
from ..tid import parse_iso, till_utc

log = logging.getLogger(__name__)

MIN_LIKHET = 0.6
MAX_TIDSSKILLNAD_H = 3


@dataclass
class OddsEvent:
    hemmalag: str
    bortalag: str
    avspark: str                     # UTC
    odds: List[Tuple[str, str, float, float, float]]  # (bolag, tidpunkt, o1, ox, o2)


def tolka_events(data: list) -> List[OddsEvent]:
    """Tolka svaret från /v4/sports/{sport}/odds. Trasiga bolag hoppas över med en loggrad."""
    if not isinstance(data, list):
        raise HamtningsFel("The Odds API: väntade en lista")
    events = []
    for e in data:
        try:
            hemma, borta = e["home_team"], e["away_team"]
            avspark = till_utc(e["commence_time"])
        except (KeyError, TypeError, ValueError):
            log.warning("The Odds API: hoppar över event utan lag/tid: %r", str(e)[:120])
            continue
        rader = []
        for b in e.get("bookmakers") or []:
            h2h = next((m for m in b.get("markets") or [] if m.get("key") == "h2h"), None)
            if not h2h:
                continue
            priser = {o.get("name"): o.get("price") for o in h2h.get("outcomes") or []}
            o1, ox, o2 = priser.get(hemma), priser.get("Draw"), priser.get(borta)
            try:
                o1, ox, o2 = float(o1), float(ox), float(o2)
            except (TypeError, ValueError):
                log.warning("The Odds API: %s saknar 1X2 för %s - %s", b.get("key"), hemma, borta)
                continue
            if min(o1, ox, o2) <= 1.0:
                log.warning("The Odds API: ogiltiga odds från %s för %s - %s", b.get("key"), hemma, borta)
                continue
            tid = till_utc(b.get("last_update") or h2h.get("last_update") or e["commence_time"])
            rader.append((b.get("key") or b.get("title") or "okant", tid, o1, ox, o2))
        events.append(OddsEvent(hemma, borta, avspark, rader))
    return events


def matcha(matcher: List[Match], events: List[OddsEvent]) -> Dict[int, OddsEvent]:
    """Para ihop kupongens matcher med events. Returnerar matchnr -> event."""
    resultat: Dict[int, OddsEvent] = {}
    upptagna = set()
    for m in matcher:
        bast: Optional[Tuple[float, int]] = None
        for i, ev in enumerate(events):
            if i in upptagna:
                continue
            if m.avspark:
                diff_h = abs((parse_iso(ev.avspark) - parse_iso(m.avspark)).total_seconds()) / 3600
                if diff_h > MAX_TIDSSKILLNAD_H:
                    continue
            poang = min(likhet(m.hemmalag, ev.hemmalag), likhet(m.bortalag, ev.bortalag))
            if poang >= MIN_LIKHET and (bast is None or poang > bast[0]):
                bast = (poang, i)
        if bast:
            upptagna.add(bast[1])
            resultat[m.matchnr] = events[bast[1]]
    return resultat


def hamta_odds(matcher: List[Match], krediter: Optional[dict] = None) -> Tuple[List[Odds], List[str]]:
    """Hämta odds för kupongens matcher. Returnerar (odds, varningar).
    krediter: dict som fylls med {"kvar": n} från svarshuvudet x-requests-remaining."""
    if not config.ODDS_API_KEY:
        return [], ["ODDS_API_KEY saknas – hoppar över The Odds API"]

    varningar: List[str] = []
    per_sport: Dict[str, List[Match]] = {}
    for m in matcher:
        sport = config.LIGA_TILL_ODDSAPI.get((m.land, m.liga))
        if sport is None:
            varningar.append(f"match {m.matchnr} ({m.land}/{m.liga}) saknar sport-nyckel i config.LIGA_TILL_ODDSAPI")
        else:
            per_sport.setdefault(sport, []).append(m)

    alla: List[Odds] = []
    for sport, ms in per_sport.items():
        try:
            data, resp = hamta_json(
                f"{config.ODDS_API_BASE}/sports/{sport}/odds",
                params={"apiKey": config.ODDS_API_KEY, "regions": config.ODDS_API_REGIONS,
                        "markets": "h2h", "oddsFormat": "decimal", "dateFormat": "iso"})
            kvar = resp.headers.get("x-requests-remaining")
            if kvar is not None:
                log.info("The Odds API: %s krediter kvar", kvar)
                if krediter is not None:
                    try:
                        krediter["kvar"] = int(float(kvar))
                    except ValueError:
                        pass
            events = tolka_events(data)
        except HamtningsFel as e:
            # Nyckeln får inte hamna i loggen.
            varningar.append(f"{sport}: {str(e).replace(config.ODDS_API_KEY, '***')}")
            continue
        parning = matcha(ms, events)
        for m in ms:
            ev = parning.get(m.matchnr)
            if ev is None:
                varningar.append(f"match {m.matchnr} {m.hemmalag} - {m.bortalag}: hittade ingen motsvarighet i {sport}")
                continue
            for bolag, tid, o1, ox, o2 in ev.odds:
                alla.append(Odds(m.matchnr, tid, bolag, o1, ox, o2))
    return alla, varningar
