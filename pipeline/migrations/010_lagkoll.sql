-- Lagkoll (skuggmodell): lagfakta ur förhandsartiklar, ligatabeller och tränarbyten från Wikipedia,
-- och AI-analysen per match. Prognosen sparas dessutom i prognoser som 'lagkoll-v1'.

-- Lagfakta per match och lag, en rad per källa (senaste tolkningen vinner).
-- data (JSON): {"franvaro": [{"spelare", "orsak", "status", "nyckelspelare"}], "form", "tabellplats", "sammanhang"}
CREATE TABLE lagfakta (
    match_id    INTEGER NOT NULL REFERENCES matcher(id),
    sida        TEXT NOT NULL CHECK (sida IN ('hemma', 'borta')),
    kalla_id    INTEGER NOT NULL REFERENCES kallor(id),
    tidpunkt    TEXT NOT NULL,
    data        TEXT NOT NULL,
    PRIMARY KEY (match_id, sida, kalla_id)
);

-- Senaste ligatabellen per liga (skrivs över vid varje hämtning).
CREATE TABLE ligatabeller (
    land        TEXT NOT NULL,
    liga        TEXT NOT NULL,
    lag         TEXT NOT NULL,
    plats       INTEGER,
    spelade     INTEGER,
    vunna       INTEGER,
    oavgjorda   INTEGER,
    forlorade   INTEGER,
    gjorda      INTEGER,
    inslappta   INTEGER,
    poang       INTEGER,
    PRIMARY KEY (land, liga, lag)
);

-- Var tabellen kom ifrån och när, plus tränarbyten (JSON-lista) från samma sida.
CREATE TABLE ligakallor (
    land        TEXT NOT NULL,
    liga        TEXT NOT NULL,
    url         TEXT NOT NULL,
    hamtad      TEXT NOT NULL,
    tranarbyten TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (land, liga)
);

-- AI-analysen per match. underlag_hash: analysen görs om bara när underlaget ändrats.
CREATE TABLE lagkoll (
    match_id      INTEGER PRIMARY KEY REFERENCES matcher(id),
    tidpunkt      TEXT NOT NULL,
    underlag_hash TEXT NOT NULL,
    p1            REAL NOT NULL,
    px            REAL NOT NULL,
    p2            REAL NOT NULL,
    skrallrisk    TEXT,
    motivering    TEXT,
    faktorer      TEXT NOT NULL DEFAULT '[]',
    underlag      TEXT NOT NULL DEFAULT '{}'
);
