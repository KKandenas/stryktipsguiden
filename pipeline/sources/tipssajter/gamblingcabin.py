"""gamblingcabin.se – "Panelens spikar & drag på Stryktipset": några experters spikar och drag.

Tar bara upp några av matcherna. Senaste panelen länkas från https://gamblingcabin.se/speltips/ och
publiceringsdatumet ("Publicerad: 9 oktober, 2026") måste ligga veckan före spelstopp."""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import List

from ...http import HamtningsFel
from ...tid import STOCKHOLM, parse_iso
from ...webb import hamta_sida
from .bas import Artikel, Tipssajt
from .hurbra import MANADER

log = logging.getLogger(__name__)

LISTA = "https://gamblingcabin.se/speltips/"
PANEL = re.compile(r'href="(https://gamblingcabin\.se/speltips/panelens-spikar-drag-pa-stryktipset[^"]*)"')
PUBLICERAD = re.compile(r"Publicerad:\s*(\d{1,2}) (" + "|".join(MANADER) + r"),? (\d{4})", re.I)


def publicerad(text: str):
    t = PUBLICERAD.search(text)
    if not t:
        return None
    return datetime(int(t.group(3)), MANADER.index(t.group(2).lower()) + 1, int(t.group(1)))


class Gamblingcabin(Tipssajt):
    namn = "gamblingcabin.se"
    url = "https://gamblingcabin.se"
    sprak = "sv"

    def __init__(self):
        self._spelstopp = None

    def hitta_artiklar(self, matcher, spelstopp) -> List[Artikel]:
        self._spelstopp = spelstopp
        try:
            lankar = PANEL.findall(hamta_sida(LISTA, max_alder_h=3))
        except HamtningsFel as e:
            log.warning("gamblingcabin.se: %s", e)
            return []
        return [Artikel(lankar[0], "Gamblingcabin: Panelens spikar & drag")] if lankar else []

    def kontrollera(self, text, artikel, matcher) -> bool:
        datum = publicerad(text)
        if datum is None or self._spelstopp is None:
            return False
        stopp = parse_iso(self._spelstopp).astimezone(STOCKHOLM).replace(tzinfo=None)
        return stopp - timedelta(days=7) <= datum <= stopp
