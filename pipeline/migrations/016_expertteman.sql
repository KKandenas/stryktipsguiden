-- 016: AI-märkning av experternas kommentarer med en fast temalista (pipeline/expertteman.py).
-- teman (JSON): [{"tema", "lag"}], där lag är "hemma", "borta" eller "bada". markt: när kommentaren märktes
-- (NULL = inte märkt än). Märkningen görs nattetid söndag–torsdag med det som är kvar av Geminis dagskvot.
ALTER TABLE expertkommentarer ADD COLUMN teman TEXT;
ALTER TABLE expertkommentarer ADD COLUMN markt TEXT;
