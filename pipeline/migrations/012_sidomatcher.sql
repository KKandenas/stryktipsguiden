-- 012: Matcher utanför kupongen, så att tipsarnas vikter i Med experter lärs snabbare.
-- sidomatcher: resultat och snittodds (utan marginal) från football-data.co.uk för alla matcher i ligorna.
-- sidotips: Sports Moles och FootballPredictions tips för samma matcher, lästa ur texten utan AI.
--   En rad per artikel; tecken är NULL om artikeln saknade tips eller var för gammal (den hämtas då inte igen).
CREATE TABLE sidomatcher (
    id INTEGER PRIMARY KEY,
    liga_kod TEXT NOT NULL,
    datum TEXT NOT NULL,
    hemmalag TEXT NOT NULL,
    bortalag TEXT NOT NULL,
    resultat TEXT NOT NULL,
    p1 REAL, px REAL, p2 REAL,
    UNIQUE (liga_kod, datum, hemmalag, bortalag)
);
CREATE TABLE sidotips (
    url TEXT PRIMARY KEY,
    kalla TEXT NOT NULL,
    liga_kod TEXT NOT NULL,
    hemmalag TEXT,
    bortalag TEXT,
    datum TEXT,
    tecken TEXT,
    hemma_mal INTEGER,
    borta_mal INTEGER,
    hamtad TEXT NOT NULL
);
CREATE INDEX sidotips_liga_datum ON sidotips (liga_kod, datum);
