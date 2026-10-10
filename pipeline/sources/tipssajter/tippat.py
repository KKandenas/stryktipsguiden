"""tippat.se – "Sparka & Spring": experten Henriks Stryktipskupong med valda tecken markerade.

Valda tecken är rutor med klassen bg-gray-700 i HTML-koden. De märks upp som [VALT 1] innan sidan
görs om till text, annars syns inte vilka tecken som är valda."""
from __future__ import annotations

import re
from typing import List

from ...tid import STOCKHOLM, parse_iso
from .bas import Artikel, Tipssajt
from .hurbra import MANADER

URL = "https://tippat.se/sparkaochspring/"
VALD = re.compile(r'<div class="[^"]*\bbg-gray-700\b[^"]*">\s*([1X2])\s*</div>')


class Tippat(Tipssajt):
    namn = "tippat.se"
    url = "https://tippat.se"
    sprak = "sv"

    def hitta_artiklar(self, matcher, spelstopp) -> List[Artikel]:
        return [Artikel(URL, "Tippat.se: Sparka & Spring")]

    def forbered_html(self, html: str) -> str:
        return VALD.sub(r" [VALT \1] ", html)

    def kontrollera(self, text, artikel, matcher) -> bool:
        """Sidan uppdateras varje vecka – kupongen ska ha omgångens datum, t.ex. "Lördag 10 oktober"."""
        if not matcher or not matcher[0].avspark:
            return False
        stopp = min(parse_iso(m.avspark) for m in matcher if m.avspark).astimezone(STOCKHOLM)
        return f"{stopp.day} {MANADER[stopp.month - 1]}" in text.lower() and "[VALT" in text
