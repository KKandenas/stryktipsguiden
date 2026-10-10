"""speltips.se – en Stryktipsartikel per omgång med tips på alla 13 matcher. Hittas via RSS."""
from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from datetime import timedelta
from email.utils import parsedate_to_datetime
from typing import List

from ...tid import STOCKHOLM, parse_iso
from ...webb import hamta_sida
from .bas import Artikel, Tipssajt

log = logging.getLogger(__name__)


class Speltips(Tipssajt):
    namn = "speltips.se"
    url = "https://speltips.se"
    sprak = "sv"
    flode = "https://speltips.se/feed/"

    def hitta_artiklar(self, matcher, spelstopp) -> List[Artikel]:
        return valj_artikel(hamta_sida(self.flode, max_alder_h=2), spelstopp)


def valj_artikel(rss: str, spelstopp: str) -> List[Artikel]:
    """Nyaste inlägget som heter 'Stryktipset …', publicerat veckan före spelstopp.
    Står ett datum i rubriken ('Stryktipset 10/10: …') måste det vara spelstoppets datum."""
    stopp = parse_iso(spelstopp)
    lokal = stopp.astimezone(STOCKHOLM)
    kandidater = []
    for item in ET.fromstring(rss.encode("utf-8") if isinstance(rss, str) else rss).iter("item"):
        titel = (item.findtext("title") or "").strip()
        lank = (item.findtext("link") or "").strip()
        if not re.match(r"^Stryktipset\b", titel, re.I) or not lank:
            continue
        try:
            publicerad = parsedate_to_datetime(item.findtext("pubDate") or "")
        except (TypeError, ValueError):
            continue
        if not stopp - timedelta(days=7) <= publicerad <= stopp:
            continue
        datum = re.search(r"\b(\d{1,2})/(\d{1,2})\b", titel)
        if datum and (int(datum.group(1)), int(datum.group(2))) != (lokal.day, lokal.month):
            continue
        kandidater.append((publicerad, Artikel(lank, titel)))
    if not kandidater:
        log.info("speltips.se: ingen Stryktipsartikel för spelstopp %s i flödet", spelstopp)
        return []
    return [max(kandidater, key=lambda k: k[0])[1]]
