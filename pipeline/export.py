"""Exporterar en omgång till docs/kupong.json, som är det enda appen läser.

Format (version 1), sannolikheter som andelar 0–1 och streck i procent:

{
  "formatversion": 1,
  "genererad": "2026-10-10T13:00:00Z",
  "modell": {"version": "odds-v1", "beskrivning": "..."},
  "omgang": {"id": 4974, "datum": "2026-10-10", "spelstopp": "...Z", "status": "oppen",
             "omsattning": 26061816.0, "radpris": 1, "utdelning": {"13": 59266.0, ...} | null},
  "matcher": [{
      "nr": 1, "hemmalag": "...", "bortalag": "...", "liga": "...", "land": "...", "avspark": "...Z",
      "chans":  {"1": 0.55, "X": 0.24, "2": 0.21} | null,
      "chans_kalla": "modell" | "streck" | null,
      "streck": {"1": 65, "X": 20, "2": 15} | null, "streck_tid": "...Z" | null,
      "varde":  {"1": -0.10, "X": 0.04, "2": 0.06} | null,
      "odds":   {"antal_bolag": 3, "snitt": {"1": 1.75, "X": 4.3, "2": 4.7}} | null,
      "tips":   [{"kalla": "Tio tidningars tips", "tecken": "1", "text": "5-1-4 av 10 tidningar"}],
      "kommentar": null,
      "resultat": "1" | null, "mal": "2-1" | null
  }]
}

"statistik": {"aktiv_modell", "modeller": [{version, brier, logloss, traff, antal}], "kallor": [...],
              "ligor": [...], "senaste": [{omgang, datum, modell_ratt, folket_ratt}]} | null
  (träff = andel matcher där mest sannolika tecknet gick in; modell_ratt = antal rätt för en
   enkelrad med modellens favorittecken, folket_ratt = samma med mest streckade tecknet)

status: "oppen" (före spelstopp), "stangd" (väntar på resultat), "avgjord", "installd".
chans_kalla "streck" betyder att odds saknades och att strecken används som nödlösning (inget värde räknas då).
"""
from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from typing import Optional

from . import config
from .model.modeller import BOLAG_START, MODELLER, STANDARD_MODELL, las_underlag, vald_version
from .model.sannolikhet import varde
from .tid import nu_utc

log = logging.getLogger(__name__)

FORMATVERSION = 1
TECKEN = ("1", "X", "2")


class ExportFel(Exception):
    pass


def _tripel(t, decimaler: int = 4) -> Optional[dict]:
    if t is None:
        return None
    return {k: round(v, decimaler) for k, v in zip(TECKEN, t)}


def valj_omgang(conn: sqlite3.Connection, nu: str) -> Optional[int]:
    """Närmaste öppna omgång, annars den senaste."""
    r = conn.execute("SELECT id FROM omgangar WHERE spelstopp > ? ORDER BY spelstopp LIMIT 1", (nu,)).fetchone()
    if r is None:
        r = conn.execute("SELECT id FROM omgangar ORDER BY spelstopp DESC LIMIT 1").fetchone()
    return r[0] if r else None


