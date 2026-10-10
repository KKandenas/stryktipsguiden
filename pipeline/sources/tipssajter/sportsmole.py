"""sportsmole.co.uk – en förhandsartikel per match med "We say: Lag A 2-1 Lag B".

Länkarna saknar datum (…/blackburn-vs-cardiff-prediction-team-news-lineups_606461.html), så
artikelns eget avsparksdatum kontrolleras efter hämtning (kontrollera())."""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import List, Optional, Tuple

from ...http import HamtningsFel
from ...lagnamn import likhet
from ...modeller import Match
from ...tid import parse_iso
from ...webb import hamta_sida
from .bas import Artikel, Tipssajt

log = logging.getLogger(__name__)

BAS = "https://www.sportsmole.co.uk"
LANK = re.compile(r'href="(/football/[a-z0-9-]+/preview/([a-z0-9-]+?)-vs-([a-z0-9-]+?)'
                  r'-prediction-team-news-lineups_\d+\.html)"')
DATUM = re.compile(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\b")
MIN_LIKHET = 0.75

LIGASIDOR = {
    ("England", "Premier League"): "premier-league",
    ("England", "Championship"): "championship",
    ("England", "League One"): "league-one",
    ("England", "League Two"): "league-two",
    ("Skottland", "Premiership"): "scottish-premiership",
    ("Sverige", "Allsvenskan"): "allsvenskan",
    ("Tyskland", "Bundesliga"): "bundesliga",
    ("Spanien", "La Liga"): "la-liga",
    ("Italien", "Serie A"): "serie-a",
    ("Frankrike", "Ligue 1"): "ligue-1",
}


def _lag(slug: str) -> str:
    return slug.replace("-", " ")


def para_ihop(matcher: List[Match], lankar) -> List[Artikel]:
    unika = {l[0]: l for l in lankar}
    artiklar = []
    for m in matcher:
        bast: Optional[Tuple[float, str, str]] = None
        for sokvag, hemma, borta in unika.values():
            poang = min(likhet(m.hemmalag, _lag(hemma)), likhet(m.bortalag, _lag(borta)))
            if poang >= MIN_LIKHET and (bast is None or poang > bast[0]):
                bast = (poang, sokvag, f"Sports Mole: {_lag(hemma).title()} vs {_lag(borta).title()}")
        if bast:
            artiklar.append(Artikel(BAS + bast[1], bast[2], [m.matchnr]))
    return artiklar


def avsparksdatum(text: str) -> Optional[datetime]:
    """Första datumet på sidan ("Oct 10, 2026") är matchens datum i sidhuvudet."""
    t = DATUM.search(text[:3000])
    return datetime.strptime(" ".join(t.groups()), "%b %d %Y") if t else None


class Sportsmole(Tipssajt):
    namn = "sportsmole.co.uk"
    url = BAS
    sprak = "en"

    def hitta_artiklar(self, matcher, spelstopp) -> List[Artikel]:
        sidor = {f"{BAS}/football/preview/"}
        for m in matcher:
            slug = LIGASIDOR.get((m.land, m.liga))
            if slug:
                sidor.add(f"{BAS}/football/{slug}/")
        lankar = []
        for sida in sorted(sidor):
            try:
                lankar += LANK.findall(hamta_sida(sida, max_alder_h=3))
            except HamtningsFel as e:
                log.warning("sportsmole.co.uk: %s", e)
        return para_ihop(matcher, lankar)

    def kontrollera(self, text: str, artikel: Artikel, matcher: List[Match]) -> bool:
        datum = avsparksdatum(text)
        m = next((x for x in matcher if artikel.matchnr and x.matchnr in artikel.matchnr), None)
        if datum is None or m is None or not m.avspark:
            return False
        return abs((datum.date() - parse_iso(m.avspark).date()).days) <= 1
