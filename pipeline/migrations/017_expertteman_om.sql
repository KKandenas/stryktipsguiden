-- 017: De första 104 märkningarna (provkörning 25 oktober 2026) angav lag som "hemma"/"borta" och blandade
-- ibland ihop lagen. Nu anger AI lagets namn och koden kopplar det till rätt sida; märk om allt.
UPDATE expertkommentarer SET teman = NULL, markt = NULL;
