"""Matcher utanför kupongen: snabbare inlärning av tipsarnas vikter i Med experter (tips-v1).

Sports Mole och FootballPredictions tipsar alla matcher i de stora ligorna, inte bara kupongens 13. Deras
tips står i ett fast format ("We say: Wolves 2-1 Portsmouth", "Our prediction for this match: Wolves 1 - 0
Portsmouth") och läses utan AI. Resultat och snittodds kommer från football-data.co.uk, så inga oddskrediter
används. Tipsen tas bara med i träningen av tips-v1 (aldrig i prognoser), och matcher som också stod på
kupongen räknas inte två gånger.

1. samla_tips: nya artiklar från sajternas ligasidor (högst MAX_NYA per sajt och körning).
2. samla_resultat: spelade matcher från football-data.co.uk för innevarande säsong.
3. observationer: tips + odds + resultat per match, för statistik.walk_forward.
"""
from __future__ import annotations

import logging
import re
import sqlite3
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Tuple

from .http import HamtningsFel
from .lagnamn import likhet
from .model import ensemble
from .sources import footballdata
from .sources.tipssajter import footballpredictions as fp
from .sources.tipssajter import sportsmole as sm
from .tid import nu_utc, parse_iso
from .webb import hamta_sida, html_till_text

log = logging.getLogger(__name__)

MAX_NYA = 40                  # nya artiklar per sajt och körning (2 s paus per anrop)
TIDSBUDGET = 6 * 60           # sekunder för artiklarna per körning, ifall en sajt är långsam
MAX_ALDER_DAGAR = 30          # äldre artiklar än så hoppas över
MIN_LIKHET = 0.75

SM_TIPS = re.compile(r"We say:\s*(.+?)\s+(\d{1,2})\s*-\s*(\d{1,2})\s+(.+?)(?:\s{2,}|$)")
FP_TIPS = re.compile(r"Our prediction for this match:\s*(.+?)\s+(\d{1,2})\s*-\s*(\d{1,2})\s+(.+?)(?:\s{2,}|$)")


def las_tips(text: str, monster: re.Pattern, hemma: str, borta: str) -> Optional[Tuple[str, int, int]]:
    """(tecken, hemmamål, bortamål) ur tipsraden. Lagen i raden jämförs med länkens lag, ifall sajten
    skulle skriva bortalaget först."""
    t = monster.search(text)
    if not t:
        return None
    lag1, m1, m2, lag2 = t.group(1), int(t.group(2)), int(t.group(3)), t.group(4)
    if likhet(lag1, borta) > likhet(lag1, hemma) and likhet(lag2, hemma) > likhet(lag2, borta):
        m1, m2 = m2, m1
    return ("1" if m1 > m2 else "X" if m1 == m2 else "2"), m1, m2


def _lag(slug: str) -> str:
    return slug.replace("-", " ")


def _kanda(conn) -> set:
    return {r[0] for r in conn.execute("SELECT url FROM sidotips")}


