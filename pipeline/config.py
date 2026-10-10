"""Gemensam konfiguration. Hemligheter läses från miljövariabler, aldrig från filer i repot."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("STRYKTIPS_DB", ROOT / "data" / "stryktips.db"))
MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
DOCS_DIR = ROOT / "docs"

USER_AGENT = "Stryktipshjalpen/0.1 (hobbyprojekt; https://github.com/)"
HTTP_TIMEOUT = 20

# Svenska Spels interna API (det som webbplatsen själv använder). Se DATAKALLOR.md.
SVS_BASE = "https://api.spela.svenskaspel.se/draw/1/stryktipset"

# The Odds API (valfri). https://the-odds-api.com/liveapi/guides/v4/
ODDS_API_KEY = os.environ.get("ODDS_API_KEY", "").strip()
ODDS_API_BASE = "https://api.the-odds-api.com/v4"
ODDS_API_REGIONS = "eu,uk"

# (land, liga) som Svenska Spel skriver dem -> sport-nyckel hos The Odds API.
# Ligor som saknas här hoppas över med en logg-rad; lägg till fler vid behov.
LIGA_TILL_ODDSAPI = {
    ("England", "Premier League"): "soccer_epl",
    ("England", "Championship"): "soccer_efl_champ",
    ("England", "League One"): "soccer_england_league1",
    ("England", "League Two"): "soccer_england_league2",
    ("England", "FA-cupen"): "soccer_fa_cup",
    ("Sverige", "Allsvenskan"): "soccer_sweden_allsvenskan",
    ("Sverige", "Superettan"): "soccer_sweden_superettan",
    ("Skottland", "Premiership"): "soccer_spl",
    ("Tyskland", "Bundesliga"): "soccer_germany_bundesliga",
    ("Tyskland", "2. Bundesliga"): "soccer_germany_bundesliga2",
    ("Spanien", "La Liga"): "soccer_spain_la_liga",
    ("Italien", "Serie A"): "soccer_italy_serie_a",
    ("Frankrike", "Ligue 1"): "soccer_france_ligue_one",
    ("Nederländerna", "Eredivisie"): "soccer_netherlands_eredivisie",
    ("Portugal", "Primeira Liga"): "soccer_portugal_primeira_liga",
    ("Norge", "Eliteserien"): "soccer_norway_eliteserien",
    ("Danmark", "Superligaen"): "soccer_denmark_superliga",
    ("Internationell", "UEFA Nations League"): "soccer_uefa_nations_league",
    ("Internationell", "VM-kval Europa"): "soccer_fifa_world_cup_qualifiers_europe",
    ("Internationell", "EM-kval"): "soccer_uefa_euro_qualification",
}
