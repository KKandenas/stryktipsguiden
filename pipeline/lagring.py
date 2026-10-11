"""Skriver validerad data till databasen. Allt är idempotent: att spara samma sak två gånger
ger inga dubbletter. Ögonblicksbilder (streck, odds) sparas bara när värdena faktiskt ändrats."""
from __future__ import annotations

import logging
import sqlite3
from typing import Dict, Iterable, List

from .modeller import Kupong, Odds, Resultat, Streck, Tips

log = logging.getLogger(__name__)


def _match_ids(conn: sqlite3.Connection, omgang_id: int) -> Dict[int, int]:
    return {r["matchnr"]: r["id"] for r in
            conn.execute("SELECT id, matchnr FROM matcher WHERE omgang_id = ?", (omgang_id,))}


def kalla_id(conn: sqlite3.Connection, namn: str, url: str | None = None, sprak: str | None = None) -> int:
    conn.execute("INSERT OR IGNORE INTO kallor (namn, url, sprak) VALUES (?, ?, ?)", (namn, url, sprak))
    return conn.execute("SELECT id FROM kallor WHERE namn = ?", (namn,)).fetchone()[0]


def spara_kupong(conn: sqlite3.Connection, k: Kupong) -> Dict[str, int]:
    """Spara omgång, matcher, streck, odds och tips i en transaktion."""
    with conn:
        conn.execute(
            """INSERT INTO omgangar (id, datum, spelstopp, omsattning) VALUES (?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET datum = excluded.datum, spelstopp = excluded.spelstopp,
                   omsattning = COALESCE(excluded.omsattning, omgangar.omsattning)""",
            (k.omgang_id, k.datum, k.spelstopp, k.omsattning))

        nya_matcher = 0
        for m in k.matcher:
            rad = conn.execute("SELECT id, hemmalag, bortalag FROM matcher WHERE omgang_id = ? AND matchnr = ?",
                               (k.omgang_id, m.matchnr)).fetchone()
            if rad is None:
                conn.execute(
                    """INSERT INTO matcher (omgang_id, matchnr, hemmalag, bortalag, liga, land, avspark,
                                            installd, svs_match_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (k.omgang_id, m.matchnr, m.hemmalag, m.bortalag, m.liga, m.land, m.avspark,
                     int(m.installd), m.svs_match_id))
                nya_matcher += 1
                continue
            if (rad["hemmalag"], rad["bortalag"]) != (m.hemmalag, m.bortalag):
                # Svenska Spel har bytt ut matchen. Gammal data hör till en annan match och tas bort.
                log.warning("Omgång %s match %s bytt: %s - %s -> %s - %s. Rensar gamla streck/odds/tips.",
                            k.omgang_id, m.matchnr, rad["hemmalag"], rad["bortalag"], m.hemmalag, m.bortalag)
                for tabell in ("streck", "odds", "tips", "prognoser"):
                    conn.execute(f"DELETE FROM {tabell} WHERE match_id = ?", (rad["id"],))
            conn.execute(
                """UPDATE matcher SET hemmalag = ?, bortalag = ?, liga = ?, land = ?, avspark = ?,
                       installd = ?, svs_match_id = ? WHERE id = ?""",
                (m.hemmalag, m.bortalag, m.liga, m.land, m.avspark, int(m.installd), m.svs_match_id, rad["id"]))

        ids = _match_ids(conn, k.omgang_id)
        return {
            "matcher": nya_matcher,
            "streck": _spara_streck(conn, ids, k.streck),
            "odds": _spara_odds(conn, ids, k.odds),
            "tips": _spara_tips(conn, ids, k.tips),
        }


def _senaste(conn, sql: str, params) -> sqlite3.Row | None:
    return conn.execute(sql, params).fetchone()


def _spara_streck(conn, ids: Dict[int, int], streck: Iterable[Streck]) -> int:
    nya = 0
    for s in streck:
        mid = ids[s.matchnr]
        sist = _senaste(conn, "SELECT tidpunkt, p1, px, p2 FROM streck WHERE match_id = ? "
                              "ORDER BY tidpunkt DESC LIMIT 1", (mid,))
        if sist and sist["tidpunkt"] >= s.tidpunkt:
            continue  # redan sparad eller äldre än det vi har
        if sist and (sist["p1"], sist["px"], sist["p2"]) == (s.p1, s.px, s.p2):
            continue  # oförändrat
        conn.execute("INSERT OR IGNORE INTO streck (match_id, tidpunkt, p1, px, p2) VALUES (?, ?, ?, ?, ?)",
                     (mid, s.tidpunkt, s.p1, s.px, s.p2))
        nya += 1
    return nya


def _spara_odds(conn, ids: Dict[int, int], odds: Iterable[Odds]) -> int:
    nya = 0
    for o in odds:
        mid = ids[o.matchnr]
        sist = _senaste(conn, "SELECT tidpunkt, o1, ox, o2 FROM odds WHERE match_id = ? AND bolag = ? "
                              "ORDER BY tidpunkt DESC LIMIT 1", (mid, o.bolag))
        if sist and sist["tidpunkt"] >= o.tidpunkt:
            continue
        if sist and (sist["o1"], sist["ox"], sist["o2"]) == (o.o1, o.ox, o.o2):
            continue
        conn.execute("INSERT OR IGNORE INTO odds (match_id, tidpunkt, bolag, o1, ox, o2) VALUES (?, ?, ?, ?, ?, ?)",
                     (mid, o.tidpunkt, o.bolag, o.o1, o.ox, o.o2))
        nya += 1
    return nya


def spara_odds(conn: sqlite3.Connection, omgang_id: int, odds: List[Odds]) -> int:
    with conn:
        return _spara_odds(conn, _match_ids(conn, omgang_id), odds)


def _spara_tips(conn, ids: Dict[int, int], tips: Iterable[Tips]) -> int:
    andrade = 0
    for t in tips:
        kid = kalla_id(conn, t.kalla)
        cur = conn.execute(
            """INSERT INTO tips (match_id, kalla_id, tidpunkt, tecken, p1, px, p2, sammanfattning, system, system_rader)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(match_id, kalla_id) DO UPDATE SET
                   tidpunkt = excluded.tidpunkt, tecken = excluded.tecken, p1 = excluded.p1,
                   px = excluded.px, p2 = excluded.p2, sammanfattning = excluded.sammanfattning,
                   system = excluded.system, system_rader = excluded.system_rader
               WHERE tips.tecken IS NOT excluded.tecken OR tips.p1 IS NOT excluded.p1
                  OR tips.px IS NOT excluded.px OR tips.p2 IS NOT excluded.p2
                  OR tips.sammanfattning IS NOT excluded.sammanfattning
                  OR tips.system IS NOT excluded.system OR tips.system_rader IS NOT excluded.system_rader""",
            (ids[t.matchnr], kid, t.tidpunkt, t.tecken, t.p1, t.px, t.p2, t.sammanfattning,
             getattr(t, "system", None), getattr(t, "system_rader", None)))
        andrade += cur.rowcount
    return andrade


def spara_tips(conn: sqlite3.Connection, omgang_id: int, tips: List[Tips]) -> int:
    with conn:
        return _spara_tips(conn, _match_ids(conn, omgang_id), tips)


def spara_resultat(conn: sqlite3.Connection, r: Resultat) -> None:
    if r.installd:
        with conn:
            conn.execute("UPDATE omgangar SET installd = 1 WHERE id = ?", (r.omgang_id,))
        return
    with conn:
        ids = _match_ids(conn, r.omgang_id)
        if len(ids) != 13:
            raise ValueError(f"Omgång {r.omgang_id} har {len(ids)} matcher i databasen – hämta kupongen först")
        for m in r.matcher:
            conn.execute("UPDATE matcher SET resultat = ?, mal_hemma = ?, mal_borta = ?, installd = ? WHERE id = ?",
                         (m.resultat, m.mal_hemma, m.mal_borta, int(m.installd), ids[m.matchnr]))
        conn.execute(
            """UPDATE omgangar SET utdelning_13 = ?, utdelning_12 = ?, utdelning_11 = ?, utdelning_10 = ?,
                   vinnare_13 = ?, vinnare_12 = ?, vinnare_11 = ?, vinnare_10 = ? WHERE id = ?""",
            (r.utdelning[13], r.utdelning[12], r.utdelning[11], r.utdelning[10],
             r.vinnare[13], r.vinnare[12], r.vinnare[11], r.vinnare[10], r.omgang_id))


def omgangar_utan_resultat(conn: sqlite3.Connection, nu: str) -> List[int]:
    return [r[0] for r in conn.execute(
        "SELECT id FROM omgangar WHERE spelstopp < ? AND utdelning_13 IS NULL AND installd = 0 ORDER BY id", (nu,))]
