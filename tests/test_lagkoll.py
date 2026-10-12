import json

from pipeline import export, lagkoll, lagring
from pipeline.ai.extraktion import validera_lagfakta
from pipeline.model.modeller import LagkollModell, berakna_prognoser, las_underlag
from pipeline.sources import wikipedia
from tests.test_export import INNAN, fyll

TABELL_HTML = """
<table class="wikitable"><tr><th><abbr title="Position">Pos</abbr></th><th>Team</th><th><abbr>Pld</abbr></th>
<th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th>Qualification</th></tr>
<tr><th>1</th><td>Manchester United<sup>[a]</sup></td><td>6</td><td>5</td><td>1</td><td>0</td><td>14</td><td>4</td>
<td>+10</td><td>16</td><td rowspan="2">Champions League</td></tr>
<tr><th>2</th><td>Tottenham Hotspur <span style="display:none">dold</span>(Q)</td><td>6</td><td>4</td><td>1</td><td>1</td>
<td>10</td><td>6</td><td>+4</td><td>13</td></tr>
""" + "".join(f"<tr><th>{i}</th><td>Lag {i}</td><td>6</td><td>1</td><td>1</td><td>4</td><td>5</td><td>9</td><td>−4</td>"
              f"<td>4</td></tr>" for i in range(3, 11)) + """</table>
<table class="wikitable"><tr><th>Team</th><th>Outgoing manager</th><th>Manner of departure</th>
<th>Date of vacancy</th><th>Incoming manager</th><th>Date of appointment</th></tr>
<tr><td>Tottenham Hotspur</td><td>A Gammal</td><td>Sacked</td><td>1 October 2026</td><td>B Ny</td><td>3 October 2026</td></tr>
<tr><td>Manchester United</td><td>C Förr</td><td>Sacked</td><td>1 March 2025</td><td>D Nu</td><td>2 March 2025</td></tr>
</table>"""


def test_wikipedia_tabell_och_tranarbyten():
    t = wikipedia.tolka_tabell(TABELL_HTML)
    assert len(t) == 10
    assert t[0] == {"plats": 1, "lag": "Manchester United", "spelade": 6, "vunna": 5, "oavgjorda": 1, "forlorade": 0,
                    "gjorda": 14, "inslappta": 4, "poang": 16}
    assert t[1]["lag"] == "Tottenham Hotspur" and t[1]["poang"] == 13       # utan dold text och (Q)
    b = wikipedia.tolka_tranarbyten(TABELL_HTML)
    assert b[0]["lag"] == "Tottenham Hotspur" and b[0]["tilltradande"] == "B Ny"


def test_wikipedia_url_per_sasong():
    from datetime import datetime
    assert wikipedia.url("England", "League One", datetime(2026, 10, 1)).endswith("2026%E2%80%9327_EFL_League_One")
    assert wikipedia.url("England", "League One", datetime(2027, 3, 1)).endswith("2026%E2%80%9327_EFL_League_One")
    assert wikipedia.url("Sverige", "Allsvenskan", datetime(2026, 10, 1)).endswith("Fotbollsallsvenskan_2026")
    assert wikipedia.url("England", "FA-cupen", datetime(2026, 10, 1)) is None


def test_lagfakta_valideras():
    svar = {"lagfakta": [
        {"matchnr": 1, "sida": "hemma", "franvaro": [{"spelare": " Bruno ", "orsak": "avstängd", "status": "borta",
                                                     "nyckelspelare": True}], "form": "wwldx", "tabellplats": 3,
         "sammanhang": None},
        {"matchnr": 1, "sida": "hemma", "franvaro": [], "form": "W", "tabellplats": None, "sammanhang": None},  # dubblett
        {"matchnr": 9, "sida": "borta", "franvaro": [], "form": "W", "tabellplats": None, "sammanhang": None},  # fel match
        {"matchnr": 2, "sida": "borta", "franvaro": [], "form": None, "tabellplats": None, "sammanhang": None},  # tom
    ]}
    ut = validera_lagfakta(svar, [1, 2])
    assert ut == [(1, "hemma", {"franvaro": [{"spelare": "Bruno", "orsak": "avstängd", "status": "borta",
                                             "nyckelspelare": True}], "form": "WWLD", "tabellplats": 3,
                                "sammanhang": None})]
    assert validera_lagfakta({"tips": []}, [1]) == []


def _forbered(conn, monkeypatch):
    from pipeline.sources import bbc
    fyll(conn)
    monkeypatch.setattr(bbc, "hamta_tabell", lambda land, liga: (bbc.url(land, liga), []))   # inget nätverk
    monkeypatch.setattr(wikipedia, "hamta_liga", lambda land, liga, datum: (
        "https://en.wikipedia.org/wiki/x", wikipedia.tolka_tabell(TABELL_HTML), wikipedia.tolka_tranarbyten(TABELL_HTML)))
    kid = lagring.kalla_id(conn, "sportsmole.co.uk")
    lagring.spara_lagfakta(conn, 4974, kid, "2026-10-10T09:00:00Z", [
        (1, "hemma", {"franvaro": [{"spelare": "Bruno Fernandes", "orsak": "avstängd", "status": "borta",
                                    "nyckelspelare": True}], "form": "WWDWW", "tabellplats": None, "sammanhang": None})])


