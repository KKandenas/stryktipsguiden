-- 018: Övriga sajters kommentarer i expertkommentarer. De har inget arkiv, så det som finns är AI:ns
-- sammanfattning per match från tipsinsamlingen (tips.sammanfattning). typ skiljer dem från originaltext
-- (Tipsmedoss arkiv), så att analysen kan redovisa dem för sig.
ALTER TABLE expertkommentarer ADD COLUMN typ TEXT NOT NULL DEFAULT 'original';
