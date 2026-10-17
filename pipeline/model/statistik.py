"""Lärande från historik (fas 5). Körs när nya resultat kommit in (oftast söndag).

1. Källstatistik: Brier score per källa och liga mot faktiska resultat (tabellen kallstatistik).
   Tips som bara anger tecken räknas om till pseudosannolikheter (se ensemble.pseudosannolikhet).
2. ensemble-v1 tränas walk-forward: varje omgång förutsägs med vikter tränade enbart på tidigare
   omgångar, så backtestet blir ärligt. Prognoserna sparas i prognoser, de senaste vikterna i
   modellvikter.
3. Modellstatistik: Brier, log loss och träffprocent per modellversion och liga, på samma matcher.
4. Modellval: ensemble-v1 blir aktiv bara om den har lägre log loss än basmodellen (odds-v2) på de
   senaste JAMFOR_SENASTE matcherna. Fram till dess: bara odds. odds-v1 mäts också, som jämförelse.
"""
from __future__ import annotations

import json
import logging
import sqlite3
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from ..tid import nu_utc
from . import ensemble
from .modeller import (STARTVIKT_TIPS, TAK_STARTVIKT_TIPS, STANDARD_MODELL, TIPSKALLOR, EnsembleModell, TipsModell,
                       las_underlag, observation, vald_version)
from .sannolikhet import brier

log = logging.getLogger(__name__)

MIN_TRANING = 500          # matcher med odds innan ensemble-v1 börjar förutsäga
OMTRANA_VAR = 4            # omgångar mellan omträningar i walk-forward
JAMFOR_SENASTE = 520       # ≈ 40 omgångar
FOLKET = "Svenska folket"
TECKEN = ("1", "X", "2")


def _avgjorda(conn) -> List[Tuple[int, str, int, str, str, ensemble.Observation]]:
    """(omgång, spelstopp, match_id, liga, resultat, observation) för avgjorda matcher, i tidsordning."""
    ut = []
    for mid, oid, stopp, liga, res in conn.execute(
            """SELECT m.id, m.omgang_id, o.spelstopp, COALESCE(m.liga, 'Okänd'), m.resultat
               FROM matcher m JOIN omgangar o ON o.id = m.omgang_id
               WHERE m.resultat IS NOT NULL AND o.installd = 0 ORDER BY o.spelstopp, m.matchnr"""):
        o = observation(las_underlag(conn, mid, stopp))
        o.utfall = res
        ut.append((oid, stopp, mid, liga, res, o))
    return ut


def _upsert(conn, sql_insert: str, params: tuple) -> int:
    return conn.execute(sql_insert, params).rowcount


# ---------- 1. källstatistik ----------

def kallstatistik(conn, data) -> int:
    summor: Dict[Tuple[str, str], List[Tuple[float, bool]]] = defaultdict(list)
    for _, _, _, liga, res, o in data:
        for kalla, p in o.kallor.items():
            if kalla == "odds":
                continue
            namn = FOLKET if kalla == "streck" else kalla
            varde = (brier(p, res), p[TECKEN.index(res)] >= max(p) - 1e-9)
            summor[(namn, liga)].append(varde)
            summor[(namn, "Alla")].append(varde)
    ids = {r[0]: r[1] for r in conn.execute("SELECT namn, id FROM kallor")}
    from .. import lagring
    for namn, _ in summor:          # systemkällor ("speltips.se (system)") skapas när de först dyker upp
        if namn not in ids and namn.endswith(ensemble.SYSTEM_SUFFIX):
            ids[namn] = lagring.kalla_id(conn, namn)
    nu, andrade = nu_utc(), 0
    with conn:
        for (namn, liga), v in summor.items():
            if namn not in ids:
                continue
            n = len(v)
            andrade += _upsert(conn,
                """INSERT INTO kallstatistik (kalla_id, liga, brier, traff, antal_matcher, uppdaterad)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(kalla_id, liga) DO UPDATE SET brier = excluded.brier, traff = excluded.traff,
                       antal_matcher = excluded.antal_matcher, uppdaterad = excluded.uppdaterad
                   WHERE kallstatistik.antal_matcher IS NOT excluded.antal_matcher
                      OR kallstatistik.brier IS NOT excluded.brier OR kallstatistik.traff IS NOT excluded.traff""",
                (ids[namn], liga, round(sum(b for b, _ in v) / n, 6), round(sum(t for _, t in v) / n, 6), n, nu))
    return andrade


