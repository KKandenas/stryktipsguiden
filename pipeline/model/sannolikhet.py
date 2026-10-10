"""Odds -> sannolikheter med bookmakerns marginal borträknad.

Två metoder:
- proportionell: dela 1/odds med summan. Enkel, men ger lite för mycket chans åt skrällar.
- potens: hitta k så att (1/o1)^k + (1/ox)^k + (1/o2)^k = 1. Tar mer marginal från
  skrällarna (favorite-longshot bias) och brukar träffa bättre.
"""
from __future__ import annotations

from typing import Iterable, Optional, Sequence, Tuple

Tripel = Tuple[float, float, float]


def marginal(o1: float, ox: float, o2: float) -> float:
    """Bookmakerns marginal, t.ex. 0.05 för 5 %."""
    return 1 / o1 + 1 / ox + 1 / o2 - 1


def proportionell(o1: float, ox: float, o2: float) -> Tripel:
    r = (1 / o1, 1 / ox, 1 / o2)
    s = sum(r)
    return (r[0] / s, r[1] / s, r[2] / s)


def potens(o1: float, ox: float, o2: float, iterationer: int = 60) -> Tripel:
    r = (1 / o1, 1 / ox, 1 / o2)
    if abs(sum(r) - 1) < 1e-12:
        return r
    # sum(r_i^k) är strikt avtagande i k (alla r_i < 1); bisektion på [lo, hi].
    lo, hi = 0.5, 3.0
    for _ in range(iterationer):
        k = (lo + hi) / 2
        if sum(x ** k for x in r) > 1:
            lo = k
        else:
            hi = k
    k = (lo + hi) / 2
    p = [x ** k for x in r]
    s = sum(p)
    return (p[0] / s, p[1] / s, p[2] / s)


METODER = {"proportionell": proportionell, "potens": potens}


def snitt(tripler: Iterable[Sequence[float]]) -> Optional[Tripel]:
    lista = list(tripler)
    if not lista:
        return None
    n = len(lista)
    return (sum(t[0] for t in lista) / n, sum(t[1] for t in lista) / n, sum(t[2] for t in lista) / n)


def varde(chans: Sequence[float], streck_procent: Sequence[float]) -> Tripel:
    """Vår sannolikhet minus streckandelen, per tecken. Positivt = understreckat."""
    return tuple(c - s / 100 for c, s in zip(chans, streck_procent))  # type: ignore[return-value]


def brier(p: Sequence[float], utfall: str) -> float:
    """Brier score för en 1X2-prognos (0 = perfekt, 2 = helt fel)."""
    facit = {"1": (1, 0, 0), "X": (0, 1, 0), "2": (0, 0, 1)}[utfall]
    return sum((pi - fi) ** 2 for pi, fi in zip(p, facit))
