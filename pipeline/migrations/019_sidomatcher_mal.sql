-- Mål i matcherna utanför kupongen, så att hemma- och bortatabeller kan räknas fram (pipeline/serietabell.py).
ALTER TABLE sidomatcher ADD COLUMN mal_hemma INTEGER;
ALTER TABLE sidomatcher ADD COLUMN mal_borta INTEGER;
