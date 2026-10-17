"""rekatochklart.com – "Stryktipset tips" med alla 13 matcher och två färdiga system (lilla och stora).

Adressen innehåller omgångens datum: /tips/stryktipset/stryktipset-tips-17-10/. Den hittas på
listsidan /tips/stryktipset/; finns den inte där än prövas den datumbaserade adressen direkt."""
from __future__ import annotations

import logging
import re
from typing import List

from ...http import HamtningsFel
from ...tid import STOCKHOLM, parse_iso
from ...webb import hamta_sida
from .bas import Artikel, Tipssajt

log = logging.getLogger(__name__)

BAS = "https://www.rekatochklart.com"
LISTA = BAS + "/tips/stryktipset/"


class Rekatochklart(Tipssajt):
    namn = "rekatochklart.com"
    url = BAS
    sprak = "sv"

    def hitta_artiklar(self, matcher, spelstopp) -> List[Artikel]:
        dag = parse_iso(spelstopp).astimezone(STOCKHOLM)
        slug = f"stryktipset-tips-{dag.day:02d}-{dag.month:02d}"
        try:
            lista = hamta_sida(LISTA, max_alder_h=3)
        except HamtningsFel as e:
            log.warning("rekatochklart.com: %s", e)
            return []
        lankar = re.findall(r'href="((?:https://www\.rekatochklart\.com)?/tips/stryktipset/' + slug + r'/?)"', lista)
        if not lankar:
            log.info("rekatochklart.com: ingen artikel för %s än", slug)
            return []
        url = lankar[0] if lankar[0].startswith("http") else BAS + lankar[0]
        return [Artikel(url, f"Rekatochklart: Stryktipset tips {dag.day}/{dag.month}")]