# ---------- 2. walk-forward för ensemble-v1 ----------

def _spara_prognos(conn, match_id: int, version: str, p, nu: str) -> int:
    p = tuple(round(x, 6) for x in p)
    return _upsert(conn,
        """INSERT INTO prognoser (match_id, modellversion, p1, px, p2, skapad) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(match_id, modellversion) DO UPDATE SET
               p1 = excluded.p1, px = excluded.px, p2 = excluded.p2, skapad = excluded.skapad
           WHERE prognoser.p1 != excluded.p1 OR prognoser.px != excluded.px OR prognoser.p2 != excluded.p2""",
        (match_id, version, p[0], p[1], p[2], nu))


# Inställningar per tränad modell: vilka källor, hur få matcher som räcker och hur hårt vikterna
# hålls mot startvikten. tips-v1 får väga in tipsare tidigt (30 matcher) men med starkare straff.
TRANING = {
    EnsembleModell.version: dict(),
    TipsModell.version: dict(kallor_att_prova=["odds"] + TIPSKALLOR, min_obs=30, l2=5.0,
                             startvikter={"odds": 1.0, **{k: STARTVIKT_TIPS for k in TIPSKALLOR}}),
}
EXTRA = {TipsModell.version: {k: STARTVIKT_TIPS for k in TIPSKALLOR}}
EXTRA_TAK = {TipsModell.version: TAK_STARTVIKT_TIPS}


def _utan_streck(o: ensemble.Observation) -> ensemble.Observation:
    return ensemble.Observation({k: v for k, v in o.kallor.items() if k != "streck"}, o.utfall)


def walk_forward(conn, data, version: str = EnsembleModell.version) -> Tuple[int, Optional[ensemble.Vikter]]:
    install = TRANING[version]
    extra, tak = EXTRA.get(version), EXTRA_TAK.get(version)
    if version == TipsModell.version:
        data = [(*rad[:5], _utan_streck(rad[5])) for rad in data]
    omgangar = sorted({(stopp, oid) for oid, stopp, *_ in data})
    per_omgang = defaultdict(list)
    for rad in data:
        per_omgang[rad[0]].append(rad)

    tran: List[ensemble.Observation] = []
    vikter, sedan, nu, sparade = None, OMTRANA_VAR, nu_utc(), 0
    with conn:
        for _, oid in omgangar:
            rader = per_omgang[oid]
            if len(tran) >= MIN_TRANING:
                if vikter is None or sedan >= OMTRANA_VAR:
                    vikter, sedan = ensemble.anpassa(tran, **install), 0
                sedan += 1
                for _, _, mid, _, _, o in rader:
                    if "odds" in o.kallor:
                        sparade += _spara_prognos(conn, mid, version, ensemble.prognos(vikter, o, extra, tak), nu)
            tran += [o for *_, o in rader if "odds" in o.kallor]

        slutlig = ensemble.anpassa(tran, **install) if len(tran) >= MIN_TRANING else None
        if slutlig is not None:
            parametrar = json.dumps(slutlig.till_dict(), sort_keys=True)
            gammal = conn.execute("SELECT parametrar FROM modellvikter WHERE modellversion = ?", (version,)).fetchone()
            if gammal is None or gammal[0] != parametrar:
                conn.execute("""INSERT INTO modellvikter (modellversion, parametrar, antal, tranad) VALUES (?, ?, ?, ?)
                                ON CONFLICT(modellversion) DO UPDATE SET parametrar = excluded.parametrar,
                                    antal = excluded.antal, tranad = excluded.tranad""",
                             (version, parametrar, slutlig.antal, nu))
    return sparade, slutlig


# ---------- 3. modellstatistik ----------

def _prognoser(conn, version: str) -> Dict[int, tuple]:
    return {r[0]: (r[1], r[2], r[3]) for r in conn.execute(
        "SELECT match_id, p1, px, p2 FROM prognoser WHERE modellversion = ?", (version,))}


