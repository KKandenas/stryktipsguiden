"""Experternas kommentar per match ur tipssajternas arkiv, för att leta mönster i matcher som skräller.

Tipsmedoss har en analys av varje Stryktipsomgång sedan 2018 (kategorisidan /category/stryktipsforslag/
med sidnumrering). Varje artikel har ett fast format, så den delas upp per match utan AI:

    1. Leicester – Manchester City, X2

    Supertufft möte för Peps Manchester City men …

Artikeln kopplas till omgången via datumet i adressen (…/2021/stryktipsforslag/stryktipset-11-9-…) och
matcherna via numret, som kontrolleras mot lagnamnen. Kommentar och tecken sparas i expertkommentarer.
"""
from __future__ import annotations

import logging
import re
import sqlite3
from datetime import date, timedelta
from typing import Dict, List, Optional, Tuple

from . import lagring
from .http import HamtningsFel
from .lagnamn import likhet
from .tid import nu_utc
from .webb import hamta_sida, html_till_text

log = logging.getLogger(__name__)

KALLA = "tipsmedoss.com"
LISTA = "https://tipsmedoss.com/category/stryktipsforslag/"
ARTIKEL = re.compile(r'href="(https://tipsmedoss\.com/(\d{4})/stryktipsforslag/stryktipset-(\d{1,2})-(\d{1,2})-[^"]*)"')
# Tecknet skrivs ibland med mellanslag ("1 2") eller litet x, och saknas ibland helt
RUBRIK = re.compile(r"(?m)^\s*(\d{1,2})\.\s*(.+?)\s+[–-]\s+(.+?),\s*([1Xx2](?:\s*[1Xx2]){0,2})?\s*$")
FORSTA_DATUM = date(2020, 12, 1)       # historiken börjar med omgång 4668 (december 2020)
MIN_LIKHET = 0.6                       # sajtens lagnamn är ofta kortare ("Man City", "Spurs")
MAX_SIDOR = 40


def dela_upp(text: str) -> List[Tuple[int, str, str, str, str]]:
    """[(nr, hemma, borta, tecken, kommentar)] ur artikeltexten. Kommentaren är texten fram till nästa
    match; för den sista matchen bara första stycket (därefter kommer ofta systemet eller banken)."""
    rubriker = list(RUBRIK.finditer(text))
    ut = []
    for i, r in enumerate(rubriker):
        slut = rubriker[i + 1].start() if i + 1 < len(rubriker) else len(text)
        kommentar = text[r.end():slut].strip()
        if i + 1 == len(rubriker):
            kommentar = kommentar.split("\n\n")[0].strip()
        tecken = "".join(t for t in "1X2" if t in (r.group(4) or "").upper())
        ut.append((int(r.group(1)), r.group(2).strip(), r.group(3).strip(), tecken, re.sub(r"\s+", " ", kommentar)))
    return ut


def artiklar(max_sidor: int = MAX_SIDOR) -> List[Tuple[str, date]]:
    """(url, omgångens datum) för alla artiklar i arkivet, nyaste först. Slutar när en sida inte ger något nytt."""
    ut: Dict[str, date] = {}
    for sida in range(1, max_sidor + 1):
        try:
            html = hamta_sida(LISTA if sida == 1 else f"{LISTA}page/{sida}/", max_alder_h=6 if sida == 1 else 24 * 7)
        except HamtningsFel as e:
            log.info("Expertarkiv: sida %d: %s", sida, e)
            break
        nya = 0
        for url, ar, dag, manad in ARTIKEL.findall(html):
            try:
                d = date(int(ar), int(manad), int(dag))
            except ValueError:
                continue
            if url not in ut:
                ut[url], nya = d, nya + 1
        if not nya:
            break
    return sorted(ut.items(), key=lambda x: x[1], reverse=True)


def _omgang(conn, d: date) -> Optional[int]:
    r = conn.execute("""SELECT id FROM omgangar WHERE datum BETWEEN ? AND ? AND installd = 0
                        ORDER BY ABS(julianday(datum) - julianday(?)) LIMIT 1""",
                     ((d - timedelta(days=3)).isoformat(), (d + timedelta(days=3)).isoformat(),
                      d.isoformat())).fetchone()
    return r[0] if r else None


