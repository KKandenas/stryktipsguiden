-- 009: Frysta förslag. Vid varje körning medan omgången är öppen sparas en ögonblicksbild av kupongen
-- (chans, streck, värde, odds, tips, kommentarer per match). Efter spelstopp visar appen den senaste
-- bilden – alltså läget vid sista körningen före spelstopp – så att förslaget och rättningen gäller
-- samma rader som man kunde se innan man spelade.
CREATE TABLE frysta_kuponger (
    omgang_id   INTEGER PRIMARY KEY REFERENCES omgangar(id),
    kupong      TEXT NOT NULL,     -- JSON: {"matcher": {nr: {…fält…}}}
    frusen      TEXT NOT NULL      -- tidpunkt för ögonblicksbilden (UTC)
);
