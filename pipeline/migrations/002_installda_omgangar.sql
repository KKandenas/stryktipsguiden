-- 002: Svenska Spel kan ställa in en hel omgång (insatserna betalas tillbaka). Den har då inga
-- resultat och ingen utdelning, och ska varken vänta på resultat eller användas i backtest.
ALTER TABLE omgangar ADD COLUMN installd INTEGER NOT NULL DEFAULT 0;
