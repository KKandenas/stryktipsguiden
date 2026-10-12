"""Ligatabeller och tränarbyten från Wikipedias säsongsartiklar (för Lagkoll).

Vanliga artikelsidor (/wiki/...) hämtas via webb.hamta_sida, som respekterar robots.txt och cachar.
Wikipedias API-sökvägar (/w/, /api/) är spärrade i robots.txt och används inte.
Innehållet är CC BY-SA – vi sparar bara siffrorna och visar källan i appen.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from html.parser import HTMLParser
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote

from ..webb import hamta_sida

log = logging.getLogger(__name__)

# (land, liga) -> (språk, titelmall). {s} = "2026–27" (höst–vår), {y} = "2026" (kalenderår).
SIDOR: Dict[Tuple[str, str], Tuple[str, str]] = {
    ("England", "Premier League"): ("en", "{s} Premier League"),
    ("England", "Championship"): ("en", "{s} EFL Championship"),
    ("England", "League One"): ("en", "{s} EFL League One"),
    ("England", "League Two"): ("en", "{s} EFL League Two"),
    ("Skottland", "Premiership"): ("en", "{s} Scottish Premiership"),
    ("Sverige", "Allsvenskan"): ("sv", "Fotbollsallsvenskan {y}"),
    ("Sverige", "Superettan"): ("sv", "Superettan {y}"),
    ("Norge", "Eliteserien"): ("en", "{y} Eliteserien"),
}
KALENDERAR = {"Sverige", "Norge"}

# Kolumnrubriker (engelska och svenska Wikipedia) -> fält
KOLUMNER = {
    "plats": {"pos", "plac", "pl", "#"},
    "lag": {"team", "lag", "klubb"},
    "spelade": {"pld", "s", "m", "sp", "spm"},
    "vunna": {"w", "v"},
    "oavgjorda": {"d", "o"},
    "forlorade": {"l", "f"},
    "gjorda": {"gf", "gm"},
    "inslappta": {"ga", "im"},
    "poang": {"pts", "p", "poäng"},
}


def url(land: str, liga: str, datum: datetime) -> Optional[str]:
    sida = SIDOR.get((land, liga))
    if not sida:
        return None
    sprak, mall = sida
    if land in KALENDERAR:
        titel = mall.format(y=datum.year)
    else:
        start = datum.year if datum.month >= 7 else datum.year - 1
        titel = mall.format(s=f"{start}–{str(start + 1)[2:]}")
    return f"https://{sprak}.wikipedia.org/wiki/{quote(titel.replace(' ', '_'))}"


TOMMA = {"br", "img", "meta", "link", "hr", "input", "wbr", "col", "source", "area", "base"}


class _Tabeller(HTMLParser):
    """Alla <table> som listor av rader, varje rad en lista av cellers text.

    Fotnoter (<sup>), stil, skript och dolda element (display:none, t.ex. sorteringsnycklar) tas bort."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tabeller: List[List[List[str]]] = []
        self._stack: List[List[List[str]]] = []
        self._cell: Optional[List[str]] = None
        self._djup = 0
        self._dold_fran: Optional[int] = None    # djupet där ett dolt element började

    def handle_starttag(self, tag, attrs):
        if tag in TOMMA:
            return
        self._djup += 1
        stil = (dict(attrs).get("style") or "").replace(" ", "")
        if self._dold_fran is None and (tag in ("sup", "style", "script") or "display:none" in stil):
            self._dold_fran = self._djup
        if tag == "table":
            self._stack.append([])
        elif tag == "tr" and self._stack:
            self._stack[-1].append([])
        elif tag in ("td", "th") and self._stack and self._stack[-1]:
            self._cell = []

    def handle_endtag(self, tag):
        if tag in TOMMA:
            return
        if tag == "table" and self._stack:
            self.tabeller.append(self._stack.pop())
        elif tag in ("td", "th") and self._cell is not None and self._stack and self._stack[-1]:
            self._stack[-1][-1].append(re.sub(r"\s+", " ", "".join(self._cell)).strip())
            self._cell = None
        if self._dold_fran is not None and self._djup <= self._dold_fran:
            self._dold_fran = None
        self._djup = max(0, self._djup - 1)

    def handle_data(self, data):
        if self._cell is not None and self._dold_fran is None:
            self._cell.append(data)


