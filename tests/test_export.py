import json

from pipeline import export, lagring
from pipeline.model.modeller import berakna_prognoser
from pipeline.modeller import Odds
from pipeline.sources.svenskaspel import tolka_kupong, tolka_resultat
from tests.conftest import las_fixture

INNAN = "2026-10-10T13:30:00Z"   # före spelstopp 13:59Z (fixturens streck är från 14:00:01Z)


def fyll(conn):
    lagring.spara_kupong(conn, tolka_kupong(las_fixture("svs_draw_4974.json")["draw"], "2026-10-10T11:00:00Z"))
    lagring.spara_odds(conn, 4974, [Odds(1, "2026-10-10T11:30:00Z", "pinnacle", 1.8, 3.6, 3.6)])


def test_prognoser_sparas_och_ar_idempotenta(conn):
    fyll(conn)
    sparade, utan = berakna_prognoser(conn)
    assert (sparade, utan) == (13, 0)
    assert berakna_prognoser(conn) == (0, 0)


def test_bygg_kupong_oppen(conn):
    fyll(conn)
    berakna_prognoser(conn)
    k = export.bygg_kupong(conn, 4974, nu=INNAN)
    assert k["omgang"]["status"] == "oppen"
    assert k["omgang"]["utdelning"] is None
    assert len(k["matcher"]) == 13
    m1 = k["matcher"][0]
    # Match 1: pinnacle + Svenska Spels aktuella odds, startodds ignoreras
    assert m1["odds"]["antal_bolag"] == 2
    assert m1["chans_kalla"] == "modell"
    assert abs(sum(m1["chans"].values()) - 1) < 1e-3
    assert m1["streck"] == {"1": 65.0, "X": 20.0, "2": 15.0}
    assert abs(m1["varde"]["1"] - (m1["chans"]["1"] - 0.65)) < 1e-3
    assert m1["resultat"] is None


def test_fallback_till_streck_utan_odds(conn):
    lagring.spara_kupong(conn, tolka_kupong(las_fixture("svs_draw_4974.json")["draw"], "2026-10-10T11:00:00Z"))
    conn.execute("DELETE FROM odds")
    k = export.bygg_kupong(conn, 4974, nu=INNAN)
    m = k["matcher"][0]
    assert m["chans_kalla"] == "streck" and m["varde"] is None
    assert abs(m["chans"]["1"] - 0.65) < 1e-6


def test_avgjord_omgang_visar_resultat(conn):
    draw = las_fixture("svs_draw_4974.json")["draw"]
    draw["drawNumber"] = 4973
    lagring.spara_kupong(conn, tolka_kupong(draw, "2026-10-03T11:00:00Z"))
    lagring.spara_resultat(conn, tolka_resultat(las_fixture("svs_result_4973.json")["result"]))
    k = export.bygg_kupong(conn, 4973, nu="2026-10-11T08:00:00Z")
    assert k["omgang"]["status"] == "avgjord"
    assert k["omgang"]["utdelning"]["13"] == 59266.0
    assert k["matcher"][0]["resultat"] == "2" and k["matcher"][0]["mal"] == "0-7"
    # Med dolj_resultat (exempelfilen) ser den öppen ut
    k2 = export.bygg_kupong(conn, 4973, nu="2026-10-11T08:00:00Z", dolj_resultat=True)
    assert k2["omgang"]["status"] == "oppen" and k2["matcher"][0]["resultat"] is None


def test_skriv_bara_vid_andring(conn, tmp_path):
    fyll(conn)
    berakna_prognoser(conn)
    fil = tmp_path / "kupong.json"
    k = export.bygg_kupong(conn, 4974, nu=INNAN)
    assert export.skriv(k, fil) is True
    k2 = export.bygg_kupong(conn, 4974, nu="2026-10-10T13:40:00Z")   # bara 'genererad' skiljer
    assert export.skriv(k2, fil) is False
    assert json.loads(fil.read_text())["formatversion"] == 1


def test_exempelfilen_ar_giltig():
    from pathlib import Path
    k = json.loads((Path(__file__).parent.parent / "docs" / "exempel-kupong.json").read_text(encoding="utf-8"))
    assert k["formatversion"] == export.FORMATVERSION
    assert len(k["matcher"]) == 13
    assert all(m["chans"] is not None for m in k["matcher"])


