"""tipsmedoss.com – "Stryktipset DD-MM analys, spelförslag och tips till alla matcher".

Listan finns på /category/stryktipsforslag/ och adressen innehåller omgångens datum (…/stryktipset-17-10-…)."""
from __future__ import annotations

import logging
import re
from typing import List

from ...http import HamtningsFel
from ...tid import STOCKHOLM, parse_iso
from ...webb import hamta_sida
from .bas import Artikel, Tipssajt

log = logging.getLogger(__name__)

LISTA = "https://tipsmedoss.com/category/stryktipsforslag/"


class Tipsmedoss(Tipssajt):
    namn = "tipsmedoss.com"
    url = "https://tipsmedoss.com"
    sprak = "sv"

    def hitta_artiklar(self, matcher, spelstopp) -> List[Artikel]:
        dag = parse_iso(spelstopp).astimezone(STOCKHOLM)
        try:
            lista = hamta_sida(LISTA, max_alder_h=3)
        except HamtningsFel as e:
            log.warning("tipsmedoss.com: %s", e)
            return []
        monster = (r'href="(https://tipsmedoss\.com/\d{4}/stryktipsforslag/stryktipset-'
                   f"{dag.day:02d}-{dag.month:02d}" r'[^"]*)"')
        lankar = re.findall(monster, lista)
        if not lankar:
            log.info("tipsmedoss.com: ingen artikel för %02d-%02d än", dag.day, dag.month)
            return []
        return [Artikel(lankar[0], f"Tipsmedoss: Stryktipset {dag.day}/{dag.month}")]
