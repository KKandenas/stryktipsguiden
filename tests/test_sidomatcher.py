"""Matcher utanför kupongen: tips utan AI, odds och resultat från football-data.co.uk, och träningen av tips-v1."""
import random
from datetime import date

from pipeline import sidomatcher
from pipeline.model import ensemble
from pipeline.model import statistik
from pipeline.model.modeller import TipsModell
from pipeline.sources import footballdata
from pipeline.sources.tipssajter import footballpredictions as fp
from pipeline.sources.tipssajter import sportsmole as sm


def test_tipsraden_lases_utan_ai():
    t = "Lineups: Sa; Doyle  We say: Wolverhampton Wanderers 2-1 Portsmouth  While Portsmouth may have momentum"
    assert sidomatcher.las_tips(t, sidomatcher.SM_TIPS, "wolves", "portsmouth") == ("1", 2, 1)
    t = "What is our prediction?  Our prediction for this match: Wolves 1 - 1 Portsmouth  Betting Tips"
    assert sidomatcher.las_tips(t, sidomatcher.FP_TIPS, "wolves", "portsmouth") == ("X", 1, 1)
    # Bortalaget först i raden: målen vänds så att tecknet gäller hemmalaget
    t = "We say: Portsmouth 0-2 Wolves  Text"
    assert sidomatcher.las_tips(t, sidomatcher.SM_TIPS, "wolves", "portsmouth") == ("1", 2, 0)
    assert sidomatcher.las_tips("Inget tips här", sidomatcher.SM_TIPS, "a", "b") is None


def test_football_data_csv_med_odds_utan_marginal():
    csv = ("ï»¿Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,AvgH,AvgD,AvgA\n"
           "E1,14/10/2026,20:00,Lincoln,West Ham,0,6,A,4.6,4.0,1.7\n"
           "E1,15/10/26,20:00,Hull,Derby,1,1,D,,,\n"
           "E1,18/10/2026,15:00,Wolves,Stoke,,,,2.0,3.4,3.8\n")       # inte spelad än
    rader = footballdata.tolka(csv)
    assert [r[:4] for r in rader] == [("2026-10-14", "Lincoln", "West Ham", "2"), ("2026-10-15", "Hull", "Derby", "X")]
    assert [r[5:] for r in rader] == [(0, 6), (1, 1)]
    p = rader[0][4]
    assert abs(sum(p) - 1) < 1e-9 and p[2] > 0.5
    assert rader[1][4] is None
    assert footballdata.sasong(date(2026, 10, 19)) == "2627" and footballdata.sasong(date(2027, 5, 1)) == "2627"


def test_samla_tips_hamtar_nya_artiklar_en_gang(conn, monkeypatch):
    lista = ('<a href="/footballpredictions/championshippredictions/wolves-vs-portsmouth-prediction-20-10-2026/">'
             '<a href="/footballpredictions/championshippredictions/hull-vs-derby-prediction-1-1-2026/">')  # för gammal
    sidor = {
        f"{fp.BAS}/footballpredictions/championshippredictions/": lista,
        f"{fp.BAS}/footballpredictions/championshippredictions/wolves-vs-portsmouth-prediction-20-10-2026/":
            "<p>Our prediction for this match: Wolves 0 - 2 Portsmouth</p><p>Mer</p>",
        f"{sm.BAS}/football/championship/":
            '<a href="/football/hull-city/preview/hull-vs-derby-prediction-team-news-lineups_1.html">',
        f"{sm.BAS}/football/hull-city/preview/hull-vs-derby-prediction-team-news-lineups_1.html":
            "<p>Oct 18, 2026</p><p>We say: Hull City 1-1 Derby County</p><p>Slut</p>",
    }
    hamtade = []

    def hamta(url, **_):
        hamtade.append(url)
        return sidor.get(url, "")
    monkeypatch.setattr(sidomatcher, "hamta_sida", hamta)
    stat = sidomatcher.samla_tips(conn, idag=date(2026, 10, 19))
    assert stat == {"footballpredictions.com": 1, "sportsmole.co.uk": 1}
    tips = {r[0]: r[1:] for r in conn.execute("SELECT kalla, liga_kod, datum, tecken FROM sidotips")}
    assert tips == {"footballpredictions.com": ("E1", "2026-10-20", "2"), "sportsmole.co.uk": ("E1", "2026-10-18", "X")}
    # Andra gången hämtas bara listsidorna
    hamtade.clear()
    assert sidomatcher.samla_tips(conn, idag=date(2026, 10, 19)) == {}
    assert hamtade and not any("-prediction-" in u for u in hamtade)


def _infoga(conn, kalla, kod, hemma, borta, datum, tecken):
    conn.execute("INSERT INTO sidotips (url, kalla, liga_kod, hemmalag, bortalag, datum, tecken, hamtad) "
                 "VALUES (?, ?, ?, ?, ?, ?, ?, '2026-10-01T00:00:00Z')",
                 (f"{kalla}/{hemma}-{borta}-{datum}", kalla, kod, hemma, borta, datum, tecken))


