-- 015: Experternas kommentar per match, för att leta mönster i det som skrivs om matcher som skräller.
-- Hämtas ur tipssajternas arkiv utan AI (pipeline/expertarkiv.py), i dag Tipsmedoss sedan december 2020.
-- Tecknet sparas här och inte i tips, så att Med experter inte påverkas förrän det är ett eget beslut.
CREATE TABLE expertkommentarer (
    match_id    INTEGER NOT NULL REFERENCES matcher(id),
    kalla_id    INTEGER NOT NULL REFERENCES kallor(id),
    tecken      TEXT,
    text        TEXT NOT NULL,
    url         TEXT NOT NULL,
    PRIMARY KEY (match_id, kalla_id)
);

-- Arkivartiklar som redan lästs (omgang_id NULL = ingen omgång hittades), så att de inte hämtas igen
CREATE TABLE arkivartiklar (
    url         TEXT PRIMARY KEY,
    kalla_id    INTEGER NOT NULL REFERENCES kallor(id),
    omgang_id   INTEGER REFERENCES omgangar(id),
    matcher     INTEGER NOT NULL DEFAULT 0,
    hamtad      TEXT NOT NULL
);
