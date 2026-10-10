"""footballpredictions.com – en förhandsartikel per match ("Our prediction for this match: A 2 - 1 B").

Länkarna har datum: /footballpredictions/championshippredictions/blackburn-rovers-vs-cardiff-prediction-10-10-2026/"""
from __future__ import annotations

import logging
import re
from typing import List

from ...http import HamtningsFel
from ...webb import hamta_sida
from .bas import Artikel, Tipssajt
from .sportsgambler import para_ihop

log = logging.getLogger(__name__)

BAS = "https://footballpredictions.com"
LANK = re.compile(r'href="(?:https://footballpredictions\.com)?(/footballpredictions/[a-z0-9-]+/'
                  r'([a-z0-9-]+?)-vs-([a-z0-9-]+?)-prediction-(\d{1,2})-(\d{1,2})-(\d{4})/?)"')

LIGASIDOR = {
    ("England", "Premier League"): "premierleaguepredictions",
    ("England", "Championship"): "championshippredictions",
    ("Tyskland", "Bundesliga"): "bundesligapredictions",
    ("Italien", "Serie A"): "serieapredictions",
    ("Frankrike", "Ligue 1"): "ligue1predictions",
}


class Footballpredictions(Tipssajt):
    namn = "footballpredictions.com"
    url = BAS
    sprak = "en"

    def hitta_artiklar(self, matcher, spelstopp) -> List[Artikel]:
        sidor = sorted({LIGASIDOR[(m.land, m.liga)] for m in matcher if (m.land, m.liga) in LIGASIDOR})
        lankar = []
        for slug in sidor:
            try:
                html = hamta_sida(f"{BAS}/footballpredictions/{slug}/", max_alder_h=3)
            except HamtningsFel as e:
                log.warning("footballpredictions.com: %s", e)
                continue
            for sokvag, hemma, borta, d, mn, y in LANK.findall(html):
                lankar.append((sokvag, hemma, borta, f"{y}-{int(mn):02d}-{int(d):02d}"))
        return para_ihop(matcher, lankar, bas=BAS, kalla="footballpredictions: ")