def koppla(matcher: List[sqlite3.Row], delar) -> Dict[int, tuple]:
    """match_id → (tecken, kommentar). Numret används om lagnamnen stämmer, annars den match som liknar mest."""
    ut = {}
    for nr, hemma, borta, tecken, kommentar in delar:
        poang = lambda m: min(likhet(hemma, m["hemmalag"]), likhet(borta, m["bortalag"]))
        m = next((x for x in matcher if x["matchnr"] == nr), None)
        if m is None or poang(m) < MIN_LIKHET:
            m = max(matcher, key=poang, default=None)
        if m is not None and poang(m) >= MIN_LIKHET and kommentar:
            ut[m["id"]] = (tecken, kommentar)
    return ut


def uppdatera(conn: sqlite3.Connection, max_sidor: int = MAX_SIDOR, max_artiklar: int = 400) -> Dict[str, int]:
    """Läs nya artiklar ur arkivet. Vanliga körningar använder max_sidor=1 (bara veckans artikel)."""
    kid = lagring.kalla_id(conn, KALLA)
    lasta = {r[0] for r in conn.execute(
        "SELECT url FROM arkivartiklar WHERE kalla_id = ? AND omgang_id IS NOT NULL", (kid,))}
    stat = {"artiklar": 0, "matcher": 0, "utan_omgang": 0}
    for url, d in artiklar(max_sidor):
        if d < FORSTA_DATUM or url in lasta or stat["artiklar"] >= max_artiklar:
            continue
        oid = _omgang(conn, d)
        try:
            text = html_till_text(hamta_sida(url, max_alder_h=24 * 30))
        except HamtningsFel as e:
            log.info("Expertarkiv: %s: %s", url, e)
            continue
        stat["artiklar"] += 1
        kopplade = {}
        if oid is not None:
            matcher = conn.execute("SELECT id, matchnr, hemmalag, bortalag FROM matcher WHERE omgang_id = ?",
                                   (oid,)).fetchall()
            kopplade = koppla(matcher, dela_upp(text))
        else:
            stat["utan_omgang"] += 1
        with conn:
            for mid, (tecken, kommentar) in kopplade.items():
                conn.execute("""INSERT INTO expertkommentarer (match_id, kalla_id, tecken, text, url, typ)
                                VALUES (?, ?, ?, ?, ?, 'original')
                                ON CONFLICT(match_id, kalla_id) DO UPDATE SET tecken = excluded.tecken,
                                    text = excluded.text, url = excluded.url, typ = 'original'""",
                             (mid, kid, tecken or None, kommentar, url))
            conn.execute("""INSERT INTO arkivartiklar (url, kalla_id, omgang_id, matcher, hamtad) VALUES (?, ?, ?, ?, ?)
                            ON CONFLICT(url) DO UPDATE SET omgang_id = excluded.omgang_id, matcher = excluded.matcher,
                                hamtad = excluded.hamtad""", (url, kid, oid, len(kopplade), nu_utc()))
        stat["matcher"] += len(kopplade)
    return stat


def kopiera_sammanfattningar(conn: sqlite3.Connection, nu: Optional[str] = None) -> int:
    """Övriga sajters kommentarer: AI:ns sammanfattning per match från tipsinsamlingen (tips.sammanfattning),
    kopierad när omgången har stängt så att det är den slutliga versionen. Originaltext (arkivet) skrivs
    aldrig över. Returnerar antal nya kommentarer."""
    nu = nu or nu_utc()
    with conn:
        return conn.execute("""
            INSERT OR IGNORE INTO expertkommentarer (match_id, kalla_id, tecken, text, url, typ)
            SELECT t.match_id, t.kalla_id, t.tecken, t.sammanfattning, '', 'sammanfattning'
            FROM tips t JOIN kallor k ON k.id = t.kalla_id JOIN matcher m ON m.id = t.match_id
            JOIN omgangar o ON o.id = m.omgang_id
            WHERE o.spelstopp < ? AND t.sammanfattning IS NOT NULL AND TRIM(t.sammanfattning) != ''
              AND k.namn NOT IN ('Tio tidningars tips', ?)""", (nu, KALLA)).rowcount
