"""Tipssajter. Varje sajt är en klass som hittar artiklar för en omgång; AI-modellen tolkar dem sedan.

Lägg till en sajt:
1. Skapa en fil här med en subklass av Tipssajt som implementerar hitta_artiklar() (och vid behov
   kontrollera(), t.ex. datumkoll när adressen saknar datum).
2. Lägg en instans i SAJTER nedan och namnet i modeller.TIPSKALLOR och ensemble.KALLOR.
3. Kolla robots.txt och sajtens villkor först. Sajter med bot-skydd (Cloudflare m.fl.) eller som
   spärrar AI-tjänster hoppas över.
Källan läggs automatiskt in i tabellen kallor första gången den används.
"""
from .bas import Artikel, Tipssajt
from .bettingstugan import Bettingstugan
from .footballpredictions import Footballpredictions
from .gamblingcabin import Gamblingcabin
from .hurbra import Hurbra
from .speltips import Speltips
from .sportsgambler import Sportsgambler
from .sportsmole import Sportsmole
from .tippat import Tippat

SAJTER = [Speltips(), Hurbra(), Bettingstugan(), Tippat(), Gamblingcabin(), Sportsgambler(), Sportsmole(),
          Footballpredictions()]

__all__ = ["Artikel", "Tipssajt", "SAJTER"]
