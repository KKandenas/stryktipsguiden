"""Serietabeller totalt, hemma och borta för matchdetaljens flik Tabell.

Räknas ur säsongens resultat från football-data.co.uk (tabellen sidomatcher, samma källa som matcherna utanför
kupongen), så att alla tre tabellerna bygger på samma matcher. Finns för ligorna i footballdata.LIGOR.
Poängavdrag finns inte i resultaten; de hämtas ur den officiella tabellen (ligatabeller, BBC Sport) när ett lag
har spelat lika många matcher där men har färre poäng, och dras bara av i totaltabellen. Ordning: poäng,
målskillnad, gjorda mål, namn.
"""
from __future__ import annotations

import sqlite3
from datetime import date
from typing import Dict, List, Optional

from .lagnamn import likhet
from .sources import footballdata

MIN_LIKHET = 0.6
TYPER = ("totalt", "hemma", "borta")


def _sasongsstart(idag: date, kod: str) -> str:
    return footballdata.sasongsstart(idag, kod).isoformat()


def berakna(conn: sqlite3.Connection, kod: str, idag: date) -> Optional[dict]:
    """{"totalt"/"hemma"/"borta": [{"lag", "s", "v", "o", "f", "gm", "im", "p"}], "till": datum} eller None."""
    rader = conn.execute("""SELECT datum, hemmalag, bortalag, mal_hemma, mal_borta FROM sidomatcher
                            WHERE liga_kod = ? AND datum >= ? AND mal_hemma IS NOT NULL""",
                         (kod, _sasongsstart(idag, kod))).fetchall()
    if not rader:
        return None
    tom = lambda: {"s": 0, "v": 0, "o": 0, "f": 0, "gm": 0, "im": 0, "p": 0}
    tab: Dict[str, Dict[str, dict]] = {t: {} for t in TYPER}

    def lagg(typ, lag, gjorda, insl):
        r = tab[typ].setdefault(lag, tom())
        r["s"] += 1
        r["gm"] += gjorda
        r["im"] += insl
        nyckel = "v" if gjorda > insl else "o" if gjorda == insl else "f"
        r[nyckel] += 1
        r["p"] += {"v": 3, "o": 1, "f": 0}[nyckel]

    for _, hemma, borta, mh, mb in rader:
        for typ in ("totalt", "hemma"):
            lagg(typ, hemma, mh, mb)
        for typ in ("totalt", "borta"):
            lagg(typ, borta, mb, mh)
    # Lag som inte spelat hemma (eller borta) än finns ändå med i den tabellen
    for typ in ("hemma", "borta"):
        for lag in tab["totalt"]:
            tab[typ].setdefault(lag, tom())

    return {**{t: _sortera([{"lag": lag, **r} for lag, r in tab[t].items()]) for t in TYPER},
            "till": max(r[0] for r in rader)}


def _sortera(rader: List[dict]) -> List[dict]:
    return sorted(rader, key=lambda r: (-r["p"], -(r["gm"] - r["im"]), -r["gm"], r["lag"]))


def avdrag(conn: sqlite3.Connection, land: str, liga: str, totalt: List[dict]) -> List[dict]:
    """Totaltabellen med poängavdrag enligt den officiella tabellen (r["avdrag"] = antal poäng)."""
    officiell = conn.execute("SELECT lag, spelade, poang FROM ligatabeller WHERE land = ? AND liga = ?",
                             (land, liga)).fetchall()
    if not officiell:
        return totalt
    ut = []
    for r in totalt:
        o = max(officiell, key=lambda x: likhet(r["lag"], x[0]))
        if likhet(r["lag"], o[0]) >= MIN_LIKHET and o[1] == r["s"] and o[2] is not None and o[2] < r["p"]:
            r = {**r, "p": o[2], "avdrag": r["p"] - o[2]}
        ut.append(r)
    return _sortera(ut)


def senaste(conn: sqlite3.Connection, kod: str, lag: str, idag: date, antal: int = 5) -> List[dict]:
    """Lagets senaste ligamatcher, nyaste först: [{"datum", "mot", "plats": "h"/"b", "gjorda", "insl"}]."""
    rader = conn.execute("""SELECT datum, hemmalag, bortalag, mal_hemma, mal_borta FROM sidomatcher
                            WHERE liga_kod = ? AND datum >= ? AND mal_hemma IS NOT NULL AND (hemmalag = ? OR bortalag = ?)
                            ORDER BY datum DESC LIMIT ?""", (kod, _sasongsstart(idag, kod), lag, lag, antal)).fetchall()
    return [{"datum": d, "mot": b, "plats": "h", "gjorda": mh, "insl": mb} if h == lag else
            {"datum": d, "mot": h, "plats": "b", "gjorda": mb, "insl": mh} for d, h, b, mh, mb in rader]


def _hitta(namn: str, lag: List[str]) -> Optional[str]:
    bast = max(lag, key=lambda x: likhet(namn, x), default=None)
    return bast if bast is not None and likhet(namn, bast) >= MIN_LIKHET else None


def for_kupong(conn: sqlite3.Connection, matcher, idag: date):
    """(tabeller per liga {"England/Championship": {...}}, {match_id: {"nyckel", "hemma", "borta", "senaste"}}).

    "hemma"/"borta" är lagens namn i tabellen, så att appen kan markera dem; "senaste" är lagens fem senaste
    ligamatcher (se senaste())."""
    tabeller: Dict[str, dict] = {}
    per_match: Dict[int, dict] = {}
    for m in matcher:
        kod = footballdata.KOD.get((m["land"], m["liga"]))
        if not kod:
            continue
        nyckel = f"{m['land']}/{m['liga']}"
        if nyckel not in tabeller:
            t = berakna(conn, kod, idag)
            if t is None:
                continue
            t["totalt"] = avdrag(conn, m["land"], m["liga"], t["totalt"])
            tabeller[nyckel] = t
        lag = [r["lag"] for r in tabeller[nyckel]["totalt"]]
        h, b = _hitta(m["hemmalag"], lag), _hitta(m["bortalag"], lag)
        per_match[m["id"]] = {"nyckel": nyckel, "hemma": h, "borta": b,
                              "senaste": {"hemma": senaste(conn, kod, h, idag) if h else [],
                                          "borta": senaste(conn, kod, b, idag) if b else []}}
    return tabeller, per_match
