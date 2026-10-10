"""Fas 4: tipssajter, AI-tolkning och kommentarer. AI-modellen ersätts av en falsk anropare."""
import pytest

from pipeline import export, lagring, tipsinsamling
from pipeline.ai import kommentarer
from pipeline.ai.extraktion import validera
from pipeline.ai.klient import AiFel
from pipeline.model.modeller import berakna_prognoser
from pipeline.modeller import Match
from pipeline.sources.svenskaspel import tolka_kupong
from pipeline.sources.tipssajter import Artikel, Tipssajt
from pipeline.sources.tipssajter.speltips import valj_artikel
from pipeline.sources.tipssajter.sportsgambler import para_ihop
from pipeline.webb import html_till_text, tolka_robots
from tests.conftest import las_fixture

NU = "2026-10-10T08:00:00Z"   # före spelstopp 13:59Z


def fyll(conn):
    lagring.spara_kupong(conn, tolka_kupong(las_fixture("svs_draw_4974.json")["draw"], "2026-10-10T07:00:00Z"))


# ---------- webb ----------

def test_html_till_text_hoppar_over_skript_och_meny():
    html = """<html><head><script>var x=1;</script><style>p{}</style></head><body>
      <nav>Meny Hem Om</nav><article><h1>Stryktipset 10/10</h1>
      <p>Match 1: Manchester United &ndash; Tottenham | Speltips: 1</p><p>Etta&nbsp;gäller.</p></article>
      <footer>Copyright</footer></body></html>"""
    t = html_till_text(html)
    assert "Speltips: 1" in t and "Manchester United – Tottenham" in t and "Etta gäller." in t
    assert "var x" not in t and "Meny" not in t and "Copyright" not in t


def test_robots():
    rp = tolka_robots("User-agent: *\nDisallow: /wp-admin/\nDisallow: /go/\n")
    assert rp.can_fetch("Stryktipsguiden/0.1", "https://speltips.se/stryktipset-10-10")
    assert not rp.can_fetch("Stryktipsguiden/0.1", "https://speltips.se/go/bet365")


# ---------- sajter ----------

RSS = """<?xml version="1.0"?><rss><channel>
<item><title>Topptipset 9/10: Klubblagsbollen</title><link>https://speltips.se/topptipset-9-10</link>
 <pubDate>Fri, 09 Oct 2026 07:00:00 +0000</pubDate></item>
<item><title>Stryktipset 10/10: Uppehållet är över!</title><link>https://speltips.se/stryktipset-10-10</link>
 <pubDate>Fri, 09 Oct 2026 07:22:48 +0000</pubDate></item>
<item><title>Stryktipset 3/10: Förra veckan</title><link>https://speltips.se/stryktipset-3-10</link>
 <pubDate>Fri, 09 Oct 2026 06:00:00 +0000</pubDate></item>
<item><title>Stryktipset 3/10: Gammal</title><link>https://speltips.se/gammal</link>
 <pubDate>Fri, 02 Oct 2026 07:00:00 +0000</pubDate></item>
</channel></rss>"""


def test_speltips_valjer_veckans_stryktipsartikel():
    a = valj_artikel(RSS, "2026-10-10T13:59:00Z")
    assert [x.url for x in a] == ["https://speltips.se/stryktipset-10-10"]
    assert a[0].matchnr is None
    assert valj_artikel(RSS, "2026-10-24T13:59:00Z") == []


