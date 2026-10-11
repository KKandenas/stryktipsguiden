"""Dataklasser som källorna returnerar och lagringen tar emot.

Källmoduler tolkar och validerar; de rör aldrig databasen. Lagringen (lagring.py) rör aldrig nätverket.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


class ValideringsFel(ValueError):
    """Data från en källa ser trasig ut och ska inte sparas."""


@dataclass
class Match:
    matchnr: int
    hemmalag: str
    bortalag: str
    liga: Optional[str]
    land: Optional[str]
    avspark: Optional[str]          # UTC
    svs_match_id: Optional[int] = None
    installd: bool = False


@dataclass
class Streck:
    matchnr: int
    tidpunkt: str                   # UTC
    p1: float
    px: float
    p2: float


@dataclass
class Odds:
    matchnr: int
    tidpunkt: str                   # UTC
    bolag: str
    o1: float
    ox: float
    o2: float


@dataclass
class Tips:
    matchnr: int
    kalla: str
    tidpunkt: str
    tecken: Optional[str]
    p1: Optional[float] = None
    px: Optional[float] = None
    p2: Optional[float] = None
    sammanfattning: Optional[str] = None
    system: Optional[str] = None            # tecknen i skribentens system/kupong, t.ex. "1X"
    system_rader: Optional[int] = None      # systemets storlek (antal rader)


@dataclass
class Kupong:
    omgang_id: int
    spelstopp: str                  # UTC
    datum: str                      # svenskt datum för spelstoppet
    status: str
    omsattning: Optional[float]
    matcher: List[Match]
    streck: List[Streck] = field(default_factory=list)
    odds: List[Odds] = field(default_factory=list)
    tips: List[Tips] = field(default_factory=list)


@dataclass
class MatchResultat:
    matchnr: int
    resultat: str                   # '1', 'X' eller '2'
    mal_hemma: Optional[int]
    mal_borta: Optional[int]
    installd: bool


@dataclass
class Resultat:
    omgang_id: int
    matcher: List[MatchResultat]
    utdelning: Dict[int, float]     # antal rätt -> kronor per rad
    vinnare: Dict[int, int]         # antal rätt -> antal vinnande rader
    installd: bool = False          # hela omgången inställd: inga resultat, ingen utdelning