def _spara(conn, url, kalla, kod, hemma, borta, datum, tips) -> None:
    tecken, hm, bm = tips or (None, None, None)
    conn.execute("""INSERT OR REPLACE INTO sidotips (url, kalla, liga_kod, hemmalag, bortalag, datum, tecken,
                    hemma_mal, borta_mal, hamtad) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                 (url, kalla, kod, hemma, borta, datum, tecken, hm, bm, nu_utc()))


def samla_tips(conn: sqlite3.Connection, idag: Optional[date] = None) -> Dict[str, int]:
    idag = idag or date.today()
    tidigast = idag - timedelta(days=MAX_ALDER_DAGAR)
    kanda, stat = _kanda(conn), defaultdict(int)
    slut = time.monotonic() + TIDSBUDGET
    full = lambda kalla: stat[kalla] >= MAX_NYA or time.monotonic() > slut

    # FootballPredictions: datumet står i länken, så bara relevanta artiklar hämtas
    for (land, liga), slug in fp.LIGASIDOR.items():
        kod = footballdata.KOD.get((land, liga))
        if not kod:
            continue
        try:
            lankar = fp.LANK.findall(hamta_sida(f"{fp.BAS}/footballpredictions/{slug}/", max_alder_h=6))
        except HamtningsFel as e:
            log.warning("Sidomatcher: footballpredictions.com %s: %s", slug, e)
            continue
        for sokvag, hemma, borta, d, mn, y in dict.fromkeys(lankar):
            url = fp.BAS + sokvag
            datum = date(int(y), int(mn), int(d))
            aktuell = tidigast <= datum <= idag + timedelta(days=7)
            if url in kanda or not aktuell or full("footballpredictions.com"):
                continue
            stat["footballpredictions.com"] += 1
            try:
                tips = las_tips(html_till_text(hamta_sida(url, max_alder_h=24 * 14)), FP_TIPS, _lag(hemma), _lag(borta))
            except HamtningsFel as e:
                log.info("Sidomatcher: %s: %s", url, e)
                continue
            with conn:
                _spara(conn, url, "footballpredictions.com", kod, _lag(hemma), _lag(borta), datum.isoformat(), tips)
            kanda.add(url)

    # Sports Mole: länkarna saknar datum, så det läses ur artikeln
    for (land, liga), slug in sm.LIGASIDOR.items():
        kod = footballdata.KOD.get((land, liga))
        if not kod:
            continue
        try:
            lankar = sm.LANK.findall(hamta_sida(f"{sm.BAS}/football/{slug}/", max_alder_h=6))
        except HamtningsFel as e:
            log.warning("Sidomatcher: sportsmole.co.uk %s: %s", slug, e)
            continue
        for sokvag, hemma, borta in dict.fromkeys(lankar):
            url = sm.BAS + sokvag
            if url in kanda or full("sportsmole.co.uk"):
                continue
            stat["sportsmole.co.uk"] += 1
            try:
                text = html_till_text(hamta_sida(url, max_alder_h=24 * 14))
            except HamtningsFel as e:
                log.info("Sidomatcher: %s: %s", url, e)
                continue
            d = sm.avsparksdatum(text)
            datum = d.date() if d else None
            tips = las_tips(text, SM_TIPS, _lag(hemma), _lag(borta)) if datum and datum >= tidigast else None
            with conn:
                _spara(conn, url, "sportsmole.co.uk", kod, _lag(hemma), _lag(borta), datum and datum.isoformat(), tips)
            kanda.add(url)
    return dict(stat)


def samla_resultat(conn: sqlite3.Connection, idag: Optional[date] = None) -> int:
    """Spelade matcher från football-data.co.uk för de ligor där vi har tips. Returnerar antal nya matcher."""
    idag = idag or date.today()
    koder = sorted({r[0] for r in conn.execute("SELECT DISTINCT liga_kod FROM sidotips WHERE tecken IS NOT NULL")})
    nya = 0
    for kod in koder:
        try:
            rader = footballdata.hamta(kod, footballdata.sasong(idag))
        except HamtningsFel as e:
            log.warning("Sidomatcher: football-data.co.uk %s: %s", kod, e)
            continue
        with conn:
            for datum, hemma, borta, res, odds in rader:
                p = odds or (None, None, None)
                nya += conn.execute("""INSERT OR IGNORE INTO sidomatcher (liga_kod, datum, hemmalag, bortalag, resultat,
                                       p1, px, p2) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                                    (kod, datum, hemma, borta, res, *p)).rowcount
    return nya


def _samma(a_hemma, a_borta, b_hemma, b_borta) -> float:
    return min(likhet(a_hemma, b_hemma), likhet(a_borta, b_borta))


def observationer(conn: sqlite3.Connection) -> List[Tuple[str, ensemble.Observation]]:
    """(datum, observation med odds, tips och utfall) för avgjorda matcher utanför kupongen, i datumordning."""
    matcher: Dict[Tuple[str, str], List[tuple]] = defaultdict(list)     # (liga, datum) → sidomatcher
    for r in conn.execute("SELECT id, liga_kod, datum, hemmalag, bortalag, resultat, p1, px, p2 FROM sidomatcher "
                          "WHERE p1 IS NOT NULL"):
        matcher[(r[1], r[2])].append(r)
    # Kupongens matcher per datum: de finns redan i träningen med sina egna tips
    kupong: Dict[str, List[Tuple[str, str]]] = defaultdict(list)
    for h, b, avspark in conn.execute("SELECT hemmalag, bortalag, avspark FROM matcher WHERE avspark IS NOT NULL"):
        kupong[parse_iso(avspark).date().isoformat()].append((h, b))

    per_match: Dict[int, Dict[str, tuple]] = defaultdict(dict)
    rader: Dict[int, tuple] = {}
    for kalla, kod, hemma, borta, datum, tecken in conn.execute(
            "SELECT kalla, liga_kod, hemmalag, bortalag, datum, tecken FROM sidotips WHERE tecken IS NOT NULL"):
        d = date.fromisoformat(datum)
        kandidater = [m for dd in (-1, 0, 1) for m in matcher.get((kod, (d + timedelta(days=dd)).isoformat()), [])]
        bast = max(kandidater, key=lambda m: _samma(hemma, borta, m[3], m[4]), default=None)
        if bast is None or _samma(hemma, borta, bast[3], bast[4]) < MIN_LIKHET:
            continue
        rader[bast[0]] = bast
        per_match[bast[0]][kalla] = ensemble.pseudosannolikhet(tecken)

    ut = []
    for mid, kallor in per_match.items():
        _, kod, datum, hemma, borta, res, p1, px, p2 = rader[mid]
        d = date.fromisoformat(datum)
        if any(_samma(hemma, borta, h, b) >= MIN_LIKHET
               for dd in (-1, 0, 1) for h, b in kupong.get((d + timedelta(days=dd)).isoformat(), [])):
            continue
        ut.append((datum, ensemble.Observation({"odds": (p1, px, p2), **kallor}, res)))
    return sorted(ut, key=lambda x: x[0])


def uppdatera(conn: sqlite3.Connection) -> dict:
    tips = samla_tips(conn)
    nya = samla_resultat(conn)
    return {"artiklar": tips, "resultat": nya}
