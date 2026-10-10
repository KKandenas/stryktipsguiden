"""Fas 5: ensemble-modellen, walk-forward, statistik och modellval – på syntetisk data med känt facit."""
import random

import pytest

from pipeline import export
from pipeline.model import ensemble as E
from pipeline.model import statistik
from pipeline.model.modeller import berakna_prognoser, vald_version


def test_pseudosannolikhet():
    assert E.pseudosannolikhet("1") == pytest.approx((0.8, 0.1, 0.1))
    assert E.pseudosannolikhet("1X") == pytest.approx((0.4, 0.4, 0.2))
    assert E.pseudosannolikhet("1X2") == pytest.approx((1 / 3, 1 / 3, 1 / 3))


def _dra(rng, p):
    r = rng.random()
    return "1" if r < p[0] else "X" if r < p[0] + p[1] else "2"


def _slump_p(rng):
    a = [rng.uniform(0.2, 3) for _ in range(3)]
    return tuple(x / sum(a) for x in a)


def test_anpassa_hittar_ratt_vikter():
    rng = random.Random(1)
    data = []
    for _ in range(1500):
        p = _slump_p(rng)
        data.append(E.Observation({"odds": p}, _dra(rng, p)))
    v = E.anpassa(data)
    assert v.w["odds"] == pytest.approx(1.0, abs=0.15)      # oddsen är facit → vikt ≈ 1
    assert abs(v.a[1]) < 0.1 and abs(v.a[2]) < 0.1


def test_kalla_som_saknas_paverkar_inte_och_fa_obs_utesluts():
    rng = random.Random(2)
    data = [E.Observation({"odds": (p := _slump_p(rng))}, _dra(rng, p)) for _ in range(600)]
    data += [E.Observation({"odds": (p := _slump_p(rng)), "speltips.se": (0.8, 0.1, 0.1)}, _dra(rng, p))
             for _ in range(50)]   # under MIN_OBS
    v = E.anpassa(data)
    assert "speltips.se" not in v.w
    o = E.Observation({"odds": (0.5, 0.3, 0.2)})
    assert E.prognos(v, o) == pytest.approx(E.prognos(v, E.Observation({"odds": (0.5, 0.3, 0.2), "okänd": (1, 0, 0)})))


def fyll_syntetiskt(conn, n_omgangar=60, facit="odds", seed=3):
    """Omgångar med odds och streck. facit='odds': utfall dras från oddsen;
    facit='streck': strecken vet mer än oddsen (oddsen är brusiga)."""
    rng = random.Random(seed)
    for i in range(n_omgangar):
        oid = 5000 + i
        stopp = f"2024-{1 + i // 28:02d}-{1 + i % 28:02d}T14:59:00Z"
        conn.execute("INSERT INTO omgangar (id, datum, spelstopp, utdelning_13, utdelning_12, utdelning_11, utdelning_10) "
                     "VALUES (?, ?, ?, 1000, 100, 10, 1)", (oid, stopp[:10], stopp))
        for nr in range(1, 14):
            sann = _slump_p(rng)
            if facit == "odds":
                odds_p, streck_p = sann, _slump_p(rng)
            else:
                brus = _slump_p(rng)
                odds_p = tuple(0.5 * a + 0.5 * b for a, b in zip(sann, brus))
                streck_p = sann
            mid = conn.execute("INSERT INTO matcher (omgang_id, matchnr, hemmalag, bortalag, liga, resultat) "
                               "VALUES (?, ?, 'A', 'B', 'Testliga', ?)", (oid, nr, _dra(rng, sann))).lastrowid
            conn.execute("INSERT INTO odds VALUES (?, ?, 'bolag', ?, ?, ?)",
                         (mid, "2024-01-01T00:00:00Z", *(1 / x for x in odds_p)))
            conn.execute("INSERT INTO streck VALUES (?, ?, ?, ?, ?)",
                         (mid, stopp, *(round(100 * x, 1) for x in streck_p)))
    conn.commit()
    berakna_prognoser(conn)


