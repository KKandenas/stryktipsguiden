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
    assert len(m1) == 7 and m1[6] == "2" and m1[3:6] == [65.0, 20.0, 15.0]
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
    form = {f["namn"]: f for f in export.tipsare_form(conn, "2026-10-11T00:00:00Z")}
    assert form["spikaren"]["poang"] == 1.0 and form["spikaren"]["antal"] == 13
    assert abs(form["garderaren"]["poang"] - 1 / 3) < 1e-3
    assert export.tipsare_form(conn, "2026-10-11T00:00:00Z")[0]["namn"] == "spikaren"
