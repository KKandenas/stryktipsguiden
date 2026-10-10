-- 004: Lärande från historik (fas 5).

-- Träffsäkerhet per modellversion och liga ('Alla' = totalt), mätt på samma matcher för alla versioner.
CREATE TABLE modellstatistik (
    modellversion   TEXT NOT NULL,
    liga            TEXT NOT NULL,
    brier           REAL,
    logloss         REAL,
    traff           REAL,          -- andel matcher där modellens mest sannolika tecken gick in
    antal           INTEGER,
    uppdaterad      TEXT,
    PRIMARY KEY (modellversion, liga)
);

-- Senast tränade vikter per modellversion (JSON), så att prognoser kan återskapas.
CREATE TABLE modellvikter (
    modellversion   TEXT PRIMARY KEY,
    parametrar      TEXT NOT NULL,
    antal           INTEGER,
    tranad          TEXT NOT NULL
);

-- Nyckel/värde, t.ex. vilken modellversion appen ska använda.
CREATE TABLE installningar (
    nyckel          TEXT PRIMARY KEY,
    varde           TEXT NOT NULL,
    uppdaterad      TEXT NOT NULL
);

-- Andel matcher där källans mest sannolika tecken (vid lika: något av dem) gick in.
ALTER TABLE kallstatistik ADD COLUMN traff REAL;

-- Svenska folkets streck räknas som en källa i källstatistiken.
INSERT OR IGNORE INTO kallor (namn, url, sprak) VALUES
    ('Svenska folket', 'https://spela.svenskaspel.se/stryktipset', 'sv');
