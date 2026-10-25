-- 014: Lagkolls justering uppdelad per faktor (JSON-lista), så att det senare går att mäta vilka typer av
-- nyheter som påverkar: [{"typ", "lag", "gynnar", "procentenheter"}], se lagkoll.FAKTORTYPER.
ALTER TABLE lagkoll ADD COLUMN delar TEXT NOT NULL DEFAULT '[]';
ALTER TABLE lagkoll_historik ADD COLUMN delar TEXT NOT NULL DEFAULT '[]';

DROP TRIGGER lagkoll_ny;
DROP TRIGGER lagkoll_andrad;
CREATE TRIGGER lagkoll_ny AFTER INSERT ON lagkoll BEGIN
    INSERT INTO lagkoll_historik (match_id, tidpunkt, odds, p1, px, p2, skrallrisk, motivering, faktorer, underlag, delar)
    VALUES (NEW.match_id, NEW.tidpunkt, NEW.odds, NEW.p1, NEW.px, NEW.p2, NEW.skrallrisk, NEW.motivering,
            NEW.faktorer, NEW.underlag, NEW.delar);
END;
CREATE TRIGGER lagkoll_andrad AFTER UPDATE ON lagkoll WHEN OLD.underlag_hash IS NOT NEW.underlag_hash BEGIN
    INSERT INTO lagkoll_historik (match_id, tidpunkt, odds, p1, px, p2, skrallrisk, motivering, faktorer, underlag, delar)
    VALUES (NEW.match_id, NEW.tidpunkt, NEW.odds, NEW.p1, NEW.px, NEW.p2, NEW.skrallrisk, NEW.motivering,
            NEW.faktorer, NEW.underlag, NEW.delar);
END;
