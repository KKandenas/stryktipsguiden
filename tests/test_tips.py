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


# ---------- hurbra.se och Sports Mole ----------

def test_hurbra_adress_fran_spelstopp():
    from pipeline.sources.tipssajter.hurbra import adress
    assert adress("2026-10-10T13:59:00Z") == "https://hurbra.se/stryktipset-10-oktober-2026/"
    assert adress("2026-05-24T13:59:00Z") == "https://hurbra.se/stryktipset-24-maj-2026/"


def test_hurbra_utan_artikel_ger_tom_lista(monkeypatch):
    from pipeline.http import HamtningsFel
    from pipeline.sources.tipssajter import hurbra

    def saknas(url, **k):
        raise HamtningsFel(f"{url} svarade 404")
    monkeypatch.setattr(hurbra, "hamta_sida", saknas)
    assert hurbra.Hurbra().hitta_artiklar([], "2026-10-10T13:59:00Z") == []


def test_sportsmole_lankar_lag_och_datum():
    from pipeline.sources.tipssajter.sportsmole import LANK, Sportsmole, avsparksdatum, para_ihop
    html = ('<a href="/football/huddersfield-town/preview/huddersfield-vs-sheff-weds-prediction-team-news-lineups_606509.html">'
            '<a href="/football/blackburn-rovers/preview/blackburn-vs-cardiff-prediction-team-news-lineups_606461.html">')
    lankar = LANK.findall(html)
    matcher = [Match(13, "Huddersfield", "Sheffield W", "League One", "England", "2026-10-10T14:00:00Z"),
               Match(6, "Blackburn", "Cardiff", "Championship", "England", "2026-10-10T14:00:00Z")]
    a = {x.matchnr[0]: x for x in para_ihop(matcher, lankar)}
    assert a[13].url.endswith("huddersfield-vs-sheff-weds-prediction-team-news-lineups_606509.html")
    assert a[6].url.endswith("_606461.html")
    text = "Preview: Blackburn Rovers vs Cardiff City  Championship  Blackburn  Oct 10, 2026 3.00pm  We say: 2-1"
    assert avsparksdatum(text).day == 10
    assert Sportsmole().kontrollera(text, a[6], matcher) is True
    gammal = text.replace("Oct 10, 2026", "Mar 14, 2026")      # förra säsongens möte
    assert Sportsmole().kontrollera(gammal, a[6], matcher) is False


def test_tips_tolkas_inte_efter_avspark(conn, monkeypatch):
    """Efter avspark kan sidan visa resultatet – då får tipset inte tolkas om."""
    fyll(conn)
    # Tidig avspark (12:30 svensk tid) för match 2 – den är igång när pipelinen körs 12:00Z
    conn.execute("UPDATE matcher SET avspark = '2026-10-10T10:30:00Z' WHERE matchnr = 2")
    conn.commit()
    monkeypatch.setattr(tipsinsamling, "hamta_sida", lambda url, **k: "<p>Live: 2-0</p>")
    claude = FalskClaude({"tips": []})
    tipsinsamling.samla(conn, claude, [FalskSajt()], nu="2026-10-10T12:00:00Z")
    assert len(claude.anrop) == 1
    assert "1. Manchester United – Tottenham" in claude.anrop[0]
    assert "2. Chelsea – Bournemouth" not in claude.anrop[0]


# ---------- svenska tipssajter ----------

def test_bettingstugan_valjer_huvudanalysen_for_omgangen():
    from pipeline.sources.tipssajter.bettingstugan import valj_lank
    html = ('<a href="https://bettingstugan.se/speltips/stryktipset-lordag-10-10-tidiga-analysen">'
            '<a href="/speltips/stryktipset-lordag-10-10-2">'
            '<a href="https://bettingstugan.se/speltips/stryktipset-analys-tips-lordag-10-10">'
            '<a href="https://bettingstugan.se/speltips/stryktipset-analys-tips-lordag-3-10">')
    assert valj_lank(html, "2026-10-10T13:59:00Z") == "https://bettingstugan.se/speltips/stryktipset-analys-tips-lordag-10-10"
    assert valj_lank(html, "2026-10-24T13:59:00Z") is None


def test_tippat_markerar_valda_tecken_och_kontrollerar_datum():
    from pipeline.sources.tipssajter.tippat import Tippat
    html = ('<p>Lördag 10 oktober</p><td>Manchester United</td><td>Tottenham</td>'
            '<div class=" flex size-5 bg-gray-700 text-white">1</div><div class=" flex size-5">X</div>'
            '<div class=" flex size-5">2</div>')
    s = Tippat()
    text = html_till_text(s.forbered_html(html))
    assert "[VALT 1]" in text and "[VALT X]" not in text
    m = [Match(1, "Manchester United", "Tottenham", "Premier League", "England", "2026-10-10T16:30:00Z")]
    assert s.kontrollera(text, None, m) is True
    m2 = [Match(1, "Manchester United", "Tottenham", "Premier League", "England", "2026-10-17T14:00:00Z")]
    assert s.kontrollera(text, None, m2) is False


def test_gamblingcabin_publiceringsdatum():
    from pipeline.sources.tipssajter.gamblingcabin import Gamblingcabin, publicerad
    text = "Panelens spikar & drag  Publicerad:    9 oktober, 2026 16:10  Helgens Spik: Bolton"
    assert publicerad(text).day == 9
    s = Gamblingcabin()
    s._spelstopp = "2026-10-10T13:59:00Z"
    assert s.kontrollera(text, None, []) is True
    s._spelstopp = "2026-10-24T13:59:00Z"
    assert s.kontrollera(text, None, []) is False


def test_footballpredictions_lankar_med_datum():
    from pipeline.sources.tipssajter.footballpredictions import LANK
    from pipeline.sources.tipssajter.sportsgambler import para_ihop
    html = ('<a href="https://footballpredictions.com/footballpredictions/championshippredictions/'
            'blackburn-rovers-vs-cardiff-prediction-10-10-2026/">'
            '<a href="https://footballpredictions.com/footballpredictions/championshippredictions/'
            'blackburn-rovers-vs-cardiff-prediction-14-3-2026/">')
    lankar = [(p, h, b, f"{y}-{int(m):02d}-{int(d):02d}") for p, h, b, d, m, y in LANK.findall(html)]
    matcher = [Match(6, "Blackburn", "Cardiff", "Championship", "England", "2026-10-10T14:00:00Z")]
    a = para_ihop(matcher, lankar, bas="https://footballpredictions.com")
    assert len(a) == 1 and a[0].url.endswith("blackburn-rovers-vs-cardiff-prediction-10-10-2026/")