def modellstatistik(conn, data) -> Dict[str, Dict[str, float]]:
    """Mät alla versioner på matcher där samtliga har prognos. Returnerar totalen per version."""
    versioner = [STANDARD_MODELL, "odds-v1", EnsembleModell.version, TipsModell.version]
    prog = {v: _prognoser(conn, v) for v in versioner}
    versioner = [v for v in versioner if prog[v]]
    gemensamma = [r for r in data if all(r[2] in prog[v] for v in versioner)]
    if not gemensamma:
        return {}
    summor = defaultdict(lambda: [0.0, 0.0, 0, 0])   # brier, logloss, träffar, antal
    for v in versioner:
        for _, _, mid, liga, res, _ in gemensamma:
            p = prog[v][mid]
            for nyckel in ((v, liga), (v, "Alla")):
                s = summor[nyckel]
                s[0] += brier(p, res)
                s[1] += ensemble.logloss(p, res)
                s[2] += TECKEN[max(range(3), key=lambda k: p[k])] == res
                s[3] += 1
    nu = nu_utc()
    with conn:
        for (v, liga), (b, ll, tr, n) in summor.items():
            conn.execute(
                """INSERT INTO modellstatistik (modellversion, liga, brier, logloss, traff, antal, uppdaterad)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(modellversion, liga) DO UPDATE SET brier = excluded.brier, logloss = excluded.logloss,
                       traff = excluded.traff, antal = excluded.antal, uppdaterad = excluded.uppdaterad
                   WHERE modellstatistik.antal IS NOT excluded.antal OR modellstatistik.brier IS NOT excluded.brier""",
                (v, liga, round(b / n, 6), round(ll / n, 6), round(tr / n, 6), n, nu))
    return {v: {"brier": summor[(v, "Alla")][0] / summor[(v, "Alla")][3],
                "logloss": summor[(v, "Alla")][1] / summor[(v, "Alla")][3]} for v in versioner}


# ---------- 4. modellval ----------

def valj_modell(conn, data) -> str:
    ens, bas = _prognoser(conn, EnsembleModell.version), _prognoser(conn, STANDARD_MODELL)
    senaste = [r for r in data if r[2] in ens and r[2] in bas][-JAMFOR_SENASTE:]
    val = STANDARD_MODELL
    if len(senaste) >= JAMFOR_SENASTE:
        ll_ens = sum(ensemble.logloss(ens[r[2]], r[4]) for r in senaste) / len(senaste)
        ll_bas = sum(ensemble.logloss(bas[r[2]], r[4]) for r in senaste) / len(senaste)
        log.info("Modellval: senaste %d matcherna – log loss %s %.4f, %s %.4f", len(senaste),
                 STANDARD_MODELL, ll_bas, EnsembleModell.version, ll_ens)
        if ll_ens < ll_bas:
            val = EnsembleModell.version
    else:
        log.info("Modellval: bara %d jämförbara matcher (behöver %d) – %s gäller", len(senaste), JAMFOR_SENASTE, val)
    if vald_version(conn) != val or conn.execute("SELECT 1 FROM installningar WHERE nyckel = 'aktiv_modell'").fetchone() is None:
        with conn:
            conn.execute("""INSERT INTO installningar (nyckel, varde, uppdaterad) VALUES ('aktiv_modell', ?, ?)
                            ON CONFLICT(nyckel) DO UPDATE SET varde = excluded.varde, uppdaterad = excluded.uppdaterad""",
                         (val, nu_utc()))
    return val


# ---------- allt ----------

def senaste_avgjorda(conn) -> Optional[int]:
    r = conn.execute("SELECT MAX(id) FROM omgangar WHERE utdelning_13 IS NOT NULL AND installd = 0").fetchone()
    return r[0] if r else None


def behover_koras(conn) -> bool:
    r = conn.execute("SELECT varde FROM installningar WHERE nyckel = 'statistik_till_omgang'").fetchone()
    senaste = senaste_avgjorda(conn)
    return senaste is not None and (r is None or int(r[0]) < senaste)


def kor(conn: sqlite3.Connection) -> dict:
    data = _avgjorda(conn)
    k = kallstatistik(conn, data)
    n, vikter = walk_forward(conn, data)
    n_tips, vikter_tips = walk_forward(conn, data, TipsModell.version)
    totalt = modellstatistik(conn, data)
    val = valj_modell(conn, data)
    with conn:
        conn.execute("""INSERT INTO installningar (nyckel, varde, uppdaterad) VALUES ('statistik_till_omgang', ?, ?)
                        ON CONFLICT(nyckel) DO UPDATE SET varde = excluded.varde, uppdaterad = excluded.uppdaterad""",
                     (str(senaste_avgjorda(conn) or 0), nu_utc()))
    return {"matcher": len(data), "kallstatistik": k, "ensemble_prognoser": n,
            "vikter": vikter.till_dict() if vikter else None, "modeller": totalt, "aktiv": val,
            "tips_prognoser": n_tips, "tipsvikter": vikter_tips.till_dict() if vikter_tips else None}
