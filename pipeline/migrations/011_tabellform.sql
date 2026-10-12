-- 011: Formen (senaste matcherna, senaste först, t.ex. "WWLDW") i ligatabellen. Tabellen hämtas från
-- BBC Sport där ligan finns (med form), annars från Wikipedia (utan form).
ALTER TABLE ligatabeller ADD COLUMN form TEXT;