def test_walk_forward_ar_arligt_och_odds_behalls_nar_de_ar_facit(conn):
    fyll_syntetiskt(conn, facit="odds")
    r = statistik.kor(conn)
    # Första ensemble-prognosen kommer först när ≥ MIN_TRANING matcher finns före omgången
    forsta = conn.execute("""SELECT MIN(m.omgang_id) FROM prognoser p JOIN matcher m ON m.id = p.match_id
                             WHERE p.modellversion = 'ensemble-v1'""").fetchone()[0]
    assert (forsta - 5000) * 13 >= statistik.MIN_TRANING
    assert r["aktiv"] == "odds-v2" and vald_version(conn) == "odds-v2"
    assert conn.execute("SELECT COUNT(*) FROM modellstatistik WHERE liga = 'Alla'").fetchone()[0] == 3  # odds-v2, ensemble, tips
    folket = conn.execute("""SELECT s.antal_matcher, s.traff FROM kallstatistik s JOIN kallor k ON k.id = s.kalla_id
                             WHERE k.namn = 'Svenska folket' AND s.liga = 'Alla'""").fetchone()
    assert folket[0] == 60 * 13 and 0 < folket[1] < 1
    assert statistik.behover_koras(conn) is False


def test_ensemble_valjs_nar_strecken_vet_mer(conn, monkeypatch):
    monkeypatch.setattr(statistik, "JAMFOR_SENASTE", 260)
    fyll_syntetiskt(conn, n_omgangar=70, facit="streck", seed=4)
    r = statistik.kor(conn)
    assert r["aktiv"] == "ensemble-v1"
    assert r["vikter"]["w"]["streck"] > 0.5
    k = export.bygg_kupong(conn, 5069, nu="2025-01-01T00:00:00Z")
    assert k["modell"]["version"] == "ensemble-v1"
    st = k["statistik"]
    assert st["aktiv_modell"] == "ensemble-v1"
    assert {m["version"] for m in st["modeller"]} == {"odds-v2", "ensemble-v1", "tips-v1"}
    assert len(st["senaste"]) == 10 and 0 <= st["senaste"][0]["modell_ratt"] <= 13


def test_tips_v1_ger_mer_vikt_at_tipsare_som_vet_mer(conn):
    """En tipsare som ser det sanna utfallet bättre än oddsen ska få vikt över startvikten."""
    from pipeline import lagring
    from pipeline.model.modeller import STARTVIKT_TIPS
    fyll_syntetiskt(conn, n_omgangar=70, facit="streck", seed=5)   # oddsen är brusiga
    kid = lagring.kalla_id(conn, "speltips.se")
    rng = random.Random(6)
    for mid, s1, sx, s2, res in conn.execute(
            "SELECT m.id, s.p1, s.px, s.p2, m.resultat FROM matcher m JOIN streck s ON s.match_id = m.id").fetchall():
        sann = (s1 / 100, sx / 100, s2 / 100)            # i testdatan är strecken de sanna sannolikheterna
        tecken = max(zip(sann, "1X2"))[1] if rng.random() < 0.7 else res
        conn.execute("INSERT INTO tips (match_id, kalla_id, tidpunkt, tecken) VALUES (?, ?, '2024-01-01T00:00:00Z', ?)",
                     (mid, kid, tecken))
    conn.commit()
    r = statistik.kor(conn)
    assert r["tipsvikter"]["w"]["speltips.se"] > STARTVIKT_TIPS
    assert "streck" not in r["tipsvikter"]["w"]
    st = {m["version"]: m for m in export.bygg_kupong(conn, 5069, nu="2025-01-01T00:00:00Z")["statistik"]["modeller"]}
    assert st["tips-v1"]["logloss"] < st["odds-v2"]["logloss"]
