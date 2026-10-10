from pipeline.lagnamn import likhet
from pipeline.sources.oddsapi import matcha, tolka_events
from pipeline.sources.svenskaspel import tolka_kupong
from tests.conftest import las_fixture


def test_tolka_events_hoppar_over_trasigt_bolag():
    events = tolka_events(las_fixture("oddsapi_soccer_epl.json"))
    assert len(events) == 4
    mu = events[0]
    assert [b[0] for b in mu.odds] == ["pinnacle", "unibet_eu"]
    assert mu.odds[0][2:] == (1.78, 4.2, 4.75)   # o1, ox, o2 – oavgjort heter "Draw"


def test_matcha_mot_kupong():
    k = tolka_kupong(las_fixture("svs_draw_4974.json")["draw"], "2026-10-10T13:00:00Z")
    pl = [m for m in k.matcher if m.liga == "Premier League"]
    par = matcha(pl, tolka_events(las_fixture("oddsapi_soccer_epl.json")))
    assert par[1].bortalag == "Tottenham Hotspur"
    assert par[4].bortalag == "Brighton and Hove Albion"
    assert par[2].bortalag == "AFC Bournemouth"
    assert 3 not in par   # Aston Villa - Brentford i fixturen spelas en annan vecka


def test_lagnamn():
    assert likhet("Sheffield W", "Sheffield Wednesday") > likhet("Sheffield W", "Sheffield United")
    assert likhet("Sheffield U", "Sheffield United") >= 0.9
    assert likhet("Wolverhampton", "Wolverhampton Wanderers") >= 0.9
    assert likhet("Kroatien", "Croatia") == 1.0
    assert likhet("Sporting Lissabon", "Sporting Lisbon") == 1.0
    assert likhet("Arsenal", "Chelsea") < 0.6