def test_sportsgambler_parar_lankar_med_kupongen():
    matcher = [
        Match(1, "Manchester United", "Tottenham", "Premier League", "England", "2026-10-10T16:30:00Z"),
        Match(13, "Huddersfield", "Sheffield W", "League One", "England", "2026-10-10T14:00:00Z"),
        Match(9, "Middlesbrough", "Wolverhampton", "Championship", "England", "2026-10-10T14:00:00Z"),
    ]
    p = "/betting-tips/football/"
    lankar = [
        (f"{p}manchester-united-vs-tottenham-prediction-lineups-odds-2026-10-10/", "manchester-united", "tottenham", "2026-10-10"),
        (f"{p}huddersfield-vs-sheffield-united-prediction-lineups-odds-2026-10-10/", "huddersfield", "sheffield-united", "2026-10-10"),
        (f"{p}huddersfield-vs-sheffield-wednesday-prediction-lineups-odds-2026-10-10/", "huddersfield", "sheffield-wednesday", "2026-10-10"),
        (f"{p}middlesbrough-vs-wolves-prediction-lineups-odds-2026-12-01/", "middlesbrough", "wolves", "2026-12-01"),
    ]
    a = {x.matchnr[0]: x.url for x in para_ihop(matcher, lankar)}
    assert a[1].endswith("manchester-united-vs-tottenham-prediction-lineups-odds-2026-10-10/")
    assert "sheffield-wednesday" in a[13]
    assert 9 not in a     # fel datum


# ---------- Claude-tolkning ----------

def test_validera_tolkning():
    svar = {"tips": [
        {"matchnr": 1, "tecken": "1", "p1": 55, "px": 25, "p2": 20, "sammanfattning": "United i form."},
        {"matchnr": 3, "tecken": "X2", "p1": None, "px": None, "p2": None, "sammanfattning": "Brentford starka."},
        {"matchnr": 3, "tecken": "1", "p1": None, "px": None, "p2": None, "sammanfattning": "Dubblett"},
        {"matchnr": 14, "tecken": "1", "p1": None, "px": None, "p2": None, "sammanfattning": "Finns inte"},
        {"matchnr": 5, "tecken": "Y", "p1": None, "px": None, "p2": None, "sammanfattning": "Ogiltigt"},
        {"matchnr": 6, "tecken": "2", "p1": 0.9, "px": 0.9, "p2": 0.9, "sammanfattning": "Trasiga procent"},
    ]}
    t = {x.matchnr: x for x in validera(svar, list(range(1, 14)), "speltips.se", NU)}
    assert sorted(t) == [1, 3, 6]
    assert (t[1].p1, t[1].px, t[1].p2) == pytest.approx((0.55, 0.25, 0.20))
    assert t[3].tecken == "X2" and t[3].p1 is None
    assert t[6].tecken == "2" and t[6].p1 is None   # tecknet behålls, sannolikheterna kastas
    with pytest.raises(AiFel):
        validera({"fel": 1}, [1], "x", NU)


class FalskSajt(Tipssajt):
    namn, url, sprak = "testsajt.se", "https://testsajt.se", "sv"

    def hitta_artiklar(self, matcher, spelstopp):
        return [Artikel("https://testsajt.se/stryktipset", "Stryktipset 10/10")]


class FalskClaude:
    def __init__(self, svar):
        self.svar, self.anrop = svar, []

    def __call__(self, system, fraga, schema, max_tokens):
        self.anrop.append(fraga)
        return self.svar(fraga) if callable(self.svar) else self.svar


def test_samla_tips_och_tolka_inte_om_oforandrad_artikel(conn, monkeypatch):
    fyll(conn)
    monkeypatch.setattr(tipsinsamling, "hamta_sida", lambda url, **k: "<p>Match 1: Speltips: 1</p>")
    claude = FalskClaude({"tips": [{"matchnr": 1, "tecken": "1", "p1": None, "px": None, "p2": None,
                                    "sammanfattning": "Etta."}]})
    stat = tipsinsamling.samla(conn, claude, [FalskSajt()], nu=NU)
    assert stat == {"artiklar": 1, "tolkade": 1, "tips": 1, "fel": 0}
    assert "1. Manchester United – Tottenham" in claude.anrop[0]
    rad = conn.execute("SELECT t.tecken, k.namn FROM tips t JOIN kallor k ON k.id = t.kalla_id").fetchone()
    assert tuple(rad) == ("1", "testsajt.se")
    # Samma artikel igen → inget nytt Claude-anrop
    tipsinsamling.samla(conn, claude, [FalskSajt()], nu="2026-10-10T12:00:00Z")
    assert len(claude.anrop) == 1