def test_analys_sparas_begransas_och_gors_inte_om(conn, monkeypatch):
    _forbered(conn, monkeypatch)
    fragor = []

    def ai(system, fraga, schema, max_tokens):
        fragor.append(fraga)
        return {"p1": 0.10, "px": 0.30, "p2": 0.60, "skrallrisk": "hög", "motivering": "Kaptenen saknas.",
                "faktorer": ["Bruno Fernandes avstängd"]}

    stat = lagkoll.analysera(conn, ai, nu=INNAN)
    assert stat["analyserade"] == 1 and stat["utan_underlag"] == 12
    assert "Saknas: Bruno Fernandes (avstängd, nyckelspelare)" in fragor[0]
    assert "plats 1 av 10" in fragor[0] and "Tränarbyte: A Gammal" in fragor[0]     # Tottenham, bytte nyss
    assert "C Förr" not in fragor[0]                                                # gammalt byte räknas inte
    mid = conn.execute("SELECT id FROM matcher WHERE matchnr = 1").fetchone()[0]
    odds = las_underlag(conn, mid, INNAN)
    r = conn.execute("SELECT p1, px, p2, skrallrisk FROM lagkoll WHERE match_id = ?", (mid,)).fetchone()
    assert abs(sum(r[:3]) - 1) < 1e-3 and r[3] == "hög"
    from pipeline.model.modeller import OddsModellV2
    po = OddsModellV2().prognos(odds)
    assert all(abs(a - b) <= lagkoll.MAX_JUSTERING + 0.001 for a, b in zip(r[:3], po))   # kapas mot oddsen
    # Samma underlag → ingen ny analys
    assert lagkoll.analysera(conn, ai, nu=INNAN)["oforandrade"] == 1 and len(fragor) == 1
    # Prognosen blir lagkoll-v1 och syns i exporten
    berakna_prognoser(conn, LagkollModell(conn), [4974])
    assert conn.execute("SELECT COUNT(*) FROM prognoser WHERE modellversion = 'lagkoll-v1'").fetchone()[0] == 1
    k = export.bygg_kupong(conn, 4974, nu=INNAN)
    lk = k["matcher"][0]["lagkoll"]
    assert lk["skrallrisk"] == "hög" and lk["hemma"]["franvaro"][0]["spelare"] == "Bruno Fernandes"
    assert lk["hemma"]["tabell"]["plats"] == 1 and lk["borta"]["tranarbyte"]["tilltradande"] == "B Ny"
    assert k["matcher"][1]["lagkoll"] is None


def test_analysen_vantar_tills_spelstopp_narmar_sig(conn, monkeypatch):
    _forbered(conn, monkeypatch)
    anrop = []
    stat = lagkoll.analysera(conn, lambda *a: anrop.append(1), nu="2026-10-07T12:00:00Z")
    assert stat["analyserade"] == 0 and not anrop


def test_ai_fel_stoppar_inte_analysen(conn, monkeypatch):
    from pipeline.ai.klient import AiFel
    _forbered(conn, monkeypatch)

    def trasig(*a):
        raise AiFel("503")
    assert lagkoll.analysera(conn, trasig, nu=INNAN)["fel"] == 1


def _bbc_rad(plats, lag, siffror, form):
    resultat = {"W": "Win", "D": "Draw", "L": "Loss"}
    celler = "".join(f"<td>{x}</td>" for x in siffror)
    formcell = "".join(f'<li><div>{f}</div><span class="visually-hidden">Result {resultat[f]}</span></li>' for f in form)
    return f"<tr><td><span>{plats}</span><span>{lag}</span></td>{celler}<td><ul>{formcell}</ul></td></tr>"


BBC_HTML = ("<table><thead><tr><th>Team</th><th>Played</th><th>Won</th><th>Drawn</th><th>Lost</th><th>GF</th>"
            "<th>GA</th><th>GD</th><th>Points</th><th>Form, Last 6 games, Oldest first</th></tr></thead><tbody>"
            + _bbc_rad(1, "Manchester United", [6, 5, 1, 0, 14, 4, "+10", 16], "LWWDWW")
            + _bbc_rad(2, "Tottenham Hotspur", [6, 4, 1, 1, 10, 6, "+4", 13], "WWLWDW")
            + "".join(_bbc_rad(i, f"Lag {i}", [6, 1, 1, 4, 5, 9, "−4", 4], "LLDLWL") for i in range(3, 11))
            + "</tbody></table>")


def test_bbc_tabell_med_form():
    from pipeline.sources import bbc
    t = bbc.tolka_tabell(BBC_HTML)
    assert len(t) == 10
    assert t[0] == {"plats": 1, "lag": "Manchester United", "spelade": 6, "vunna": 5, "oavgjorda": 1, "forlorade": 0,
                    "gjorda": 14, "inslappta": 4, "poang": 16, "form": "WWDWWL"}     # senaste först
    assert t[2]["poang"] == 4
    assert bbc.url("England", "Championship").endswith("/championship/table")
    assert bbc.url("England", "FA-cupen") is None


def test_tabell_och_form_i_matchdetaljen(conn, monkeypatch):
    from pipeline.sources import bbc
    _forbered(conn, monkeypatch)
    monkeypatch.setattr(bbc, "hamta_tabell", lambda land, liga: (bbc.url(land, liga), bbc.tolka_tabell(BBC_HTML)))
    lagkoll.uppdatera_tabeller(conn, 4974, INNAN)
    k = export.bygg_kupong(conn, 4974, nu=INNAN)
    t = k["matcher"][0]["tabell"]
    assert t["kalla"] == "BBC Sport" and t["hemma"]["plats"] == 1 and t["hemma"]["form"] == "WWDWWL"
    assert t["borta"]["plats"] == 2
    # Form ur tabellen räcker inte som underlag för en Lagkoll-analys
    m2 = conn.execute("SELECT * FROM matcher WHERE matchnr = 2").fetchone()
    assert not lagkoll.har_underlag(lagkoll.profil(conn, m2, "hemma", INNAN))