def test_observationer_parar_tips_med_resultat_och_hoppar_over_kupongen(conn):
    conn.execute("INSERT INTO omgangar (id, datum, spelstopp) VALUES (1, '2026-10-17', '2026-10-17T13:59:00Z')")
    conn.execute("INSERT INTO matcher (id, omgang_id, matchnr, hemmalag, bortalag, liga, land, avspark) "
                 "VALUES (1, 1, 1, 'Norwich', 'Portsmouth', 'Championship', 'England', '2026-10-17T14:00:00Z')")
    for datum, h, b, res in [("2026-10-14", "Lincoln", "West Ham", "2"), ("2026-10-17", "Norwich", "Portsmouth", "1"),
                             ("2026-10-18", "Hull", "Derby", "X")]:
        conn.execute("INSERT INTO sidomatcher (liga_kod, datum, hemmalag, bortalag, resultat, p1, px, p2) "
                     "VALUES ('E1', ?, ?, ?, ?, 0.4, 0.3, 0.3)", (datum, h, b, res))
    _infoga(conn, "sportsmole.co.uk", "E1", "lincoln city", "west ham united", "2026-10-14", "2")
    _infoga(conn, "footballpredictions.com", "E1", "lincoln", "west ham", "2026-10-15", "1")   # en dag fel datum: ok
    _infoga(conn, "sportsmole.co.uk", "E1", "norwich", "portsmouth", "2026-10-17", "1")        # stod på kupongen
    _infoga(conn, "sportsmole.co.uk", "E1", "wolves", "stoke", "2026-10-18", "1")              # inget resultat än
    obs = sidomatcher.observationer(conn)
    assert len(obs) == 1
    datum, o = obs[0]
    assert datum == "2026-10-14" and o.utfall == "2"
    assert set(o.kallor) == {"odds", "sportsmole.co.uk", "footballpredictions.com"}
    assert o.kallor["sportsmole.co.uk"] == ensemble.pseudosannolikhet("2")


def test_matcher_utanfor_kupongen_lar_tipsarens_vikt(conn):
    rng = random.Random(3)
    sido = []
    for i in range(600):
        utfall = rng.choice("1X2")
        # Tipsaren har rätt 70 % av gångerna, oddsen vet ingenting
        tecken = utfall if rng.random() < 0.7 else rng.choice([t for t in "1X2" if t != utfall])
        kallor = {"odds": (1 / 3, 1 / 3, 1 / 3), "sportsmole.co.uk": ensemble.pseudosannolikhet(tecken)}
        sido.append((f"2026-{1 + i // 60:02d}-{1 + i % 28:02d}", ensemble.Observation(kallor, utfall)))
    _, utan = statistik.walk_forward(conn, [], TipsModell.version)
    _, med = statistik.walk_forward(conn, [], TipsModell.version, sido)
    assert utan is None
    assert med.w["sportsmole.co.uk"] > 0.3


def test_serietabeller_totalt_hemma_borta(conn):
    from pipeline import serietabell
    rader = [("2026-08-09", "Hull", "Derby", "1", 2, 0), ("2026-08-16", "Derby", "Wolves", "X", 1, 1),
             ("2026-08-23", "Wolves", "Hull", "2", 0, 3), ("2026-06-01", "Hull", "Wolves", "1", 5, 0)]   # förra säsongen
    for d, h, b, r, mh, mb in rader:
        conn.execute("""INSERT INTO sidomatcher (liga_kod, datum, hemmalag, bortalag, resultat, mal_hemma, mal_borta)
                        VALUES ('E1', ?, ?, ?, ?, ?, ?)""", (d, h, b, r, mh, mb))
    t = serietabell.berakna(conn, "E1", date(2026, 11, 4))
    assert [(r["lag"], r["s"], r["p"], r["gm"] - r["im"]) for r in t["totalt"]] == [
        ("Hull", 2, 6, 5), ("Derby", 2, 1, -2), ("Wolves", 2, 1, -3)]
    assert [(r["lag"], r["p"]) for r in t["hemma"]] == [("Hull", 3), ("Derby", 1), ("Wolves", 0)]
    assert [(r["lag"], r["s"], r["p"]) for r in t["borta"]] == [("Hull", 1, 3), ("Wolves", 1, 1), ("Derby", 1, 0)]
    assert t["till"] == "2026-08-23"
    matcher = [{"id": 1, "land": "England", "liga": "Championship", "hemmalag": "Hull City", "bortalag": "Derby County"},
               {"id": 2, "land": "England", "liga": "FA Cup", "hemmalag": "Crewe", "bortalag": "Wimbledon"}]
    tabeller, per = serietabell.for_kupong(conn, matcher, date(2026, 11, 4))
    assert list(tabeller) == ["England/Championship"]
    assert {k: v for k, v in per[1].items() if k != "senaste"} == {"nyckel": "England/Championship", "hemma": "Hull", "borta": "Derby"}
    assert per[1]["senaste"]["hemma"] == [
        {"datum": "2026-08-23", "mot": "Wolves", "plats": "b", "gjorda": 3, "insl": 0},
        {"datum": "2026-08-09", "mot": "Derby", "plats": "h", "gjorda": 2, "insl": 0}]
    assert list(per) == [1]


def test_poangavdrag_fran_officiella_tabellen(conn):
    from pipeline import serietabell
    totalt = [{"lag": "Southampton", "s": 13, "v": 8, "o": 3, "f": 2, "gm": 28, "im": 13, "p": 27},
              {"lag": "Swansea", "s": 13, "v": 8, "o": 2, "f": 3, "gm": 20, "im": 13, "p": 26}]
    for lag, s, p in (("Southampton", 13, 23), ("Swansea City", 13, 26)):
        conn.execute("INSERT INTO ligatabeller (land, liga, lag, spelade, poang) VALUES ('England', 'Championship', ?, ?, ?)", (lag, s, p))
    ut = serietabell.avdrag(conn, "England", "Championship", totalt)
    assert [(r["lag"], r["p"], r.get("avdrag")) for r in ut] == [("Swansea", 26, None), ("Southampton", 23, 4)]
