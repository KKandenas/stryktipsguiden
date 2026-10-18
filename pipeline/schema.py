"""Det planerade uppdateringsschemat, i svensk tid.

GitHubs schemalagda körningar kan bli flera timmar sena eller utebli. Därför startas pipelinen ofta
(varje timme, och tätare på lördagar) med kommandot `planerad`, som bara gör en riktig uppdatering när
en planerad tid nedan har passerats och inte körts än. Övriga starter avslutas direkt utan att anropa
några API:er.
"""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

SVENSK_TID = ZoneInfo("Europe/Stockholm")

# (veckodag, klockslag) i svensk tid; måndag = 0
PLANERADE: List[Tuple[int, str]] = [
    (0, "10:00"),                  # måndag: ny kupong, streck, odds, tips
    (2, "19:00"),                  # onsdag
    (3, "19:00"),                  # torsdag
    (4, "19:00"),                  # fredag: tips som publiceras på fredagen, Lagkoll börjar
    (5, "10:30"), (5, "11:30"), (5, "12:30"),   # lördag förmiddag
    (5, "14:00"), (5, "15:00"), (5, "15:25"),   # lördag fram till spelstopp 15:59
    (5, "16:20"),                  # lördag efter spelstopp: slutstreck
    (5, "19:30"),                  # lördag kväll: resultat och utdelning (Svenska Spel publicerar runt 18–19)
    (6, "10:00"), (6, "20:00"),    # söndag: resultat, utdelning, statistik
]


# Tider i förhållande till omgångens spelstopp. Vissa omgångar stänger på söndagen eller en helgdag; då
# hamnar uppdateringarna före och efter spelstopp ändå rätt. För en vanlig lördag 15:59 sammanfaller de
# med lördagstiderna ovan (10:30, 11:30, 12:30, 14:00, 15:00, 15:25, 16:20 och 19:30).
RELATIVA: List[timedelta] = [timedelta(hours=h, minutes=m) for h, m in
                             [(-5, -29), (-4, -29), (-3, -29), (-1, -59), (0, -59), (0, -34), (0, 21), (3, 31)]]


# Resultatet hämtas också när sista matchen bör vara slut, ifall den spelas efter lördagen (söndag, eller
# natten mot måndag i amerikanska ligor). Svenska Spel publicerar oftast strax efter slutsignalen; det andra
# försöket tar det om publiceringen dröjer.
EFTER_SISTA_MATCHEN = [timedelta(hours=2, minutes=30), timedelta(hours=4, minutes=30)]


def senaste_planerade(nu: datetime, spelstopp: Iterable[datetime] = (),
                      sista_avspark: Iterable[datetime] = ()) -> datetime:
    """Den senaste planerade tiden som har passerat (UTC). spelstopp: kommande och nyligen passerade
    spelstopp, som ger extra tider enligt RELATIVA. sista_avspark: varje omgångs sista avspark, som ger en
    resultathämtning EFTER_SISTA_MATCHEN senare."""
    lokal = nu.astimezone(SVENSK_TID)
    kandidater = []
    for dagar_bakat in range(8):
        dag = (lokal - timedelta(days=dagar_bakat)).date()
        for veckodag, klocka in PLANERADE:
            if dag.weekday() == veckodag:
                h, m = map(int, klocka.split(":"))
                t = datetime.combine(dag, time(h, m), tzinfo=SVENSK_TID)
                if t <= lokal:
                    kandidater.append(t)
    for stopp in spelstopp:
        kandidater += [stopp + d for d in RELATIVA if stopp + d <= nu]
    kandidater += [a + d for a in sista_avspark for d in EFTER_SISTA_MATCHEN if a + d <= nu]
    return max(kandidater).astimezone(timezone.utc)


def forfallen(senast_kord: Optional[str], nu: datetime, spelstopp: Iterable[datetime] = (),
              sista_avspark: Iterable[datetime] = ()) -> Optional[datetime]:
    """Den planerade tid som ska köras nu, eller None om den senaste redan är körd."""
    tid = senaste_planerade(nu, spelstopp, sista_avspark)
    if senast_kord:
        kord = datetime.fromisoformat(senast_kord.replace("Z", "+00:00"))
        if kord >= tid:
            return None
    return tid
