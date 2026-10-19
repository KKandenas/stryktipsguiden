"""football-data.co.uk – resultat och odds för alla matcher i de stora europeiska ligorna (CSV per liga och säsong).

Används för matcher utanför kupongen (se pipeline/sidomatcher.py). Filen uppdateras ett par gånger i veckan.
Oddsen är snittet över bolagen (AvgH/AvgD/AvgA) före avspark, med marginalen bortplockad proportionellt."""
from __future__ import annotations

import csv
import io
import logging
from datetime import date, datetime
from typing import List, Optional, Tuple

from ..webb import hamta_sida

log = logging.getLogger(__name__)

BAS = "https://www.football-data.co.uk/mmz4281"

# Ligakod hos football-data → (land, liga) som Svenska Spel skriver dem
LIGOR = {
    "E0": ("England", "Premier League"),
    "E1": ("England", "Championship"),
    "E2": ("England", "League One"),
    "E3": ("England", "League Two"),
    "SC0": ("Skottland", "Premiership"),
    "D1": ("Tyskland", "Bundesliga"),
    "SP1": ("Spanien", "La Liga"),
    "I1": ("Italien", "Serie A"),
    "F1": ("Frankrike", "Ligue 1"),
}
KOD = {v: k for k, v in LIGOR.items()}

Rad = Tuple[str, str, str, str, Optional[Tuple[float, float, float]]]   # datum, hemma, borta, resultat, odds


def sasong(d: date) -> str:
    """Säsongen som pågår ett visst datum: 2026-10-19 → "2627" (säsongen börjar i juli)."""
    ar = d.year if d.month >= 7 else d.year - 1
    return f"{ar % 100:02d}{(ar + 1) % 100:02d}"


def _odds(rad: dict) -> Optional[Tuple[float, float, float]]:
    for h, x, b in (("AvgH", "AvgD", "AvgA"), ("B365H", "B365D", "B365A")):
        try:
            o = [float(rad[h]), float(rad[x]), float(rad[b])]
        except (KeyError, TypeError, ValueError):
            continue
        if min(o) > 1:
            inv = [1 / v for v in o]
            s = sum(inv)
            return (inv[0] / s, inv[1] / s, inv[2] / s)
    return None


def tolka(text: str) -> List[Rad]:
    """Spelade matcher ur en CSV-fil. Datum är "14/10/2026" (äldre säsonger "14/10/26")."""
    ut = []
    # BOM först i filen; den kan ha tolkats som latin-1 ("ï»¿") vid hämtningen
    text = text.lstrip("﻿")
    if text.startswith("ï»¿"):
        text = text[3:]
    for rad in csv.DictReader(io.StringIO(text)):
        res = {"H": "1", "D": "X", "A": "2"}.get((rad.get("FTR") or "").strip())
        if not res or not rad.get("HomeTeam") or not rad.get("Date"):
            continue
        d = rad["Date"].strip()
        try:
            datum = datetime.strptime(d, "%d/%m/%Y" if len(d) == 10 else "%d/%m/%y").date().isoformat()
        except ValueError:
            continue
        ut.append((datum, rad["HomeTeam"].strip(), rad["AwayTeam"].strip(), res, _odds(rad)))
    return ut


def hamta(liga_kod: str, sasongskod: str) -> List[Rad]:
    return tolka(hamta_sida(f"{BAS}/{sasongskod}/{liga_kod}.csv", max_alder_h=12))
