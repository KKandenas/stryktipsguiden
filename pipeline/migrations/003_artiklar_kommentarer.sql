-- 003: Tipssajter och AI-kommentarer (fas 4).

-- En rad per hämtad artikel. Själva texten sparas inte (upphovsrätt och storlek), bara en hash
-- så att vi vet om artikeln ändrats sedan Claude senast läste den.
CREATE TABLE artiklar (
    url              TEXT PRIMARY KEY,
    kalla_id         INTEGER NOT NULL REFERENCES kallor(id),
    omgang_id        INTEGER NOT NULL REFERENCES omgangar(id),
    titel            TEXT,
    hamtad           TEXT NOT NULL,
    innehall_hash    TEXT NOT NULL,
    extraherad       TEXT,            -- när Claude senast tolkade artikeln
    extraherad_hash  TEXT,            -- innehållets hash vid den tolkningen
    antal_tips       INTEGER
);

-- AI-kommentar per match. underlag_hash avgör om kommentaren behöver skrivas om.
CREATE TABLE kommentarer (
    match_id         INTEGER PRIMARY KEY REFERENCES matcher(id),
    text             TEXT NOT NULL,
    underlag_hash    TEXT NOT NULL,
    modell           TEXT,
    skapad           TEXT NOT NULL
);

INSERT OR IGNORE INTO kallor (namn, url, sprak) VALUES
    ('speltips.se', 'https://speltips.se', 'sv'),
    ('sportsgambler.com', 'https://www.sportsgambler.com', 'en');
