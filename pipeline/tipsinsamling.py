"""Hämta tipsartiklar för öppna omgångar och låt AI-modellen tolka dem till tabellen tips.

En artikel tolkas om bara om texten ändrats OCH den senaste tolkningen är äldre än OMTOLKA_EFTER_H,
så att sidor med levande odds inte kostar ett AI-anrop vid varje körning.
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import timedelta
from typing import List, Optional

from . import lagring
from .ai.extraktion import extrahera
from .ai.klient import AiFel, Anropare
from .http import HamtningsFel
from .modeller import Match
from .sources.tipssajter import SAJTER, Tipssajt
from .tid import nu_utc, parse_iso
from .webb import hamta_sida, html_till_text, text_hash

log = logging.getLogger(__name__)

OMTOLKA_EFTER_H = 12


def _matcher(conn, omgang_id: int) -> List[Match]:
    return [Match(r["matchnr"], r["hemmalag"], r["bortalag"], r["liga"], r["land"], r["avspark"])
            for r in conn.execute("SELECT * FROM matcher WHERE omgang_id = ? ORDER BY matchnr", (omgang_id,))]


def samla(conn: sqlite3.Connection, anropa: Anropare, sajter: Optional[List[Tipssajt]] = None,
          nu: Optional[str] = None) -> dict:
    """Returnerar statistik: {'artiklar': n, 'tolkade': n, 'tips': n, 'fel': n}."""
    nu = nu or nu_utc()
    stat = {"artiklar": 0, "tolkade": 0, "tips": 0, "fel": 0}
    oppna = conn.execute("SELECT id, spelstopp FROM omgangar WHERE spelstopp > ? AND installd = 0", (nu,)).fetchall()
    if not oppna:
        log.info("Tips: ingen öppen omgång")
    for omgang_id, spelstopp in oppna:
        matcher = _matcher(conn, omgang_id)
        for sajt in sajter if sajter is not None else SAJTER:
            kid = lagring.kalla_id(conn, sajt.namn, sajt.url, sajt.sprak)
            conn.commit()
            try:
                artiklar = sajt.hitta_artiklar(matcher, spelstopp)
            except (HamtningsFel, ValueError) as e:
                log.warning("Tips: %s gick inte att läsa: %s", sajt.namn, e)
                stat["fel"] += 1
                continue
            log.info("Tips: %s – %d artiklar för omgång %s", sajt.namn, len(artiklar), omgang_id)
            for a in artiklar:
                stat["artiklar"] += 1
                try:
                    text = html_till_text(hamta_sida(a.url))
                except HamtningsFel as e:
                    log.warning("Tips: %s: %s", a.url, e)
                    stat["fel"] += 1
                    continue
                h = text_hash(text)
                rad = conn.execute("SELECT extraherad, extraherad_hash FROM artiklar WHERE url = ?", (a.url,)).fetchone()
                with conn:
                    conn.execute(
                        """INSERT INTO artiklar (url, kalla_id, omgang_id, titel, hamtad, innehall_hash)
                           VALUES (?, ?, ?, ?, ?, ?)
                           ON CONFLICT(url) DO UPDATE SET titel = excluded.titel, hamtad = excluded.hamtad,
                               innehall_hash = excluded.innehall_hash""",
                        (a.url, kid, omgang_id, a.titel, nu, h))
                if rad and rad["extraherad"]:
                    if rad["extraherad_hash"] == h:
                        continue
                    if parse_iso(nu) - parse_iso(rad["extraherad"]) < timedelta(hours=OMTOLKA_EFTER_H):
                        continue
                ms = [m for m in matcher if a.matchnr is None or m.matchnr in a.matchnr]
                try:
                    tips = extrahera(anropa, ms, a.titel, text, sajt.namn, nu)
                except AiFel as e:
                    log.error("Tips: AI-modellen kunde inte tolka %s: %s", a.url, e)
                    stat["fel"] += 1
                    continue
                andrade = lagring.spara_tips(conn, omgang_id, tips)
                with conn:
                    conn.execute("UPDATE artiklar SET extraherad = ?, extraherad_hash = ?, antal_tips = ? WHERE url = ?",
                                 (nu, h, len(tips), a.url))
                stat["tolkade"] += 1
                stat["tips"] += andrade
                log.info("Tips: %s → %d tips (%d nya/ändrade)", a.titel, len(tips), andrade)
    return stat
