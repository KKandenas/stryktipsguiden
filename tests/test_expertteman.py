"""AI-märkning av experternas kommentarer: nattfönster, validering och märkning en omgång per anrop."""
import json
from datetime import datetime, timezone

from pipeline import expertteman, lagring
from pipeline.sources.svenskaspel import tolka_kupong
from tests.conftest import las_fixture


def utc(s):
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def test_nattfonster_son_till_tor():
    # Oktober 2026 = sommartid (UTC+2) till 25 okt
    assert expertteman.nattfonster(utc("2026-10-18T19:30:00"))       # söndag 21:30
    assert expertteman.nattfonster(utc("2026-10-20T04:00:00"))       # tisdag 06:00
    assert not expertteman.nattfonster(utc("2026-10-20T06:00:00"))   # tisdag 08:00
    assert not expertteman.nattfonster(utc("2026-10-20T15:00:00"))   # tisdag 17:00
    assert not expertteman.nattfonster(utc("2026-10-23T19:30:00"))   # fredag 21:30
    assert not expertteman.nattfonster(utc("2026-10-24T04:00:00"))   # lördag 06:00
    assert expertteman.nattfonster(utc("2026-10-23T04:00:00"))       # fredag 06:00 (natten efter torsdag)


def test_validering_av_svaret():
    svar = {"matcher": [{"nr": 1, "teman": [{"tema": "svag_form", "lag": "hemma"}, {"tema": "svag_form", "lag": "hemma"},
                                            {"tema": "påhittat", "lag": "hemma"}, {"tema": "derby", "lag": "bada"}]},
                        {"nr": 99, "teman": [{"tema": "derby", "lag": "bada"}]}]}
    assert expertteman.validera(svar, [1, 2]) == {1: [{"tema": "svag_form", "lag": "hemma"}, {"tema": "derby", "lag": "bada"}],
                                                  2: []}


def _fyll(conn):
    lagring.spara_kupong(conn, tolka_kupong(las_fixture("svs_draw_4974.json")["draw"], "2026-10-10T07:00:00Z"))
    kid = lagring.kalla_id(conn, "tipsmedoss.com")
    for mid, nr in conn.execute("SELECT id, matchnr FROM matcher").fetchall():
        conn.execute("INSERT INTO expertkommentarer (match_id, kalla_id, tecken, text, url) VALUES (?, ?, '1', ?, 'u')",
                     (mid, kid, f"Kommentar om match {nr}. Hemmalaget krisar."))
    conn.commit()


def test_marka_en_omgang_per_anrop_och_rakna_natten(conn):
    _fyll(conn)
    fragor = []

    def ai(system, fraga, schema, max_tokens):
        fragor.append(fraga)
        return {"matcher": [{"nr": 1, "teman": [{"tema": "svag_form", "lag": "hemma"}]}]}
    nu = utc("2026-10-20T20:00:00")                                    # tisdag 22:00
    assert expertteman.kvar_i_natt(conn, nu) == expertteman.MAX_PER_NATT
    stat = expertteman.marka(conn, ai, max_anrop=5, nu=nu)
    assert stat == {"anrop": 1, "matcher": 13, "fel": 0} and len(fragor) == 1
    assert "Match 1:" in fragor[0] and "Match 13:" in fragor[0]
    teman = dict(conn.execute("SELECT m.matchnr, e.teman FROM expertkommentarer e JOIN matcher m ON m.id = e.match_id"))
    assert json.loads(teman[1]) == [{"tema": "svag_form", "lag": "hemma"}] and json.loads(teman[2]) == []
    assert expertteman.omarkta(conn) == 0
    assert expertteman.kvar_i_natt(conn, nu) == expertteman.MAX_PER_NATT - 1
    assert expertteman.kvar_i_natt(conn, utc("2026-10-21T04:00:00")) == expertteman.MAX_PER_NATT - 1   # samma natt
    assert expertteman.kvar_i_natt(conn, utc("2026-10-21T20:00:00")) == expertteman.MAX_PER_NATT       # ny natt
    # Inget kvar att märka: inga fler anrop
    assert expertteman.marka(conn, ai, max_anrop=5, nu=nu)["anrop"] == 0 and len(fragor) == 1


def test_ai_fel_lamnar_kommentarerna_omarkta(conn):
    _fyll(conn)

    def ai(*a):
        raise expertteman.AiFel("503")
    stat = expertteman.marka(conn, ai, max_anrop=5, nu=utc("2026-10-20T20:00:00"))
    assert stat["fel"] == 1 and expertteman.omarkta(conn) == 13
