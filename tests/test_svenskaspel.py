import copy

import pytest

from pipeline.modeller import ValideringsFel
from pipeline.sources.svenskaspel import (BOLAG_SVS, BOLAG_SVS_START, KALLA_TTT, tolka_kupong,
                                          tolka_resultat)
from tests.conftest import las_fixture

HAMTAD = "2026-10-10T13:00:00Z"


def kupong_4974():
    return las_fixture("svs_draw_4974.json")["draw"]


def test_tolka_kupong_grunddata():
    k = tolka_kupong(kupong_4974(), HAMTAD)
    assert k.omgang_id == 4974
    assert k.spelstopp == "2026-10-10T13:59:00Z"   # 15:59 svensk sommartid
    assert k.datum == "2026-10-10"
    assert len(k.matcher) == 13
    m1 = k.matcher[0]
    assert (m1.matchnr, m1.hemmalag, m1.bortalag) == (1, "Manchester United", "Tottenham")
    assert (m1.land, m1.liga, m1.avspark) == ("England", "Premier League", "2026-10-10T16:30:00Z")


def test_tolka_kupong_streck_och_odds():
    k = tolka_kupong(kupong_4974(), HAMTAD)
    assert len(k.streck) == 13
    s1 = k.streck[0]
    assert (s1.p1, s1.px, s1.p2) == (65, 20, 15)
    assert s1.tidpunkt == "2026-10-10T14:00:01Z"
    svs = [o for o in k.odds if o.bolag == BOLAG_SVS and o.matchnr == 1][0]
    assert (svs.o1, svs.ox, svs.o2, svs.tidpunkt) == (1.70, 4.40, 4.80, HAMTAD)
    start = [o for o in k.odds if o.bolag == BOLAG_SVS_START and o.matchnr == 1][0]
    assert (start.o1, start.ox, start.o2) == (1.75, 4.25, 4.60)


def test_tolka_aldre_kupong_med_tio_tidningars_tips():
    k = tolka_kupong(las_fixture("svs_draw_4900.json")["draw"], HAMTAD)
    assert len(k.tips) == 13
    t = k.tips[0]   # Bournemouth - Aston Villa: 5-1-4
    assert t.kalla == KALLA_TTT
    assert t.tecken == "1"
    assert (t.p1, t.px, t.p2) == pytest.approx((0.5, 0.1, 0.4))
    # Äldre omgångar saknar aktuella odds men har startodds
    assert {o.bolag for o in k.odds} == {BOLAG_SVS_START}


def test_kupong_med_fel_antal_matcher_avvisas():
    d = kupong_4974()
    d["drawEvents"] = d["drawEvents"][:12]
    with pytest.raises(ValideringsFel):
        tolka_kupong(d, HAMTAD)


def test_trasiga_streck_hoppas_over_men_resten_sparas():
    d = kupong_4974()
    d["drawEvents"][0]["svenskaFolket"]["one"] = "95"   # summerar till 130
    k = tolka_kupong(d, HAMTAD)
    assert len(k.streck) == 12
    assert 1 not in {s.matchnr for s in k.streck}


def test_tolka_resultat():
    r = tolka_resultat(las_fixture("svs_result_4973.json")["result"])
    assert r.omgang_id == 4973
    assert len(r.matcher) == 13
    assert r.matcher[0].resultat == "2" and (r.matcher[0].mal_hemma, r.matcher[0].mal_borta) == (0, 7)
    assert r.utdelning == {13: 59266.0, 12: 736.0, 11: 49.0, 10: 16.0}
    assert r.vinnare[13] == 77


def test_resultat_med_ogiltigt_utfall_avvisas():
    data = copy.deepcopy(las_fixture("svs_result_4973.json")["result"])
    data["events"][3]["outcome"] = ""
    with pytest.raises(ValideringsFel):
        tolka_resultat(data)


def test_resultat_utan_utdelning_avvisas():
    data = copy.deepcopy(las_fixture("svs_result_4973.json")["result"])
    data["distribution"] = data["distribution"][:2]
    with pytest.raises(ValideringsFel):
        tolka_resultat(data)


def test_tidsstampel_med_en_decimal():
    from pipeline.tid import till_utc
    assert till_utc("2021-03-13T16:01:10.1+01:00") == "2021-03-13T15:01:10Z"
    assert till_utc("2026-10-10T16:00:01.2846789+02:00") == "2026-10-10T14:00:01Z"


def test_installd_omgang():
    data = copy.deepcopy(las_fixture("svs_result_4973.json")["result"])
    data["cancelled"] = True
    for e in data["events"]:
        e["outcome"] = ""
    r = tolka_resultat(data)
    assert r.installd and r.matcher == []