def bygg_kupong(conn: sqlite3.Connection, omgang_id: int, nu: Optional[str] = None,
                dolj_resultat: bool = False) -> dict:
    nu = nu or nu_utc()
    modell = MODELLER[vald_version(conn)]
    o = conn.execute("SELECT * FROM omgangar WHERE id = ?", (omgang_id,)).fetchone()
    if o is None:
        raise ExportFel(f"Omgång {omgang_id} finns inte")

    if o["installd"]:
        status = "installd"
    elif o["spelstopp"] > nu or dolj_resultat:
        status = "oppen"
    elif o["utdelning_13"] is None:
        status = "stangd"
    else:
        status = "avgjord"
    visa_resultat = status == "avgjord"

    matcher = []
    for m in conn.execute("SELECT * FROM matcher WHERE omgang_id = ? ORDER BY matchnr", (omgang_id,)):
        fore = min(o["spelstopp"], nu)
        u = las_underlag(conn, m["id"], fore)
        # Vald modell i första hand; saknar den prognos för matchen används odds-v1.
        p = conn.execute("SELECT p1, px, p2 FROM prognoser WHERE match_id = ? AND modellversion IN (?, ?) "
                         "ORDER BY modellversion = ? DESC LIMIT 1",
                         (m["id"], modell.version, STANDARD_MODELL, modell.version)).fetchone()

        chans, kalla = None, None
        if p is not None:
            chans, kalla = (p[0], p[1], p[2]), "modell"
        elif u.streck is not None:
            s = sum(u.streck)
            chans, kalla = tuple(x / s for x in u.streck), "streck"

        bolag = {b: t for b, t in u.odds.items() if b != BOLAG_START} or u.odds
        odds = None
        if bolag:
            n = len(bolag)
            odds = {"antal_bolag": n,
                    "snitt": _tripel(tuple(sum(t[i] for t in bolag.values()) / n for i in range(3)), 2)}

        tips = [{"kalla": r["namn"], "tecken": r["tecken"], "text": r["sammanfattning"]}
                for r in conn.execute("SELECT k.namn, t.tecken, t.sammanfattning FROM tips t "
                                      "JOIN kallor k ON k.id = t.kalla_id WHERE t.match_id = ? ORDER BY k.namn",
                                      (m["id"],))]

        kommentar = conn.execute("SELECT text FROM kommentarer WHERE match_id = ?", (m["id"],)).fetchone()

        matcher.append({
            "nr": m["matchnr"], "hemmalag": m["hemmalag"], "bortalag": m["bortalag"],
            "liga": m["liga"], "land": m["land"], "avspark": m["avspark"],
            "chans": _tripel(chans), "chans_kalla": kalla,
            "streck": _tripel(u.streck, 1), "streck_tid": u.streck_tid,
            "varde": _tripel(varde(chans, u.streck)) if kalla == "modell" and u.streck else None,
            "odds": odds, "tips": tips, "kommentar": kommentar[0] if kommentar else None,
            "resultat": m["resultat"] if visa_resultat else None,
            "mal": (f"{m['mal_hemma']}-{m['mal_borta']}"
                    if visa_resultat and m["mal_hemma"] is not None else None),
        })

    if len(matcher) != 13:
        raise ExportFel(f"Omgång {omgang_id} har {len(matcher)} matcher, väntade 13")

    return {
        "formatversion": FORMATVERSION,
        "genererad": nu,
        "modell": {"version": modell.version, "beskrivning": modell.beskrivning},
        "omgang": {
            "id": o["id"], "datum": o["datum"], "spelstopp": o["spelstopp"], "status": status,
            "omsattning": o["omsattning"], "radpris": 1,
            "utdelning": ({str(n): o[f"utdelning_{n}"] for n in (13, 12, 11, 10)} if visa_resultat else None),
        },
        "matcher": matcher,
        "statistik": bygg_statistik(conn, modell.version),
    }


def _argmax_ratt(p, resultat) -> bool:
    return p is not None and resultat is not None and p["1X2".index(resultat)] >= max(p) - 1e-9


def bygg_statistik(conn: sqlite3.Connection, version: str, antal_omgangar: int = 10) -> Optional[dict]:
    """Hur bra modellen och källorna har träffat historiskt (från statistiksteget)."""
    modeller = [{"version": r["modellversion"], "beskrivning": MODELLER[r["modellversion"]].beskrivning,
                 "brier": round(r["brier"], 4), "logloss": round(r["logloss"], 4),
                 "traff": round(r["traff"], 3), "antal": r["antal"]}
                for r in conn.execute("SELECT * FROM modellstatistik WHERE liga = 'Alla' ORDER BY logloss")
                if r["modellversion"] in MODELLER]
    if not modeller:
        return None
    kallor = [{"namn": r[0], "brier": round(r[1], 4), "traff": round(r[2], 3) if r[2] is not None else None,
               "antal": r[3]}
              for r in conn.execute("""SELECT k.namn, s.brier, s.traff, s.antal_matcher FROM kallstatistik s
                                       JOIN kallor k ON k.id = s.kalla_id WHERE s.liga = 'Alla' AND s.antal_matcher >= 50
                                       ORDER BY s.brier""")]
    ligor = [{"liga": r[0], "brier": round(r[1], 4), "traff": round(r[2], 3), "antal": r[3]}
             for r in conn.execute("""SELECT liga, brier, traff, antal FROM modellstatistik
                                      WHERE modellversion = ? AND liga != 'Alla' AND antal >= 100
                                      ORDER BY antal DESC LIMIT 6""", (version,))]

    senaste = []
    for o in conn.execute("""SELECT id, datum FROM omgangar WHERE utdelning_13 IS NOT NULL AND installd = 0
                             ORDER BY id DESC LIMIT ?""", (antal_omgangar,)).fetchall():
        modell_ratt = folket_ratt = 0
        for m in conn.execute("""SELECT m.resultat,
                                   (SELECT json_array(p1, px, p2) FROM prognoser WHERE match_id = m.id
                                      AND modellversion IN (?, ?) ORDER BY modellversion = ? DESC LIMIT 1),
                                   (SELECT json_array(p1, px, p2) FROM streck WHERE match_id = m.id
                                      ORDER BY tidpunkt DESC LIMIT 1)
                                 FROM matcher m WHERE m.omgang_id = ?""",
                              (version, STANDARD_MODELL, version, o["id"])):
            modell_ratt += _argmax_ratt(json.loads(m[1]) if m[1] else None, m[0])
            folket_ratt += _argmax_ratt(json.loads(m[2]) if m[2] else None, m[0])
        senaste.append({"omgang": o["id"], "datum": o["datum"], "modell_ratt": modell_ratt, "folket_ratt": folket_ratt})

    return {"aktiv_modell": version, "modeller": modeller, "kallor": kallor, "ligor": ligor, "senaste": senaste}


