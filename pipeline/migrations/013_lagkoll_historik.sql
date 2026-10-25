-- 013: Historik för Lagkoll, så att det senare går att analysera vilka nyheter som är värda något.
-- lagfakta och lagkoll skrivs över vid varje ny tolkning/analys; historiktabellerna fylls bara på (triggers),
-- med tidpunkten då en nyhet eller analys först dök upp. Jämfört med oddsens historik (tabellen odds) visar
-- det om marknaden redan hade reagerat på nyheten.

-- Varje ny eller ändrad uppsättning lagfakta per match, lag och källa
CREATE TABLE lagfakta_historik (
    id          INTEGER PRIMARY KEY,
    match_id    INTEGER NOT NULL REFERENCES matcher(id),
    sida        TEXT NOT NULL,
    kalla_id    INTEGER NOT NULL REFERENCES kallor(id),
    tidpunkt    TEXT NOT NULL,
    data        TEXT NOT NULL
);
CREATE INDEX lagfakta_historik_match ON lagfakta_historik (match_id);

CREATE TRIGGER lagfakta_ny AFTER INSERT ON lagfakta BEGIN
    INSERT INTO lagfakta_historik (match_id, sida, kalla_id, tidpunkt, data)
    VALUES (NEW.match_id, NEW.sida, NEW.kalla_id, NEW.tidpunkt, NEW.data);
END;
CREATE TRIGGER lagfakta_andrad AFTER UPDATE OF data ON lagfakta WHEN OLD.data IS NOT NEW.data BEGIN
    INSERT INTO lagfakta_historik (match_id, sida, kalla_id, tidpunkt, data)
    VALUES (NEW.match_id, NEW.sida, NEW.kalla_id, NEW.tidpunkt, NEW.data);
END;

-- Oddsen (1, X, 2) som analysen utgick från, så att justeringen kan mätas exakt
ALTER TABLE lagkoll ADD COLUMN odds TEXT;

-- Varje analys (en ny rad varje gång Lagkoll gör om analysen för en match)
CREATE TABLE lagkoll_historik (
    id            INTEGER PRIMARY KEY,
    match_id      INTEGER NOT NULL REFERENCES matcher(id),
    tidpunkt      TEXT NOT NULL,
    odds          TEXT,
    p1            REAL NOT NULL,
    px            REAL NOT NULL,
    p2            REAL NOT NULL,
    skrallrisk    TEXT,
    motivering    TEXT,
    faktorer      TEXT NOT NULL,
    underlag      TEXT NOT NULL
);
CREATE INDEX lagkoll_historik_match ON lagkoll_historik (match_id);

CREATE TRIGGER lagkoll_ny AFTER INSERT ON lagkoll BEGIN
    INSERT INTO lagkoll_historik (match_id, tidpunkt, odds, p1, px, p2, skrallrisk, motivering, faktorer, underlag)
    VALUES (NEW.match_id, NEW.tidpunkt, NEW.odds, NEW.p1, NEW.px, NEW.p2, NEW.skrallrisk, NEW.motivering,
            NEW.faktorer, NEW.underlag);
END;
CREATE TRIGGER lagkoll_andrad AFTER UPDATE ON lagkoll WHEN OLD.underlag_hash IS NOT NEW.underlag_hash BEGIN
    INSERT INTO lagkoll_historik (match_id, tidpunkt, odds, p1, px, p2, skrallrisk, motivering, faktorer, underlag)
    VALUES (NEW.match_id, NEW.tidpunkt, NEW.odds, NEW.p1, NEW.px, NEW.p2, NEW.skrallrisk, NEW.motivering,
            NEW.faktorer, NEW.underlag);
END;

-- Det som redan finns blir första raden i historiken
INSERT INTO lagfakta_historik (match_id, sida, kalla_id, tidpunkt, data)
    SELECT match_id, sida, kalla_id, tidpunkt, data FROM lagfakta;
INSERT INTO lagkoll_historik (match_id, tidpunkt, odds, p1, px, p2, skrallrisk, motivering, faktorer, underlag)
    SELECT match_id, tidpunkt, odds, p1, px, p2, skrallrisk, motivering, faktorer, underlag FROM lagkoll;
