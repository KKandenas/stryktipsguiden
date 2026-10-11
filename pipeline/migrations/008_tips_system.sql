-- 008: Experternas system. Utöver huvudtipset (tecken) sparas vilka tecken skribenten har med i sitt
-- system/sin kupong för matchen, och hur många rader systemet har.
ALTER TABLE tips ADD COLUMN system TEXT;
ALTER TABLE tips ADD COLUMN system_rader INTEGER;
