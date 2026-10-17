"""dagensbastaspel.se – "Analyser": spelteoretisk genomgång av Stryktipset (delar av texten är öppen).

Adressen innehåller datumet: /analyser/stryktipset-2026-10-17. Länken hittas på startsidan eller
analyssidan; artikeln gäller hela kupongen men tar ofta bara upp några matcher."""
from __future__ import annotations

import logging
from typing import List

from ...http import HamtningsFel
from ...tid import STOCKHOLM, parse_iso
from ...webb import hamta_sida
from .bas import Artikel, Tipssajt

log = logging.getLogger(__name__)

BAS = "https://dagensbastaspel.se"


class Dagensbastaspel(Tipssajt):
    namn = "dagensbastaspel.se"
    url = BAS
    sprak = "sv"

    def hitta_artiklar(self, matcher, spelstopp) -> List[Artikel]:
        dag = parse_iso(spelstopp).astimezone(STOCKHOLM).date()
        sokvag = f"/analyser/stryktipset-{dag.isoformat()}"
        for lista in (BAS + "/", BAS + "/analyser"):
            try:
                if sokvag in hamta_sida(lista, max_alder_h=3):
                    return [Artikel(BAS + sokvag, f"Dagens Bästa Spel: Stryktipset {dag.day}/{dag.month}")]
            except HamtningsFel as e:
                log.warning("dagensbastaspel.se: %s", e)
        log.info("dagensbastaspel.se: ingen analys för %s än", dag)
        return []
