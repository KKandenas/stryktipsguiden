"""Tipssajter. Varje sajt är en klass som hittar artiklar för en omgång; AI-modellen tolkar dem sedan.

Lägg till en sajt:
1. Skapa en fil här med en subklass av Tipssajt som implementerar hitta_artiklar().
2. Lägg en instans i SAJTER nedan.
3. Kolla robots.txt och sajtens villkor först. Sajter med bot-skydd (Cloudflare m.fl.) hoppas över.
Källan läggs automatiskt in i tabellen kallor första gången den används.
"""
from .bas import Artikel, Tipssajt
from .speltips import Speltips
from .sportsgambler import Sportsgambler

SAJTER = [Speltips(), Sportsgambler()]

__all__ = ["Artikel", "Tipssajt", "SAJTER"]