def _heltal(s: str) -> Optional[int]:
    m = re.match(r"^[+−–-]?\d+", s.replace("−", "-"))
    return int(m.group(0).replace("−", "-").replace("–", "-")) if m else None


def tolka_tabell(html: str) -> List[dict]:
    """Ligatabellen: den första tabellen med kolumner för lag, spelade och poäng."""
    p = _Tabeller()
    p.feed(html)
    for tabell in p.tabeller:
        for i, rubrik in enumerate(tabell[:3]):
            namn = [c.lower().strip(" .") for c in rubrik]
            index = {}
            for falt, alias in KOLUMNER.items():
                for j, c in enumerate(namn):
                    if c in alias and falt not in index and j not in index.values():
                        index[falt] = j
                        break
            if not {"lag", "spelade", "poang", "vunna"} <= index.keys():
                continue
            rader = []
            for rad in tabell[i + 1:]:
                if len(rad) < len(namn) - 1:
                    continue
                # Celler som delas mellan rader (rowspan) saknas i de senare raderna: oftast sista
                # kolumnen (kvalificering), ibland den första (delad placering).
                skift = 0 if index.get("plats") == 0 and _heltal(rad[0]) is not None else len(namn) - len(rad)
                hamta = lambda f: rad[index[f] - skift] if f in index and 0 <= index[f] - skift < len(rad) else ""
                lag = re.sub(r"\s*\((?:[A-Z]|[a-z]{1,3})\)$", "", hamta("lag")).strip()
                sp, pts = _heltal(hamta("spelade")), _heltal(hamta("poang"))
                if not lag or sp is None or pts is None:
                    continue
                rader.append({"plats": _heltal(hamta("plats")) or len(rader) + 1, "lag": lag, "spelade": sp,
                              "vunna": _heltal(hamta("vunna")), "oavgjorda": _heltal(hamta("oavgjorda")),
                              "forlorade": _heltal(hamta("forlorade")), "gjorda": _heltal(hamta("gjorda")),
                              "inslappta": _heltal(hamta("inslappta")), "poang": pts})
            if len(rader) >= 8:
                return rader
    return []


def tolka_tranarbyten(html: str) -> List[dict]:
    """Rader ur tabellen över tränarbyten (engelska Wikipedia): lag, avgående, datum, tillträdande."""
    p = _Tabeller()
    p.feed(html)
    for tabell in p.tabeller:
        if not tabell:
            continue
        rubrik = [c.lower() for c in tabell[0]]
        if not any("outgoing" in c for c in rubrik) or not any("incoming" in c for c in rubrik):
            continue
        ut = []
        for rad in tabell[1:]:
            if len(rad) != len(rubrik):
                continue
            d = dict(zip(rubrik, rad))
            hitta = lambda ord_: next((v for k, v in d.items() if ord_ in k), "")
            ut.append({"lag": hitta("team"), "avgaende": hitta("outgoing"), "satt": hitta("manner"),
                       "ledigt": hitta("vacancy"), "tilltradande": hitta("incoming"),
                       "tilltradde": hitta("appointment")})
        return ut
    return []


def hamta_liga(land: str, liga: str, datum: datetime) -> Tuple[Optional[str], List[dict], List[dict]]:
    """(url, tabell, tränarbyten). Kastar HamtningsFel om sidan inte går att hämta."""
    u = url(land, liga, datum)
    if not u:
        return None, [], []
    html = hamta_sida(u, max_alder_h=6)
    return u, tolka_tabell(html), tolka_tranarbyten(html)
