"""hurbra.se – en Stryktipsartikel per omgång med "Tipset: …" för varje match.

Adressen följer spelstoppets datum: https://hurbra.se/stryktipset-10-oktober-2026/"""
from __future__ import annotations

import logging
from typing import List

from ...http import HamtningsFel
from ...tid import STOCKHOLM, parse_iso
from ...webb import hamta_sida
from .bas import Artikel, Tipssajt

log = logging.getLogger(__name__)

MANADER = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september",
           "oktober", "november", "december"]


def adress(spelstopp: str) -> str:
    d = parse_iso(spelstopp).astimezone(STOCKHOLM)
    return f"https://hurbra.se/stryktipset-{d.day}-{MANADER[d.month - 1]}-{d.year}/"


class Hurbra(Tipssajt):
    namn = "hurbra.se"
    url = "https://hurbra.se"
    sprak = "sv"

    def hitta_artiklar(self, matcher, spelstopp) -> List[Artikel]:
        url = adress(spelstopp)
        try:
            hamta_sida(url, max_alder_h=3)       # finns artikeln? (cachas, så den hämtas inte två gånger)
        except HamtningsFel as e:
            log.info("hurbra.se: ingen artikel för omgången ännu (%s)", e)
            return []
        return [Artikel(url, f"hurbra.se: Stryktipset {url.rstrip('/').split('stryktipset-')[1]}")]
