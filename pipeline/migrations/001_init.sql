-- 001: Grundschema. Alla tidpunkter lagras som UTC i ISO 8601 ("2026-10-10T13:59:00Z").

CREATE TABLE omgangar (
    id              INTEGER PRIMARY KEY,          -- Svenska Spels drawNumber
    datum           TEXT NOT NULL,                -- spelstoppets datum, svensk tid (YYYY-MM-DD)
    spelstopp       TEXT NOT NULL,
    omsattning      REAL,
    utdelning_13    REAL,
    utdelning_12    REAL,
    utdelning_11    REAL,
    utdelning_10    REAL,
    vinnare_13      INTEGER,
    vinnare_12      INTEGER,
    vinnare_11      INTEGER,
    vinnare_10      INTEGER
);

CREATE TABLE matcher (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    omgang_id       INTEGER NOT NULL REFERENCES omgangar(id),
    matchnr         INTEGER NOT NULL CHECK (matchnr BETWEEN 1 AND 13),
    hemmalag        TEXT NOT NULL,
    bortalag        TEXT NOT NULL,
    liga            TEXT,
    land            TEXT,
    avspark         TEXT,
    resultat        TEXT CHECK (resultat IN ('1', 'X', '2')),
    mal_hemma       INTEGER,
    mal_borta       INTEGER,
    installd        INTEGER NOT NULL DEFAULT 0,   -- 1 = inställd/lottad
    svs_match_id    INTEGER,
    UNIQUE (omgang_id, matchnr)
);

CREATE TABLE streck (
    match_id        INTEGER NOT NULL REFERENCES matcher(id),
    tidpunkt        TEXT NOT NULL,
    p1              REAL NOT NULL,
    px              REAL NOT NULL,
    p2              REAL NOT NULL,
    PRIMARY KEY (match_id, tidpunkt)
);

CREATE TABLE odds (
    match_id        INTEGER NOT NULL REFERENCES matcher(id),
    tidpunkt        TEXT NOT NULL,
    bolag           TEXT NOT NULL,
    o1              REAL NOT NULL CHECK (o1 > 1),
    ox              REAL NOT NULL CHECK (ox > 1),
    o2              REAL NOT NULL CHECK (o2 > 1),
    PRIMARY KEY (match_id, tidpunkt, bolag)
);

CREATE TABLE kallor (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    namn            TEXT NOT NULL UNIQUE,
    url             TEXT,
    sprak           TEXT
);

-- En rad per match och källa; nyare tips ersätter äldre.
CREATE TABLE tips (
    match_id        INTEGER NOT NULL REFERENCES matcher(id),
    kalla_id        INTEGER NOT NULL REFERENCES kallor(id),
    tidpunkt        TEXT NOT NULL,
    tecken          TEXT,
    p1              REAL,
    px              REAL,
    p2              REAL,
    sammanfattning  TEXT,
    PRIMARY KEY (match_id, kalla_id)
);

CREATE TABLE prognoser (
    match_id        INTEGER NOT NULL REFERENCES matcher(id),
    modellversion   TEXT NOT NULL,
    p1              REAL NOT NULL,
    px              REAL NOT NULL,
    p2              REAL NOT NULL,
    skapad          TEXT,
    PRIMARY KEY (match_id, modellversion)
);

CREATE TABLE kallstatistik (
    kalla_id        INTEGER NOT NULL REFERENCES kallor(id),
    liga            TEXT NOT NULL,
    brier           REAL,
    antal_matcher   INTEGER,
    uppdaterad      TEXT,
    PRIMARY KEY (kalla_id, liga)
);

CREATE INDEX idx_matcher_omgang ON matcher(omgang_id);

INSERT INTO kallor (namn, url, sprak) VALUES
    ('Tio tidningars tips', 'https://spela.svenskaspel.se/stryktipset', 'sv');
