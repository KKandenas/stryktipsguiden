"""sportsgambler.com – en förhandsartikel per match, listade på ligasidor.

Länkarna har formen /betting-tips/football/<hemma>-vs-<borta>-prediction-lineups-odds-<YYYY-MM-DD>/
så de kan paras med kupongens matcher på lagnamn och datum."""
from __future__ import annotations

import logging
import re
from typing import Dict, List, Optional, Tuple

from ...http import HamtningsFel
from ...lagnamn import likhet
from ...modeller import Match
from ...tid import parse_iso
from ...webb import hamta_sida
from .bas import Artikel, Tipssajt

log = logging.getLogger(__name__)

BAS = "https://www.sportsgambler.com"
LANK = re.compile(r'href="(/betting-tips/football/([a-z0-9-]+?)-vs-([a-z0-9-]+?)-prediction-lineups-odds-(\d{4}-\d{2}-\d{2})/)"')
MIN_LIKHET = 0.75

# (land, liga) enligt Svenska Spel -> sportsgamblers ligasida. Okända ligor letas på översiktssidan.
LIGASIDOR = {
    ("England", "Premier League"): "premier-league",
    ("England", "Championship"): "championship",
    ("England", "League One"): "league-one",
    ("England", "League Two"): "league-two",
    ("Sverige", "Allsvenskan"): "allsvenskan",
    ("Tyskland", "Bundesliga"): "bundesliga",
    ("Spanien", "La Liga"): "la-liga",
    ("Italien", "Serie A"): "serie-a",
    ("Frankrike", "Ligue 1"): "ligue-1",
    ("Skottland", "Premiership"): "scottish-premiership",
}


class Sportsgambler(Tipssajt):
    namn = "sportsgambler.com"
    url = BAS
    sprak = "en"

    def hitta_artiklar(self, matcher, spelstopp) -> List[Artikel]:
        sidor = {f"{BAS}/betting-tips/football/"}
        for m in matcher:
            slug = LIGASIDOR.get((m.land, m.liga))
            if slug:
                sidor.add(f"{BAS}/betting-tips/football/{slug}-predictions/")
        lankar: List[Tuple[str, str, str, str]] = []
        for sida in sorted(sidor):
            try:
                lankar += LANK.findall(hamta_sida(sida, max_alder_h=3))
            except HamtningsFel as e:
                log.warning("sportsgambler.com: %s", e)
        return para_ihop(matcher, lankar)


def _lag(slug: str) -> str:
    return slug.replace("-", " ")


def para_ihop(matcher: List[Match], lankar, bas: str = BAS, kalla: str = "") -> List[Artikel]:
    """Para kupongens matcher med förhandsartiklar (samma datum ±1 dag, båda lagen lika).
    lankar: (sökväg, hemma-slug, borta-slug, "YYYY-MM-DD"). Används även av andra sajter med datum i adressen."""
    unika = {l[0]: l for l in lankar}
    artiklar = []
    for m in matcher:
        if not m.avspark:
            continue
        dag = parse_iso(m.avspark).date()
        bast: Optional[Tuple[float, str, str]] = None
        for sokvag, hemma, borta, datum in unika.values():
            if abs((parse_iso(datum + "T12:00:00+00:00").date() - dag).days) > 1:
                continue
            poang = min(likhet(m.hemmalag, _lag(hemma)), likhet(m.bortalag, _lag(borta)))
            if poang >= MIN_LIKHET and (bast is None or poang > bast[0]):
                bast = (poang, sokvag, f"{kalla}{_lag(hemma).title()} vs {_lag(borta).title()}")
        if bast:
            artiklar.append(Artikel(bas + bast[1], bast[2], [m.matchnr]))
    return artiklar
