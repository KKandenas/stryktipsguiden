"""Experternas kommentarer ur Tipsmedoss arkiv: uppdelning per match utan AI och koppling till omgången."""
from datetime import date

from pipeline import expertarkiv, lagring
from pipeline.sources.svenskaspel import tolka_kupong
from tests.conftest import las_fixture

ARTIKEL = """Stryktipset 3/10 – analys

1. Manchester United – Tottenham, 1

Kaptenen är tillbaka och United har vunnit tre raka på hemmaplan.

Spurs saknar dock flera i backlinjen.

2. Chelsea – Bournemouth, 1X2

Svårtippad match där Chelsea underpresterat hela hösten.

13. Wrexham – Preston, X

Två jämna lag, krysset är bästa värdet.

Systemet: 96 rader, banken på match 4.
"""


def test_artikeln_delas_upp_per_match():
    delar = expertarkiv.dela_upp(ARTIKEL)
    assert [d[:4] for d in delar] == [(1, "Manchester United", "Tottenham", "1"), (2, "Chelsea", "Bournemouth", "1X2"),
                                      (13, "Wrexham", "Preston", "X")]
    assert delar[0][4] == "Kaptenen är tillbaka och United har vunnit tre raka på hemmaplan. Spurs saknar dock flera i backlinjen."
    assert delar[2][4] == "Två jämna lag, krysset är bästa värdet."          # systemet räknas inte till sista matchen


def test_arkivet_kopplas_till_omgangen_och_lases_bara_en_gang(conn, monkeypatch):
    lagring.spara_kupong(conn, tolka_kupong(las_fixture("svs_draw_4974.json")["draw"], "2026-10-10T07:00:00Z"))
    matcher = conn.execute("SELECT matchnr, hemmalag, bortalag FROM matcher ORDER BY matchnr").fetchall()
    # Artikeln har sajtens egna, kortare lagnamn och match 2 och 3 i omvänd ordning
    m1, m2, m3 = matcher[0], matcher[1], matcher[2]
    text = (f"1. {m1['hemmalag']} – {m1['bortalag']}, 1\n\nHemmalaget i form.\n\n"
            f"2. {m3['hemmalag']} – {m3['bortalag']}, X2\n\nBortalaget har ny tränare.\n\n"
            f"3. {m2['hemmalag']} – {m2['bortalag']}, 2\n\nDerby.\n\n")
    sidor = {expertarkiv.LISTA: '<a href="https://tipsmedoss.com/2026/stryktipsforslag/stryktipset-10-10-analys/">'
                                '<a href="https://tipsmedoss.com/2019/stryktipsforslag/stryktipset-9-3-analys/">',
             "https://tipsmedoss.com/2026/stryktipsforslag/stryktipset-10-10-analys/": text.replace("\n", "<br>")}
    hamtade = []

    def hamta(url, **_):
        hamtade.append(url)
        if url not in sidor:
            raise expertarkiv.HamtningsFel("404")
        return sidor[url]
    monkeypatch.setattr(expertarkiv, "hamta_sida", hamta)
    monkeypatch.setattr(expertarkiv, "html_till_text", lambda html: html.replace("<br>", "\n"))
    stat = expertarkiv.uppdatera(conn, max_sidor=3)
    assert stat == {"artiklar": 1, "matcher": 3, "utan_omgang": 0}          # artikeln från 2019 hoppas över
    rader = {r[0]: (r[1], r[2]) for r in conn.execute(
        "SELECT m.matchnr, e.tecken, e.text FROM expertkommentarer e JOIN matcher m ON m.id = e.match_id")}
    assert rader == {1: ("1", "Hemmalaget i form."), 2: ("2", "Derby."), 3: ("X2", "Bortalaget har ny tränare.")}
    hamtade.clear()
    assert expertarkiv.uppdatera(conn, max_sidor=3)["artiklar"] == 0
    assert all("analys" not in u for u in hamtade)


def test_rubrikvarianter():
    text = "5. Ipswich – Fulham, 1 2\n\nJämnt.\n\n12.Swansea – Norwich, 1x\n\nHemma.\n\n13. Luton – Stoke,\n\nOklart.\n\n3. Banken: Schweiz\n"
    assert [d[:4] for d in expertarkiv.dela_upp(text)] == [(5, "Ipswich", "Fulham", "12"), (12, "Swansea", "Norwich", "1X"),
                                                            (13, "Luton", "Stoke", "")]


def test_datum_ur_adressen():
    lista = '<a href="https://tipsmedoss.com/2021/stryktipsforslag/stryktipset-11-9-stryktipsforslag-analys/">'
    url, ar, dag, manad = expertarkiv.ARTIKEL.findall(lista)[0]
    assert date(int(ar), int(manad), int(dag)) == date(2021, 9, 11)