def test_historik_tar_bara_avgjorda_omgangar_med_prognos(conn):
    draw = las_fixture("svs_draw_4974.json")["draw"]
    draw["drawNumber"] = 4973
    lagring.spara_kupong(conn, tolka_kupong(draw, "2026-10-03T11:00:00Z"))
    berakna_prognoser(conn)
    assert export.bygg_historik(conn)["omgangar"] == []          # inte avgjord än
    lagring.spara_resultat(conn, tolka_resultat(las_fixture("svs_result_4973.json")["result"]))
    h = export.bygg_historik(conn)
    assert h["modell"] == "odds-v2" and len(h["omgangar"]) == 1
    o = h["omgangar"][0]
    assert o["utdelning"] == [59266.0, 736.0, 49.0, 16.0]
    assert len(o["matcher"]) == 13
    m1 = o["matcher"][0]
    assert len(m1) == 8 and m1[6] == "2" and m1[3:6] == [65.0, 20.0, 15.0]
    assert m1[7] is None            # ingen tips-v1-prognos i testet
    assert abs(sum(m1[:3]) - 1) < 1e-3


def test_tipsarnas_form_raknar_garderingar_rattvist(conn):
    """Rätt spik = 1, rätt halvgardering = ½, rätt helgardering = ⅓ – så att garderingar inte ger gratis träff."""
    draw = las_fixture("svs_draw_4974.json")["draw"]
    draw["drawNumber"] = 4973
    lagring.spara_kupong(conn, tolka_kupong(draw, "2026-10-03T11:00:00Z"))
    lagring.spara_resultat(conn, tolka_resultat(las_fixture("svs_result_4973.json")["result"]))
    facit = {r[0]: r[1] for r in conn.execute("SELECT matchnr, resultat FROM matcher")}
    a, b = lagring.kalla_id(conn, "spikaren"), lagring.kalla_id(conn, "garderaren")
    for nr, res in facit.items():
        mid = conn.execute("SELECT id FROM matcher WHERE matchnr = ?", (nr,)).fetchone()[0]
        conn.execute("INSERT INTO tips (match_id, kalla_id, tidpunkt, tecken) VALUES (?, ?, 'x', ?)", (mid, a, res))
        conn.execute("INSERT INTO tips (match_id, kalla_id, tidpunkt, tecken) VALUES (?, ?, 'x', '1X2')", (mid, b))
    conn.commit()
    alla = export.tipsare_form(conn, "2026-10-11T00:00:00Z")
    form = {f["namn"]: f for f in alla if f["grupp"] == "alla"}
    assert form["spikaren"]["poang"] == 1.0 and form["spikaren"]["antal"] == 13
    assert abs(form["garderaren"]["poang"] - 1 / 3) < 1e-3
    assert [f["namn"] for f in alla if f["grupp"] == "alla"][0] == "spikaren"
    # Fixturens matcher är engelska → samma siffror i gruppen England, ingen grupp Sverige
    england = {f["namn"]: f for f in alla if f["grupp"] == "England"}
    assert england["spikaren"]["antal"] == 13
    assert not [f for f in alla if f["grupp"] == "Sverige"]


def test_osaker_nar_bara_svenska_spels_odds_finns(conn):
    fyll(conn)   # match 1 har även Pinnacle, övriga bara Svenska Spels odds
    berakna_prognoser(conn)
    k = export.bygg_kupong(conn, 4974, nu=INNAN)
    assert k["matcher"][0]["osaker"] is False
    assert k["matcher"][0]["odds"]["bara_svenskaspel"] is False
    assert k["matcher"][1]["osaker"] is True
    assert k["matcher"][1]["odds"]["bara_svenskaspel"] is True



def test_statistik_per_startar(conn):
    from tests.test_statistik import fyll_syntetiskt
    from pipeline.model import statistik
    fyll_syntetiskt(conn, n_omgangar=60, facit="odds")
    statistik.kor(conn)
    pa = export.statistik_per_ar(conn, "odds-v2")
    assert "alla" in pa
    ar = [a for a in pa if a != "alla"]
    for a in ar:   # varje startår har färre (eller lika många) matcher än totalen
        assert pa[a]["modeller"][0]["antal"] < pa["alla"]["modeller"][0]["antal"]
    assert pa["alla"]["modeller"][0]["version"] in ("odds-v2", "ensemble-v1", "tips-v1")


