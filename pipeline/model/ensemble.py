"""Viktning av flera källor med logistisk regression (log-linjär sammanvägning).

För varje match och tecken k:
    poäng_k = a_k + Σ_s w_s · log p_s,k        p = softmax(poäng)
där p_s är källan s sannolikheter. Det är ett viktat geometriskt snitt av källorna plus en
justering per tecken (a_1 = 0). Saknas en källa för en match sätts p_s = (⅓, ⅓, ⅓); då är
log p_s lika för alla tecken och källan påverkar inte just den matchen.

Vikterna skattas med Newtons metod på log loss med L2-straff mot "bara odds" (få parametrar, konvergerar på
några iterationer). Allt i ren Python – inga beroenden.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

Tripel = Tuple[float, float, float]

KALLOR = ["odds", "streck", "Tio tidningars tips", "speltips.se", "hurbra.se", "bettingstugan.se", "tippat.se",
          "gamblingcabin.se", "sportsgambler.com", "sportsmole.co.uk"]
UTFALL = {"1": 0, "X": 1, "2": 2}
GOLV = 0.02          # lägsta sannolikhet per tecken innan log
TECKEN_EPS = 0.2     # tips med bara tecken: 80 % fördelas på valda tecken, 20 % på övriga
MIN_OBS = 200        # en källa vägs in först när den finns för så många träningsmatcher
L2 = 1.0             # straff mot avvikelser från "bara odds" (stabiliserar källor med lite data)


def pseudosannolikhet(tecken: str) -> Tripel:
    """'1' → (0.8, 0.1, 0.1), '1X' → (0.4, 0.4, 0.2), '1X2' → (⅓, ⅓, ⅓)."""
    valda = [t for t in "1X2" if t in tecken]
    if not valda or len(valda) == 3:
        return (1 / 3, 1 / 3, 1 / 3)
    p = [(1 - TECKEN_EPS) / len(valda) if t in valda else TECKEN_EPS / (3 - len(valda)) for t in "1X2"]
    return (p[0], p[1], p[2])


def _logp(p: Optional[Sequence[float]]) -> List[float]:
    if p is None:
        return [math.log(1 / 3)] * 3
    q = [max(x, GOLV) for x in p]
    s = sum(q)
    return [math.log(x / s) for x in q]


@dataclass
class Observation:
    kallor: Dict[str, Tripel]                  # källa → sannolikheter (bara de som finns)
    utfall: Optional[str] = None               # '1'/'X'/'2' för träning


@dataclass
class Vikter:
    a: Tripel = (0.0, 0.0, 0.0)                # justering per tecken (a[0] = 0)
    w: Dict[str, float] = field(default_factory=lambda: {"odds": 1.0})
    antal: int = 0                             # träningsmatcher

    def till_dict(self) -> dict:
        return {"a": list(self.a), "w": self.w, "antal": self.antal}

    @staticmethod
    def fran_dict(d: dict) -> "Vikter":
        return Vikter(tuple(d["a"]), dict(d["w"]), d.get("antal", 0))


def _features(o: Observation, kallor: List[str]) -> List[List[float]]:
    """F[k] = [1{k=X}, 1{k=2}, log p_s1,k, log p_s2,k, …]."""
    loggar = [_logp(o.kallor.get(s)) for s in kallor]
    return [[1.0 if k == 1 else 0.0, 1.0 if k == 2 else 0.0] + [lg[k] for lg in loggar] for k in range(3)]


def _softmax(z: Sequence[float]) -> List[float]:
    m = max(z)
    e = [math.exp(x - m) for x in z]
    s = sum(e)
    return [x / s for x in e]


def _los(A: List[List[float]], b: List[float]) -> List[float]:
    """Lös A x = b med Gauss-elimination (A är liten och positivt definit)."""
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for i in range(n):
        piv = max(range(i, n), key=lambda r: abs(M[r][i]))
        M[i], M[piv] = M[piv], M[i]
        for r in range(i + 1, n):
            f = M[r][i] / M[i][i]
            for c in range(i, n + 1):
                M[r][c] -= f * M[i][c]
    x = [0.0] * n
    for i in reversed(range(n)):
        x[i] = (M[i][n] - sum(M[i][c] * x[c] for c in range(i + 1, n))) / M[i][i]
    return x


def anpassa(data: List[Observation], iterationer: int = 25, kallor_att_prova: Optional[List[str]] = None,
            min_obs: int = MIN_OBS, l2: float = L2, startvikter: Optional[Dict[str, float]] = None) -> Vikter:
    """Skatta vikter. Källor med färre än min_obs träningsmatcher utesluts (vikt 0).

    startvikter: vikten varje källa dras mot (L2-straff) – standard är oddsvikt 1 och övriga 0."""
    startvikter = startvikter or {"odds": 1.0}
    data = [o for o in data if o.utfall in UTFALL]
    kallor = [s for s in (kallor_att_prova or KALLOR) if sum(1 for o in data if s in o.kallor) >= min_obs]
    if not data or not kallor:
        return Vikter(antal=len(data))
    F = [_features(o, kallor) for o in data]
    y = [UTFALL[o.utfall] for o in data]
    P = 2 + len(kallor)
    # Utgångsläge och straff dras mot startvikterna (oftast "bara odds").
    prior = [0.0, 0.0] + [startvikter.get(s, 0.0) for s in kallor]
    theta = prior[:]
    L2_ = l2

    for _ in range(iterationer):
        grad = [-L2_ * (t - p0) for t, p0 in zip(theta, prior)]
        H = [[(L2_ if i == j else 0.0) for j in range(P)] for i in range(P)]
        for Fi, yi in zip(F, y):
            p = _softmax([sum(t * f for t, f in zip(theta, Fi[k])) for k in range(3)])
            medel = [sum(p[k] * Fi[k][j] for k in range(3)) for j in range(P)]
            for j in range(P):
                grad[j] += Fi[yi][j] - medel[j]
            for k in range(3):
                d = [Fi[k][j] - medel[j] for j in range(P)]
                for i in range(P):
                    di = p[k] * d[i]
                    if di:
                        for j in range(P):
                            H[i][j] += di * d[j]
        steg = _los(H, grad)
        theta = [t + s for t, s in zip(theta, steg)]
        if max(abs(s) for s in steg) < 1e-6:
            break
    return Vikter((0.0, theta[0], theta[1]), dict(zip(kallor, theta[2:])), len(data))


def prognos(v: Vikter, o: Observation, extra_vikter: Optional[Dict[str, float]] = None) -> Optional[Tripel]:
    """extra_vikter: vikter för källor som inte skattats ännu (för lite data) – används bara om
    källan saknas i v.w."""
    w_alla = {**(extra_vikter or {}), **v.w}
    if not any(s in o.kallor for s in w_alla):
        return None
    z = [v.a[k] + sum(w * _logp(o.kallor.get(s))[k] for s, w in w_alla.items()) for k in range(3)]
    p = _softmax(z)
    return (p[0], p[1], p[2])


def logloss(p: Sequence[float], utfall: str) -> float:
    return -math.log(max(p[UTFALL[utfall]], 1e-12))