def skriv(kupong: dict, sokvag: Path, kompakt: bool = False) -> bool:
    """Skriv filen om innehållet ändrats (bortsett från 'genererad'). Returnerar True om den skrevs."""
    if sokvag.exists():
        try:
            gammal = json.loads(sokvag.read_text(encoding="utf-8"))
            if {**gammal, "genererad": None} == {**kupong, "genererad": None}:
                return False
        except ValueError:
            log.warning("%s var trasig och skrivs över", sokvag)
    sokvag.parent.mkdir(parents=True, exist_ok=True)
    tmp = sokvag.with_suffix(".tmp")
    text = (json.dumps(kupong, ensure_ascii=False, separators=(",", ":")) if kompakt
            else json.dumps(kupong, ensure_ascii=False, indent=1))
    tmp.write_text(text + "\n", encoding="utf-8")
    tmp.replace(sokvag)
    return True


def bygg_historik(conn: sqlite3.Connection, nu: Optional[str] = None) -> dict:
    """Avgjorda omgångar med prognos för alla 13 matcher – underlag för backtestet i appen.

    Kompakt format (appen räknar raderna själv med optimizer.js, så logiken är exakt densamma):
    {"formatversion": 1, "genererad": "...", "modell": "odds-v1",
     "omgangar": [{"id": 4973, "datum": "2026-10-03",
                   "utdelning": [13 rätt, 12, 11, 10],          # kr per rad
                   "matcher": [[chans1, chansX, chans2, streck1, streckX, streck2, "resultat"], ...]}]}
    """
    version = vald_version(conn)
    omgangar = []
    for o in conn.execute("""SELECT id, datum, utdelning_13, utdelning_12, utdelning_11, utdelning_10 FROM omgangar
                             WHERE utdelning_13 IS NOT NULL AND installd = 0 ORDER BY id""").fetchall():
        matcher = []
        for m in conn.execute(
                """SELECT m.resultat,
                          (SELECT json_array(p1, px, p2) FROM prognoser WHERE match_id = m.id
                             AND modellversion IN (?, ?) ORDER BY modellversion = ? DESC LIMIT 1),
                          (SELECT json_array(p1, px, p2) FROM streck WHERE match_id = m.id
                             ORDER BY tidpunkt DESC LIMIT 1)
                   FROM matcher m WHERE m.omgang_id = ? ORDER BY m.matchnr""",
                (version, STANDARD_MODELL, version, o["id"])):
            if not m[0] or not m[1] or not m[2]:
                break
            chans, streck = json.loads(m[1]), json.loads(m[2])
            matcher.append([round(x, 4) for x in chans] + [round(x, 1) for x in streck] + [m[0]])
        if len(matcher) == 13:
            omgangar.append({"id": o["id"], "datum": o["datum"],
                             "utdelning": [o["utdelning_13"], o["utdelning_12"], o["utdelning_11"], o["utdelning_10"]],
                             "matcher": matcher})
    return {"formatversion": 1, "genererad": nu or nu_utc(), "modell": version, "omgangar": omgangar}


def exportera(conn: sqlite3.Connection, omgang_id: Optional[int] = None, sokvag: Optional[Path] = None,
              dolj_resultat: bool = False) -> Optional[int]:
    nu = nu_utc()
    omgang_id = omgang_id or valj_omgang(conn, nu)
    if omgang_id is None:
        log.warning("Export: databasen har inga omgångar")
        return None
    sokvag = sokvag or config.DOCS_DIR / "kupong.json"
    kupong = bygg_kupong(conn, omgang_id, nu, dolj_resultat)
    saknar = [m["nr"] for m in kupong["matcher"] if m["chans_kalla"] != "modell"]
    if saknar:
        log.warning("Export: omgång %s – modellprognos saknas för match %s", omgang_id, saknar)
    if skriv(kupong, sokvag):
        log.info("Export: %s skriven (omgång %s, %s)", sokvag.name, omgang_id, kupong["omgang"]["status"])
    else:
        log.info("Export: %s oförändrad", sokvag.name)
    if sokvag == config.DOCS_DIR / "kupong.json":
        historik = bygg_historik(conn)
        if skriv(historik, config.DOCS_DIR / "historik.json", kompakt=True):
            log.info("Export: historik.json skriven (%d omgångar)", len(historik["omgangar"]))
    return omgang_id
