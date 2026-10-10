"""bettingstugan.se – Stryktipsanalys med tecken per match ("1. Manchester United - Tottenham 1X2").

Flera experter skriver per omgång; huvudanalysen (…/stryktipset-analys-tips-lordag-10-10) används i
första hand. Länkarna hittas på https://bettingstugan.se/stryktipset och har spelstoppets datum."""
from __future__ import annotations

import logging
import re
from typing import List

from ...http import HamtningsFel
from ...tid import STOCKHOLM, parse_iso
from ...webb import hamta_sida
from .bas import Artikel, Tipssajt

log = logging.getLogger(__name__)

BAS = "https://bettingstugan.se"


def valj_lank(html: str, spelstopp: str) -> str | None:
    d = parse_iso(spelstopp).astimezone(STOCKHOLM)
    datum = re.compile(rf"/speltips/stryktipset-[a-z-]*?-{d.day}-{d.month}(?:-\d+)?$")
    lankar = sorted({l for l in re.findall(r'href="(?:https://bettingstugan\.se)?(/speltips/stryktipset-[a-z0-9-]+)"', html)
                     if datum.search(l)})
    if not lankar:
        return None
    analys = [l for l in lankar if "analys" in l and "tidiga" not in l]
    return BAS + (analys or lankar)[0]


class Bettingstugan(Tipssajt):
    namn = "bettingstugan.se"
    url = BAS
    sprak = "sv"

    def hitta_artiklar(self, matcher, spelstopp) -> List[Artikel]:
        try:
            lank = valj_lank(hamta_sida(f"{BAS}/stryktipset", max_alder_h=3), spelstopp)
        except HamtningsFel as e:
            log.warning("bettingstugan.se: %s", e)
            return []
        if not lank:
            log.info("bettingstugan.se: ingen analys för omgången ännu")
            return []
        return [Artikel(lank, f"Bettingstugan: {lank.rsplit('/', 1)[1]}")]
