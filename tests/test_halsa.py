"""Hälsokontrollen: larm för saknad kupong, odds, AI, krediter, starter och resultat."""
from datetime import datetime, timedelta, timezone

from pipeline import halsa, lagring
from pipeline.sources.svenskaspel import tolka_kupong
from tests.conftest import las_fixture


def koder(fel):
    return {f["kod"] for f in fel}


def _kupong(conn):
    lagring.spara_kupong(conn, tolka_kupong(las_fixture("svs_draw_4974.json")["draw"], "2026-10-10T07:00:00Z"))
    stopp = conn.execute("SELECT spelstopp FROM omgangar").fetchone()[0]
    return datetime.fromisoformat(stopp.replace("Z", "+00:00"))


def test_allt_lugnt_utan_data_en_mandag(conn):
    assert halsa.kontrollera(conn, datetime(2026, 11, 2, 9, 0, tzinfo=timezone.utc), starter=4) == []


def test_ingen_kupong_mitt_i_veckan_och_inga_starter(conn):
    onsdag = datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc)
    assert koder(halsa.kontrollera(conn, onsdag, starter=0)) == {"ingen_kupong", "inga_starter"}
    assert halsa.kontrollera(conn, onsdag, starter=None)[0]["kod"] == "ingen_kupong"


def test_odds_saknas_och_okant_liganamn(conn):
    stopp = _kupong(conn)
    onsdag = stopp - timedelta(days=3)
    fel = halsa.kontrollera(conn, onsdag)
    assert koder(fel) == {"odds_saknas"}
    # Med odds från ett riktigt bolag för alla matcher försvinner larmet
    for (mid,) in conn.execute("SELECT id FROM matcher").fetchall():
        conn.execute("INSERT INTO odds (match_id, tidpunkt, bolag, o1, ox, o2) VALUES (?, '2026-10-07T10:00:00Z', 'pinnacle', 2, 3.4, 3.8)", (mid,))
    assert halsa.kontrollera(conn, onsdag) == []
    # Ett liganamn som saknas i config.py nämns i texten
    conn.execute("DELETE FROM odds WHERE match_id = (SELECT id FROM matcher WHERE matchnr = 13)")
    conn.execute("UPDATE matcher SET land = 'England', liga = 'Påhittad cup' WHERE matchnr = 13")
    assert "liganamnet saknas" in halsa.kontrollera(conn, onsdag)[0]["text"]


def test_ai_krediter_och_resultat(conn):
    stopp = _kupong(conn)
    for (mid,) in conn.execute("SELECT id FROM matcher").fetchall():
        conn.execute("INSERT INTO odds (match_id, tidpunkt, bolag, o1, ox, o2) VALUES (?, '2026-10-07T10:00:00Z', 'pinnacle', 2, 3.4, 3.8)", (mid,))
    nu = stopp + timedelta(days=2)
    tid = nu.strftime("%Y-%m-%dT%H:%M:%SZ")
    conn.execute("INSERT INTO installningar VALUES ('ai_status', ?, ?)",
                 ('{"konfigurerad": true, "lyckade": 0, "misslyckade": 5, "stoppad": "kvot"}', tid))
    conn.execute("INSERT INTO installningar VALUES ('oddsapi_krediter_kvar', '12', ?)", (tid,))
    fel = halsa.kontrollera(conn, nu)
    assert koder(fel) == {"ai_fel", "krediter", "resultat_saknas"}
    text = halsa.som_markdown(fel, nu)
    assert text.startswith("<!-- koder: ai_fel,krediter,resultat_saknas -->") and "DRIFT.md#larm" in text
