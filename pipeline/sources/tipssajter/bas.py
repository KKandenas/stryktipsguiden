from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from ...modeller import Match


@dataclass
class Artikel:
    url: str
    titel: str
    matchnr: Optional[List[int]] = None   # None = artikeln gäller hela kupongen


class Tipssajt:
    namn = ""
    url = ""
    sprak = ""

    def hitta_artiklar(self, matcher: List[Match], spelstopp: str) -> List[Artikel]:
        """Artiklar med tips för kupongens matcher. spelstopp är UTC ISO."""
        raise NotImplementedError

    def kontrollera(self, text: str, artikel: Artikel, matcher: List[Match]) -> bool:
        """Efter hämtning: gäller artikeln verkligen den här omgången? (t.ex. datumkontroll)"""
        return True
