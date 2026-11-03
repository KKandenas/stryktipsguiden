"""Hälsokontroll: hittar driftproblem som annars märks först när någon tittar i appen.

Körs av .github/workflows/halsa.yml var annan timme. Hittas något skapar arbetsflödet ett ärende (issue)
med etiketten "driftlarm", och GitHub mejlar ägaren. Ärendet stängs när allt fungerar igen. Vad varje
larm betyder och vad man gör åt det står i DRIFT.md.

Kontrollen läser bara databasen; den anropar inga API:er och ändrar ingen data.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from typing import List, Optional

from . import config, schema
from .tid import parse_iso

MIN_KREDITER = 50
MAX_TIMMAR_UTAN_START = 3
RESULTAT_EFTER_H = 8         # timmar efter sista avspark som resultatet senast ska finnas


def _svensk(nu: datetime) -> datetime:
    return nu.astimezone(schema.SVENSK_TID)


def _iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def kontrollera(conn: sqlite3.Connection, nu: datetime, starter: Optional[int] = None) -> List[dict]:
    """Lista med problem: {"kod", "rubrik", "text"}. Tom lista = allt fungerar.

    starter: antal starter av pipelinen de senaste MAX_TIMMAR_UTAN_START timmarna (från GitHub), eller None."""
    fel: List[dict] = []
    sv = _svensk(nu)

    def larm(kod, rubrik, text):
        fel.append({"kod": kod, "rubrik": rubrik, "text": text})

    if starter == 0:
        larm("inga_starter", "Pipelinen har inte startats på flera timmar",
             f"Ingen körning av Pipeline de senaste {MAX_TIMMAR_UTAN_START} timmarna. Oftast har nyckeln hos "
             "cron-job.org gått ut eller kontot där pausats.")

    oppna = conn.execute("SELECT id, spelstopp FROM omgangar WHERE spelstopp > ? AND installd = 0 ORDER BY spelstopp",
                         (_iso(nu),)).fetchall()
    # Ingen kupong: från tisdag 12:00 till lördag 12:00 ska veckans omgång finnas
    mitt_i_veckan = (sv.weekday() == 1 and sv.hour >= 12) or sv.weekday() in (2, 3, 4) or (sv.weekday() == 5 and sv.hour < 12)
    if not oppna and mitt_i_veckan:
        larm("ingen_kupong", "Veckans kupong saknas",
             "Det finns ingen öppen omgång i databasen. Svenska Spel kan ha publicerat sent, eller så har "
             "hämtningen från Svenska Spel slutat fungera.")

    # Odds saknas för en kupongmatch (från tisdag 12:00, då första uppdateringen borde vara gjord)
    efter_tisdag = sv.weekday() >= 2 or (sv.weekday() == 1 and sv.hour >= 12)
    for oid, _ in oppna:
        if not efter_tisdag:
            break
        saknas = conn.execute("""
            SELECT m.matchnr, m.hemmalag, m.bortalag, m.land, m.liga FROM matcher m
            WHERE m.omgang_id = ? AND m.installd = 0 AND NOT EXISTS (
                SELECT 1 FROM odds o WHERE o.match_id = m.id AND o.bolag NOT LIKE 'svenskaspel%')
            ORDER BY m.matchnr""", (oid,)).fetchall()
        if saknas:
            rader = []
            for nr, h, b, land, liga in saknas:
                okand = (land, liga) not in config.LIGA_TILL_ODDSAPI
                rader.append(f"match {nr} {h}–{b} ({land}/{liga})" + (" – liganamnet saknas i config.py" if okand else ""))
            larm("odds_saknas", "Odds saknas för kupongmatcher",
                 f"Omgång {oid}: inga odds från spelbolagen för " + "; ".join(rader) + ".")

    # AI: senaste körningen misslyckades helt eller stoppades
    r = conn.execute("SELECT varde, uppdaterad FROM installningar WHERE nyckel = 'ai_status'").fetchone()
    if r and parse_iso(r[1]) > nu - timedelta(days=2):
        ai = json.loads(r[0])
        if ai.get("konfigurerad") is False:
            larm("ai_nyckel", "Gemini-nyckeln saknas", "GEMINI_API_KEY är inte inlagd som GitHub Secret.")
        elif ai.get("misslyckade", 0) >= 3 and not ai.get("lyckade"):
            larm("ai_fel", "AI-anropen misslyckas",
                 f"Senaste körningen: {ai.get('misslyckade')} misslyckade och inga lyckade anrop till Gemini"
                 + (f" (stoppad: {ai['stoppad']})" if ai.get("stoppad") else "") + ".")

    r = conn.execute("SELECT varde FROM installningar WHERE nyckel = 'oddsapi_krediter_kvar'").fetchone()
    if r and int(r[0]) < MIN_KREDITER:
        larm("krediter", "Oddskrediterna håller på att ta slut",
             f"{r[0]} krediter kvar hos The Odds API (larm under {MIN_KREDITER}).")

    # Resultat saknas länge efter sista matchen
    gamla = conn.execute("""
        SELECT o.id, MAX(m.avspark) FROM omgangar o JOIN matcher m ON m.omgang_id = o.id
        WHERE o.installd = 0 AND o.utdelning_13 IS NULL AND o.spelstopp BETWEEN ? AND ?
        GROUP BY o.id""", (_iso(nu - timedelta(days=10)), _iso(nu))).fetchall()
    for oid, sista in gamla:
        if sista and parse_iso(sista) + timedelta(hours=RESULTAT_EFTER_H) < nu:
            larm("resultat_saknas", "Resultat och utdelning saknas",
                 f"Omgång {oid} är inte rättad trots att sista matchen startade {sista[:16].replace('T', ' ')} UTC.")
    return fel


def som_markdown(fel: List[dict], nu: datetime) -> str:
    koder = ",".join(sorted(f["kod"] for f in fel))
    rader = [f"<!-- koder: {koder} -->",
             f"Hälsokontrollen {_svensk(nu).strftime('%Y-%m-%d %H:%M')} hittade {len(fel)} problem:", ""]
    for f in fel:
        rader += [f"### {f['rubrik']}", f["text"], ""]
    rader += ["Vad du gör åt det: se [DRIFT.md](https://github.com/KKandenas/stryktipsguiden/blob/main/DRIFT.md#larm). Ärendet stängs av sig självt "
              "när kontrollen inte hittar något längre."]
    return "\n".join(rader)