def test_trasigt_claude_svar_stoppar_inte_insamlingen(conn, monkeypatch):
    fyll(conn)
    monkeypatch.setattr(tipsinsamling, "hamta_sida", lambda url, **k: "<p>text</p>")

    def kastar(*a):
        raise AiFel("avböjde")
    stat = tipsinsamling.samla(conn, kastar, [FalskSajt()], nu=NU)
    assert stat["fel"] == 1 and stat["tolkade"] == 0
    assert conn.execute("SELECT COUNT(*) FROM tips t JOIN kallor k ON k.id = t.kalla_id "
                        "WHERE k.namn = 'testsajt.se'").fetchone()[0] == 0


# ---------- kommentarer ----------

def svar_for_alla(fraga):
    import json, re
    data = json.loads(fraga.split("\n", 1)[1])
    return {"kommentarer": [{"matchnr": u["matchnr"], "kommentar": f"Kommentar {u['matchnr']}."} for u in data]}


def test_kommentarer_skrivs_och_hamnar_i_exporten(conn):
    fyll(conn)
    berakna_prognoser(conn)
    claude = FalskClaude(svar_for_alla)
    k = export.bygg_kupong(conn, 4974, nu="2026-10-10T13:30:00Z")
    assert kommentarer.uppdatera(conn, claude, k) == 13
    assert kommentarer.uppdatera(conn, claude, k) == 0          # oförändrat underlag
    assert len(claude.anrop) == 1
    k2 = export.bygg_kupong(conn, 4974, nu="2026-10-10T13:30:00Z")
    assert k2["matcher"][0]["kommentar"] == "Kommentar 1."

    # Ändrade streck på match 2 → bara den skrivs om
    k2["matcher"][1]["streck"] = {"1": 80.0, "X": 12.0, "2": 8.0}
    assert kommentarer.uppdatera(conn, claude, k2) == 1
    assert '"matchnr": 2' in claude.anrop[1] and '"matchnr": 1,' not in claude.anrop[1]


def test_sdk_tar_emot_parametrarna_vi_skickar():
    """Körs bara där anthropic är installerat (Python 3.10+, t.ex. i CI)."""
    anthropic = pytest.importorskip("anthropic")
    import inspect
    params = inspect.signature(anthropic.Anthropic(api_key="test").beta.messages.create).parameters
    for namn in ("model", "max_tokens", "system", "messages", "output_config", "betas", "fallbacks"):
        assert namn in params, f"anthropic {anthropic.__version__} saknar parametern {namn}"


def test_gemini_sdk_tar_emot_vart_format():
    """Körs bara där google-genai är installerat (Python 3.10+, t.ex. i CI)."""
    pytest.importorskip("google.genai")
    from google.genai import interactions as gi
    from pipeline.ai.extraktion import SCHEMA
    f = gi.TextResponseFormat.model_validate({"type": "text", "mime_type": "application/json", "schema": SCHEMA})
    assert f.schema_ == SCHEMA
    g = gi.GenerationConfig.model_validate({"thinking_level": "low", "max_output_tokens": 8000})
    assert g.max_output_tokens == 8000


def test_leverantor_valjs_efter_nyckel(monkeypatch):
    from pipeline.ai import klient
    for k in ("GEMINI_API_KEY", "ANTHROPIC_API_KEY", "AI_LEVERANTOR"):
        monkeypatch.delenv(k, raising=False)
    assert klient.leverantor() is None
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    assert klient.leverantor() == "claude"
    monkeypatch.setenv("GEMINI_API_KEY", "y")
    assert klient.leverantor() == "gemini"
    monkeypatch.setenv("AI_LEVERANTOR", "claude")
    assert klient.leverantor() == "claude"
