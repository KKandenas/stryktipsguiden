"""API-Football (api-sports.io): skador och avstängningar per liga. Under prövning (november 2026).

Gratiskontot har 10 anrop per minut och 100 per dag. Kommandot `apifootball-test` gör ett fåtal anrop och
loggar om gratisplanen ger tillgång till pågående säsong och om skadelistorna finns för våra ligor. Inget
sparas och ingen AI används. Nyckeln ligger i GitHub Secret APIFOOTBALL_KEY.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import requests

from .. import config

log = logging.getLogger(__name__)

BAS = "https://v3.football.api-sports.io"
LIGOR = {"Premier League": 39, "Championship": 40}   # räcker för testet; fler när källan är godkänd


def nyckel() -> str:
    return os.environ.get("APIFOOTBALL_KEY", "").strip()


def hamta(vag: str, params: Optional[dict] = None) -> Tuple[Dict[str, Any], Dict[str, str]]:
    """Ett anrop utan omförsök (varje försök räknas mot dagskvoten). Returnerar (svar, kvothuvuden)."""
    try:
        r = requests.get(BAS + vag, params=params or {}, timeout=config.HTTP_TIMEOUT,
                         headers={"x-apisports-key": nyckel(), "User-Agent": config.USER_AGENT})
    except requests.RequestException as e:
        raise RuntimeError(f"Nätverksfel mot API-Football {vag}: {e}") from e
    kvot = {k: v for k, v in r.headers.items() if k.lower().startswith("x-ratelimit")}
    try:
        data = r.json()
    except ValueError:
        data = {"errors": {"http": f"{r.status_code}: {r.text[:200]}"}}
    return data, kvot


def _fel(data: dict) -> Optional[str]:
    fel = data.get("errors")
    if isinstance(fel, dict) and fel:
        return "; ".join(f"{k}: {v}" for k, v in fel.items())
    if isinstance(fel, list) and fel:
        return "; ".join(map(str, fel))
    return None


def aktuell_sasong(svar: dict) -> Tuple[Optional[int], Optional[dict]]:
    """Säsongen märkt current i /leagues-svaret, med dess coverage."""
    for liga in svar.get("response") or []:
        for s in liga.get("seasons") or []:
            if s.get("current"):
                return s.get("year"), s.get("coverage")
    return None, None


def sammanfatta_skador(svar: dict, antal: int = 5) -> List[str]:
    rader = []
    for x in (svar.get("response") or [])[:antal]:
        spelare, lag, match = x.get("player") or {}, x.get("team") or {}, x.get("fixture") or {}
        rader.append(f"{lag.get('name')}: {spelare.get('name')} – {spelare.get('type')} ({spelare.get('reason')}), "
                     f"match {str(match.get('date') or '')[:10]}")
    return rader


def testa() -> bool:
    """Kontot, pågående säsong och skadelistor för två ligor. Högst 1 + 2 × 2 anrop."""
    if not nyckel():
        log.error("API-Football: APIFOOTBALL_KEY saknas")
        return False
    status, kvot = hamta("/status")
    if _fel(status):
        log.error("API-Football: kontot svarar med fel: %s", _fel(status))
        return False
    r = status.get("response") or {}
    log.info("API-Football: plan %s, anrop i dag %s av %s, %s", (r.get("subscription") or {}).get("plan"),
             (r.get("requests") or {}).get("current"), (r.get("requests") or {}).get("limit_day"), kvot)
    ok = True
    for namn, liga_id in LIGOR.items():
        ligor, _ = hamta("/leagues", {"id": liga_id})
        if _fel(ligor):
            log.error("API-Football: %s – /leagues gav fel: %s", namn, _fel(ligor))
            ok = False
            continue
        sasong, tackning = aktuell_sasong(ligor)
        log.info("API-Football: %s – pågående säsong %s, skador i tackningen: %s", namn, sasong,
                 (tackning or {}).get("injuries"))
        if sasong is None:
            ok = False
            continue
        skador, kvot = hamta("/injuries", {"league": liga_id, "season": sasong})
        if _fel(skador):
            log.error("API-Football: %s %s – /injuries gav fel: %s", namn, sasong, _fel(skador))
            ok = False
            continue
        log.info("API-Football: %s %s – %s poster om frånvaro (%s)", namn, sasong, skador.get("results"), kvot)
        for rad in sammanfatta_skador(skador):
            log.info("API-Football:   %s", rad)
    log.info("API-Football: testet %s", "klart – pågående säsong går att hämta" if ok else "visade problem, se ovan")
    return ok
