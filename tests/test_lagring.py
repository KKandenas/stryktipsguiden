import copy

from pipeline import db, lagring
from pipeline.modeller import Odds
from pipeline.sources.svenskaspel import tolka_kupong, tolka_resultat
from tests.conftest import las_fixture


def antal(conn, tabell):
    return conn.execute(f"SELECT COUNT(*) FROM {tabell}").fetchone()[0]


def test_migreringar_kors_bara_en_gang(conn):
    assert db.migrera(conn) == []
    assert antal(conn, "schema_migreringar") == 2


def test_spara_kupong_tva_ganger_ger_inga_dubbletter(conn):
    draw = las_fixture("svs_draw_4974.json")["draw"]
    forsta = lagring.spara_kupong(conn, tolka_kupong(draw, "2026-10-10T13:00:00Z"))
    assert forsta == {"matcher": 13, "streck": 13, "odds": 14, "tips": 0}  # 13 startodds + 1 aktuellt
    # Samma data, senare hämtning: oförändrade odds/streck ska inte sparas igen.
    andra = lagring.spara_kupong(conn, tolka_kupong(draw, "2026-10-10T13:30:00Z"))
    assert andra == {"matcher": 0, "streck": 0, "odds": 0, "tips": 0}
    assert (antal(conn, "matcher"), antal(conn, "streck"), antal(conn, "odds")) == (13, 13, 14)


def test_andrade_streck_sparas_som_ny_ogonblicksbild(conn):
    draw = las_fixture("svs_draw_4974.json")["draw"]
    lagring.spara_kupong(conn, tolka_kupong(draw, "2026-10-10T13:00:00Z"))
    ny = copy.deepcopy(draw)
    sf = ny["drawEvents"][0]["svenskaFolket"]
    sf.update({"one": "63", "x": "21", "two": "16", "date": "2026-10-10T16:30:00+02:00"})
    nya = lagring.spara_kupong(conn, tolka_kupong(ny, "2026-10-10T14:30:00Z"))
    assert nya["streck"] == 1
    assert antal(conn, "streck") == 14


def test_utbytt_match_rensar_gammal_data(conn):
    draw = las_fixture("svs_draw_4974.json")["draw"]
    lagring.spara_kupong(conn, tolka_kupong(draw, "2026-10-10T13:00:00Z"))
    ny = copy.deepcopy(draw)
    ny["drawEvents"][0]["match"]["participants"][1]["name"] = "Arsenal"
    for e in ny["drawEvents"]:
        e["svenskaFolket"] = None
        e["odds"] = e["startOdds"] = None
    lagring.spara_kupong(conn, tolka_kupong(ny, "2026-10-10T13:30:00Z"))
    mid = conn.execute("SELECT id, bortalag FROM matcher WHERE matchnr = 1").fetchone()
    assert mid["bortalag"] == "Arsenal"
    assert conn.execute("SELECT COUNT(*) FROM streck WHERE match_id = ?", (mid["id"],)).fetchone()[0] == 0
    assert antal(conn, "matcher") == 13


def test_tips_uppdateras_inte_i_onodan(conn):
    draw = las_fixture("svs_draw_4900.json")["draw"]
    assert lagring.spara_kupong(conn, tolka_kupong(draw, "2025-05-10T10:00:00Z"))["tips"] == 13
    assert lagring.spara_kupong(conn, tolka_kupong(draw, "2025-05-10T11:00:00Z"))["tips"] == 0
    assert antal(conn, "tips") == 13


def test_spara_resultat(conn):
    # Resultatet för 4973 sparas på en omgång med samma nummer (matcherna från 4974-fixturen duger).
    draw = las_fixture("svs_draw_4974.json")["draw"]
    draw["drawNumber"] = 4973
    lagring.spara_kupong(conn, tolka_kupong(draw, "2026-10-03T13:00:00Z"))
    assert lagring.omgangar_utan_resultat(conn, "2026-10-11T00:00:00Z") == [4973]
    r = tolka_resultat(las_fixture("svs_result_4973.json")["result"])
    lagring.spara_resultat(conn, r)
    lagring.spara_resultat(conn, r)   # idempotent
    assert lagring.omgangar_utan_resultat(conn, "2026-10-11T00:00:00Z") == []
    assert conn.execute("SELECT utdelning_13 FROM omgangar").fetchone()[0] == 59266.0
    assert conn.execute("SELECT resultat FROM matcher WHERE matchnr = 1").fetchone()[0] == "2"


def test_odds_fran_flera_bolag(conn):
    draw = las_fixture("svs_draw_4974.json")["draw"]
    lagring.spara_kupong(conn, tolka_kupong(draw, "2026-10-10T13:00:00Z"))
    odds = [Odds(1, "2026-10-10T12:58:31Z", "pinnacle", 1.78, 4.2, 4.75),
            Odds(1, "2026-10-10T12:55:02Z", "unibet_eu", 1.72, 4.1, 4.6)]
    assert lagring.spara_odds(conn, 4974, odds) == 2
    assert lagring.spara_odds(conn, 4974, odds) == 0


def test_installd_omgang_vantar_inte_pa_resultat(conn):
    from pipeline.modeller import Resultat
    draw = las_fixture("svs_draw_4974.json")["draw"]
    lagring.spara_kupong(conn, tolka_kupong(draw, "2026-10-10T13:00:00Z"))
    lagring.spara_resultat(conn, Resultat(4974, [], {}, {}, installd=True))
    assert lagring.omgangar_utan_resultat(conn, "2026-10-11T00:00:00Z") == []
