"""Versionerade prognosmodeller.

En modell tar ett `Underlag` (allt vi vet om en match vid en viss tidpunkt) och returnerar
sannolikheter för 1/X/2, eller None om underlaget inte räcker. Prognoserna sparas i tabellen
`prognoser` med modellens version, så att olika versioner kan jämföras i backtest (fas 5).

Ny modell: skapa en klass med unik `version` och lägg den i MODELLER. Vilken version appen
använder bestäms av statistiksteget (installningar.aktiv_modell, se statistik.py); utan beslut
används odds-v1. Ändra aldrig beteendet hos en version som redan har sparade prognoser –
skapa en ny version.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Dict, List, Optional, Tuple

from ..tid import nu_utc, parse_iso
from . import ensemble
from .sannolikhet import Tripel, proportionell, snitt

log = logging.getLogger(__name__)

BOLAG_START = "svenskaspel_start"

# Svenska Spel publicerar slutstrecken strax efter spelstopp (t.ex. 16:00:01 för spelstopp 15:59).
STRECK_EFTERSLAP = timedelta(hours=1)


@dataclass
class Underlag:
    match_id: int
    odds: Dict[str, Tripel] = field(default_factory=dict)       # bolag -> senaste (o1, ox, o2)
    streck: Optional[Tripel] = None                            # procent
    streck_tid: Optional[str] = None
    tips: Dict[str, Tripel] = field(default_factory=dict)       # källa -> (p1, px, p2); bara tecken → pseudo


class OddsModell:
    """odds-v1: snittet av alla bolags marginalfria sannolikheter (proportionell metod).

    Svenska Spels startodds används bara om inga senare odds finns (gäller främst historik)."""
    version = "odds-v1"
    beskrivning = "Snitt av bookmakerodds med marginalen borträknad"

    def prognos(self, u: Underlag) -> Optional[Tripel]:
        bolag = {b: o for b, o in u.odds.items() if b != BOLAG_START} or u.odds
        return snitt(proportionell(*o) for o in bolag.values())


def observation(u: Underlag) -> ensemble.Observation:
    """Underlaget som källor med sannolikheter, för ensemble-modellen och källstatistiken."""
    k: Dict[str, Tripel] = {}
    po = OddsModell().prognos(u)
    if po:
        k["odds"] = po
    if u.streck and sum(u.streck) > 0:
        s = sum(u.streck)
        k["streck"] = (u.streck[0] / s, u.streck[1] / s, u.streck[2] / s)
    k.update(u.tips)
    return ensemble.Observation(k)


class EnsembleModell:
    """ensemble-v1: odds, streck och tips viktade med logistisk regression (se ensemble.py).

    Vikterna tränas om varje vecka på avgjorda matcher. Ger bara prognos när odds finns."""
    version = "ensemble-v1"
    beskrivning = "Odds, streck och tips viktade efter historisk träffsäkerhet"

    def __init__(self, vikter: Optional[ensemble.Vikter] = None):
        self.vikter = vikter

    def prognos(self, u: Underlag) -> Optional[Tripel]:
        o = observation(u)
        if self.vikter is None or "odds" not in o.kallor:
            return None
        return ensemble.prognos(self.vikter, o)


MODELLER = {m.version: m for m in (OddsModell(), EnsembleModell())}
STANDARD_MODELL = "odds-v1"


def aktiv_modell():
    """Basmodellen som alltid räknas (odds-v1)."""
    return MODELLER[STANDARD_MODELL]


def las_vikter(conn: sqlite3.Connection, version: str) -> Optional[ensemble.Vikter]:
    r = conn.execute("SELECT parametrar FROM modellvikter WHERE modellversion = ?", (version,)).fetchone()
    return ensemble.Vikter.fran_dict(json.loads(r[0])) if r else None


def ladda_modell(conn: sqlite3.Connection, version: str):
    if version == EnsembleModell.version:
        return EnsembleModell(las_vikter(conn, version))
    return MODELLER[version]


def vald_version(conn: sqlite3.Connection) -> str:
    """Den version appen ska visa, enligt senaste statistikkörningen."""
    r = conn.execute("SELECT varde FROM installningar WHERE nyckel = 'aktiv_modell'").fetchone()
    return r[0] if r and r[0] in MODELLER else STANDARD_MODELL


# ---------- underlag från databasen ----------

def streck_grans(fore: str) -> str:
    return (parse_iso(fore) + STRECK_EFTERSLAP).strftime("%Y-%m-%dT%H:%M:%SZ")


def las_underlag(conn: sqlite3.Connection, match_id: int, fore: str) -> Underlag:
    """Allt vi visste om matchen före tidpunkten `fore` (UTC)."""
    u = Underlag(match_id)
    # SQLite: med MAX() i SELECT kommer övriga kolumner från raden med störst tidpunkt.
    for r in conn.execute("SELECT bolag, o1, ox, o2, MAX(tidpunkt) FROM odds "
                          "WHERE match_id = ? AND tidpunkt <= ? GROUP BY bolag", (match_id, fore)):
        u.odds[r[0]] = (r[1], r[2], r[3])
    s = conn.execute("SELECT p1, px, p2, tidpunkt FROM streck WHERE match_id = ? AND tidpunkt <= ? "
                     "ORDER BY tidpunkt DESC LIMIT 1", (match_id, streck_grans(fore))).fetchone()
    if s:
        u.streck = (s[0], s[1], s[2])
        u.streck_tid = s[3]
    for r in conn.execute("SELECT k.namn, t.p1, t.px, t.p2, t.tecken FROM tips t JOIN kallor k ON k.id = t.kalla_id "
                          "WHERE t.match_id = ?", (match_id,)):
        if r[1] is not None:
            u.tips[r[0]] = (r[1], r[2], r[3])
        elif r[4]:
            u.tips[r[0]] = ensemble.pseudosannolikhet(r[4])
    return u


def berakna_prognoser(conn: sqlite3.Connection, modell=None, omgang_ids: Optional[List[int]] = None,
                      bara_saknade: bool = False) -> Tuple[int, int]:
    """Räkna och spara prognoser. Returnerar (sparade/ändrade, matcher utan underlag).

    Underlaget tas fram till spelstopp (eller nu, för öppna omgångar)."""
    modell = modell or aktiv_modell()
    villkor, params = ["o.installd = 0"], []
    if omgang_ids is not None:
        if not omgang_ids:
            return 0, 0
        villkor.append(f"m.omgang_id IN ({','.join('?' * len(omgang_ids))})")
        params += omgang_ids
    if bara_saknade:
        villkor.append("NOT EXISTS (SELECT 1 FROM prognoser p WHERE p.match_id = m.id AND p.modellversion = ?)")
        params.append(modell.version)
    rader = conn.execute(
        f"SELECT m.id, o.spelstopp FROM matcher m JOIN omgangar o ON o.id = m.omgang_id "
        f"WHERE {' AND '.join(villkor)}", params).fetchall()

    nu = nu_utc()
    sparade = utan = 0
    with conn:
        for match_id, spelstopp in rader:
            p = modell.prognos(las_underlag(conn, match_id, min(spelstopp, nu)))
            if p is None:
                utan += 1
                continue
            p = tuple(round(x, 6) for x in p)
            cur = conn.execute(
                """INSERT INTO prognoser (match_id, modellversion, p1, px, p2, skapad) VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(match_id, modellversion) DO UPDATE SET
                       p1 = excluded.p1, px = excluded.px, p2 = excluded.p2, skapad = excluded.skapad
                   WHERE prognoser.p1 != excluded.p1 OR prognoser.px != excluded.px OR prognoser.p2 != excluded.p2""",
                (match_id, modell.version, p[0], p[1], p[2], nu))
            sparade += cur.rowcount
    return sparade, utan
