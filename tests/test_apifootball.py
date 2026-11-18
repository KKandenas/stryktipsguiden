from pipeline.sources import apifootball


def test_aktuell_sasong_och_fel():
    svar = {"response": [{"seasons": [{"year": 2025, "current": False},
                                      {"year": 2026, "current": True, "coverage": {"injuries": True}}]}]}
    assert apifootball.aktuell_sasong(svar) == (2026, {"injuries": True})
    assert apifootball.aktuell_sasong({"response": []}) == (None, None)
    assert apifootball._fel({"errors": {"plan": "Free plans do not have access to this season"}}).startswith("plan:")
    assert apifootball._fel({"errors": []}) is None


def test_sammanfatta_skador():
    svar = {"response": [{"player": {"name": "A. Spelare", "type": "Missing Fixture", "reason": "Knee Injury"},
                          "team": {"name": "Norwich"}, "fixture": {"date": "2026-11-21T15:00:00+00:00"}}]}
    assert apifootball.sammanfatta_skador(svar) == ["Norwich: A. Spelare – Missing Fixture (Knee Injury), match 2026-11-21"]


def test_utan_nyckel_gors_inga_anrop(monkeypatch):
    monkeypatch.delenv("APIFOOTBALL_KEY", raising=False)
    monkeypatch.setattr(apifootball, "hamta", lambda *a, **k: (_ for _ in ()).throw(AssertionError("anrop")))
    assert apifootball.testa() is False