def test_forslaget_fryses_vid_sista_korningen_fore_spelstopp(conn):
    fyll(conn)
    berakna_prognoser(conn)
    fore = export.bygg_kupong(conn, 4974, nu=INNAN)              # 13:30Z, före spelstopp 13:59Z
    export.frys(conn, fore, INNAN)
    # Efter spelstopp kommer slutstrecken in och skiljer sig kraftigt
    mid = conn.execute("SELECT id FROM matcher WHERE matchnr = 1").fetchone()[0]
    conn.execute("INSERT INTO streck VALUES (?, '2026-10-10T14:30:00Z', 40, 30, 30)", (mid,))
    conn.commit()
    efter = export.bygg_kupong(conn, 4974, nu="2026-10-10T15:00:00Z")
    assert efter["omgang"]["status"] == "stangd"
    assert efter["omgang"]["frusen"] == INNAN
    assert efter["matcher"][0]["streck"] == fore["matcher"][0]["streck"] == {"1": 65.0, "X": 20.0, "2": 15.0}
    assert efter["matcher"][0]["chans"] == fore["matcher"][0]["chans"]
    # Frysning görs bara medan omgången är öppen
    export.frys(conn, efter, "2026-10-10T15:00:00Z")
    assert conn.execute("SELECT frusen FROM frysta_kuponger").fetchone()[0] == INNAN


def test_utan_frysning_visas_slutdatan(conn):
    fyll(conn)
    efter = export.bygg_kupong(conn, 4974, nu="2026-10-10T15:00:00Z")
    assert efter["omgang"]["frusen"] is None


def test_parvis_jamforelse_mot_oddsen():
    import random
    rng = random.Random(1)
    odds = (0.5, 0.3, 0.2)
    facit = [rng.choices("1X2", weights=odds)[0] for _ in range(400)]
    lika = export.parvis("odds-v1", [(odds, odds, r) for r in facit])
    assert lika["slutsats"] == "ingen säker skillnad" and lika["skillnad"] == 0
    # En modell som vet facit i förväg är tydligt bättre; en som tror tvärtom är sämre
    vet = export.parvis("tips-v1", [(odds, tuple(0.8 if t == r else 0.1 for t in "1X2"), r) for r in facit])
    assert vet["slutsats"] == "bättre" and vet["skillnad"] > 0 and vet["traff"] == 1.0
    fel = export.parvis("tips-v1", [(odds, (0.1, 0.3, 0.6), r) for r in facit])
    assert fel["slutsats"] == "sämre"
    assert export.parvis("tips-v1", [(odds, odds, r) for r in facit[:50]])["slutsats"] == "för lite data"
    assert export.parvis("Svenska folket", [(odds, odds, "1")] * 120)["roll"] == "referens"


def test_framatmodell_kramper_inte_huvudjamforelsen(conn, monkeypatch):
    """En skuggmodell med prognoser bara för de senaste matcherna mäts parvis, inte i huvudtabellen."""
    from tests.test_statistik import fyll_syntetiskt
    from pipeline.model import modeller, statistik

    class Skugga(modeller.OddsModellV2):
        version, namn, roll, framat = "skugga-test", "Testskugga", "skugga", True
    monkeypatch.setitem(modeller.MODELLER, Skugga.version, Skugga())
    monkeypatch.setitem(export.MODELLER, Skugga.version, Skugga())
    fyll_syntetiskt(conn, n_omgangar=60, facit="odds")
    statistik.kor(conn)
    fore = export.statistik_per_ar(conn, "odds-v2")["alla"]["modeller"][0]["antal"]
    senaste = [r[0] for r in conn.execute("SELECT id FROM matcher ORDER BY id DESC LIMIT 130")]
    for mid in senaste:
        conn.execute("INSERT INTO prognoser VALUES (?, 'skugga-test', 0.4, 0.3, 0.3, 'x')", (mid,))
    conn.commit()
    alla = export.statistik_per_ar(conn, "odds-v2")["alla"]
    assert "skugga-test" not in [m["version"] for m in alla["modeller"]]
    assert alla["modeller"][0]["antal"] == fore > 130
    skugga = next(j for j in alla["jamforelse"] if j["version"] == "skugga-test")
    assert skugga["framat"] and skugga["antal"] == 130 and skugga["roll"] == "skugga"
