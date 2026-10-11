"""Exporterar en omgång till docs/kupong.json, som är det enda appen läser.

Format (version 1), sannolikheter som andelar 0–1 och streck i procent:

{
  "formatversion": 1,
  "genererad": "2026-10-10T13:00:00Z",
  "modell": {"version": "odds-v1", "beskrivning": "..."},
  "omgang": {"id": 4974, "datum": "2026-10-10", "spelstopp": "...Z", "status": "oppen",
             "omsattning": 26061816.0, "radpris": 1, "utdelning": {"13": 59266.0, ...} | null,
             "vinnare": {"13": 77, ...} | null},
  "matcher": [{
      "nr": 1, "hemmalag": "...", "bortalag": "...", "liga": "...", "land": "...", "avspark": "...Z",
      "chans":  {"1": 0.55, "X": 0.24, "2": 0.21} | null,
      "chans_kalla": "modell" | "streck" | null,
      "streck": {"1": 65, "X": 20, "2": 15} | null, "streck_tid": "...Z" | null,
      "varde":  {"1": -0.10, "X": 0.04, "2": 0.06} | null,
      "chans_tips", "varde_tips": samma sak enligt tips-v1 (odds + tipsare viktade efter träffsäkerhet) | null,
      "odds":   {"antal_bolag": 3, "snitt": {"1": 1.75, "X": 4.3, "2": 4.7},
                 "bolag": [{"bolag": "pinnacle", "1": 1.78, "X": 4.2, "2": 4.75}, …]} | null,
      "tips":   [{"kalla": "Tio tidningars tips", "tecken": "1", "text": "5-1-4 av 10 tidningar"}],
      "kommentar": null,
      "resultat": "1" | null, "mal": "2-1" | null
  }]
}

"tipsare_form": [{"namn", "grupp": "alla" | "England" | "Sverige" | "Övrigt", "poang", "antal",
                  "period": "8v" | "alla"}]   (bäst först per grupp; poäng: rätt spik 1, halvgardering ½,
                  helgardering ⅓)
matcher[].osaker: true om bedömningen bara bygger på Svenska Spels odds (eller strecken) – appen kräver
  då större avvikelse för värdeprick.

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
from .model.modeller import (BOLAG_START, MODELLER, STANDARD_MODELL, STARTVIKT_TIPS, TIPSKALLOR, las_underlag,
                             las_vikter, vald_version)
from .model.sannolikhet import varde
from datetime import timedelta

from .tid import nu_utc, parse_iso

log = logging.getLogger(__name__)

FORMATVERSION = 1
TECKEN = ("1", "X", "2")

# Bolag som visas i appen, i den här ordningen (övriga i bokstavsordning efter), högst MAX_BOLAG.
BOLAGSORDNING = ["pinnacle", "svenskaspel", "svenskaspel_start", "unibet_eu", "betsson", "nordicbet", "bet365",
                 "betfair_ex_eu", "williamhill", "coolbet", "betclic", "marathonbet", "sport888"]
MAX_BOLAG = 5
FORM_DAGAR = 56          # "senaste tiden" för tipsarnas form = 8 veckor
FORM_MIN = 10            # färre matcher än så → hela historiken används i stället


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
            ordning = sorted(bolag, key=lambda b: (BOLAGSORDNING.index(b) if b in BOLAGSORDNING else 99, b))
            bara_svs = set(bolag) <= {"svenskaspel", BOLAG_START}
            odds = {"antal_bolag": n, "bara_svenskaspel": bara_svs,
                    "snitt": _tripel(tuple(sum(t[i] for t in bolag.values()) / n for i in range(3)), 2),
                    "bolag": [{"bolag": b, **_tripel(bolag[b], 2)} for b in ordning[:MAX_BOLAG]]}

        tips = [{"kalla": r["namn"], "tecken": r["tecken"], "text": r["sammanfattning"]}
                for r in conn.execute("SELECT k.namn, t.tecken, t.sammanfattning FROM tips t "
                                      "JOIN kallor k ON k.id = t.kalla_id WHERE t.match_id = ? ORDER BY k.namn",
                                      (m["id"],))]

        kommentar = conn.execute("SELECT text FROM kommentarer WHERE match_id = ?", (m["id"],)).fetchone()
        pt = conn.execute("SELECT p1, px, p2 FROM prognoser WHERE match_id = ? AND modellversion = 'tips-v1'",
                          (m["id"],)).fetchone()
        chans_tips = (pt[0], pt[1], pt[2]) if pt else None

        matcher.append({
            "nr": m["matchnr"], "hemmalag": m["hemmalag"], "bortalag": m["bortalag"],
            "liga": m["liga"], "land": m["land"], "avspark": m["avspark"],
            "chans": _tripel(chans), "chans_kalla": kalla,
            "streck": _tripel(u.streck, 1), "streck_tid": u.streck_tid,
            "varde": _tripel(varde(chans, u.streck)) if kalla == "modell" and u.streck else None,
            # Osäkrare bedömning: bara Svenska Spels odds (hög marginal) eller inga odds alls
            "osaker": kalla != "modell" or bool(odds and odds["bara_svenskaspel"]),
            "chans_tips": _tripel(chans_tips),
            "varde_tips": _tripel(varde(chans_tips, u.streck)) if chans_tips and u.streck else None,
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
            "vinnare": ({str(n): o[f"vinnare_{n}"] for n in (13, 12, 11, 10)} if visa_resultat else None),
        },
        "matcher": matcher,
        "statistik": bygg_statistik(conn, modell.version),
        "tipsare_form": tipsare_form(conn, nu),
    }


def landsgrupp(land: Optional[str]) -> str:
    """Grupp för tipsarnas form: England och Sverige för sig, resten tillsammans."""
    return land if land in ("England", "Sverige") else "Övrigt"


def tipsare_form(conn: sqlite3.Connection, nu: str) -> list:
    """Hur bra varje tipsare träffat, totalt ("alla") och per landsgrupp (England/Sverige/Övrigt).

    Senaste FORM_DAGAR dagarna räknas i första hand; har tipsaren färre än FORM_MIN avgjorda matcher
    där används hela historiken (period "alla"). Poäng per tips: rätt spik = 1, rätt halvgardering = ½,
    rätt helgardering = ⅓, fel = 0 – så att garderingar inte ger gratis träffar. Sorterat bäst först."""
    grans = (parse_iso(nu) - timedelta(days=FORM_DAGAR)).strftime("%Y-%m-%dT%H:%M:%SZ")
    rader = conn.execute(
        """SELECT k.namn, t.tecken, m.resultat, m.avspark, m.land FROM tips t JOIN kallor k ON k.id = t.kalla_id
           JOIN matcher m ON m.id = t.match_id WHERE m.resultat IS NOT NULL AND t.tecken IS NOT NULL""").fetchall()
    per: dict = {}
    for namn, tecken, res, avspark, land in rader:
        p = 1 / len(tecken) if res in tecken else 0.0
        ny_ = avspark is not None and avspark >= grans
        for grupp in ("alla", landsgrupp(land)):
            d = per.setdefault((namn, grupp), {"alla": [], "8v": []})
            d["alla"].append(p)
            if ny_:
                d["8v"].append(p)
    ut = []
    for (namn, grupp), d in per.items():
        p, period = (d["8v"], "8v") if len(d["8v"]) >= FORM_MIN else (d["alla"], "alla")
        ut.append({"namn": namn, "grupp": grupp, "poang": round(sum(p) / len(p), 3), "antal": len(p), "period": period})
    return sorted(ut, key=lambda x: (x["grupp"], -(x["antal"] >= FORM_MIN), -x["poang"]))


def _argmax_ratt(p, resultat) -> bool:
    return p is not None and resultat is not None and p["1X2".index(resultat)] >= max(p) - 1e-9


def _traffar(p, res) -> bool:
    return p[TECKEN.index(res)] >= max(p) - 1e-9


def statistik_per_ar(conn: sqlite3.Connection, version: str) -> dict:
    """Träffsäkerhet för modeller, källor och ligor – för hela historiken ("alla") och från varje
    startår ("2023" = från 1 januari 2023). Modellerna jämförs på samma matcher."""
    from .model.ensemble import logloss, pseudosannolikhet
    from .model.sannolikhet import brier

    matcher = conn.execute("""SELECT m.id, o.datum, COALESCE(m.liga, 'Okänd'), m.resultat FROM matcher m
                              JOIN omgangar o ON o.id = m.omgang_id
                              WHERE m.resultat IS NOT NULL AND o.installd = 0""").fetchall()
    prog: dict = {}
    for mid, v, p1, px, p2 in conn.execute("SELECT match_id, modellversion, p1, px, p2 FROM prognoser"):
        if v in MODELLER:
            prog.setdefault(mid, {})[v] = (p1, px, p2)
    streck = {r[0]: (r[1], r[2], r[3]) for r in conn.execute(
        "SELECT match_id, p1, px, p2, MAX(tidpunkt) FROM streck GROUP BY match_id")}
    tips: dict = {}
    for mid, namn, p1, px, p2, tecken in conn.execute(
            "SELECT t.match_id, k.namn, t.p1, t.px, t.p2, t.tecken FROM tips t JOIN kallor k ON k.id = t.kalla_id"):
        if p1 is not None:
            tips.setdefault(mid, {})[namn] = (p1, px, p2)
        elif tecken:
            tips.setdefault(mid, {})[namn] = pseudosannolikhet(tecken)

    def block(fran: Optional[str]) -> Optional[dict]:
        urval = [m for m in matcher if fran is None or m[1] >= fran]
        min_n = 100 if fran is None else 30
        # Modeller: versioner med tillräckligt många prognoser, jämförda på gemensamma matcher
        antal = {}
        for mid, *_ in urval:
            for v in prog.get(mid, {}):
                antal[v] = antal.get(v, 0) + 1
        versioner = [v for v, n in antal.items() if n >= min_n]
        gemensamma = [m for m in urval if all(v in prog.get(m[0], {}) for v in versioner)]
        if not versioner or len(gemensamma) < min_n:
            return None
        modeller = []
        for v in versioner:
            b = ll = tr = 0.0
            for mid, _, _, res in gemensamma:
                p = prog[mid][v]
                b += brier(p, res); ll += logloss(p, res); tr += _traffar(p, res)
            n = len(gemensamma)
            modeller.append({"version": v, "beskrivning": MODELLER[v].beskrivning, "brier": round(b / n, 4),
                             "logloss": round(ll / n, 4), "traff": round(tr / n, 3), "antal": n})
        modeller.sort(key=lambda x: (x["logloss"], x["version"] != STANDARD_MODELL))
        # Källor: Svenska folket och tipsarna, var och en på sina egna matcher
        summor: dict = {}
        for mid, _, _, res in urval:
            kallor_m = dict(tips.get(mid, {}))
            if mid in streck and sum(streck[mid]) > 0:
                t = sum(streck[mid])
                kallor_m["Svenska folket"] = tuple(x / t for x in streck[mid])
            for namn, p in kallor_m.items():
                s_ = summor.setdefault(namn, [0.0, 0, 0])
                s_[0] += brier(p, res); s_[1] += _traffar(p, res); s_[2] += 1
        kallor = sorted(({"namn": k, "brier": round(v[0] / v[2], 4), "traff": round(v[1] / v[2], 3), "antal": v[2]}
                         for k, v in summor.items() if v[2] >= (50 if fran is None else 20)), key=lambda x: x["brier"])
        # Ligor: vald modell (eller basmodellen) per liga
        per_liga: dict = {}
        for mid, _, liga, res in urval:
            p = prog.get(mid, {}).get(version) or prog.get(mid, {}).get(STANDARD_MODELL)
            if p:
                l_ = per_liga.setdefault(liga, [0.0, 0, 0])
                l_[0] += brier(p, res); l_[1] += _traffar(p, res); l_[2] += 1
        ligor = sorted(({"liga": k, "brier": round(v[0] / v[2], 4), "traff": round(v[1] / v[2], 3), "antal": v[2]}
                        for k, v in per_liga.items() if v[2] >= min_n), key=lambda x: -x["antal"])[:6]
        return {"modeller": modeller, "kallor": kallor, "ligor": ligor}

    ar = sorted({m[1][:4] for m in matcher if any(m[0] in prog and v in prog[m[0]] for v in (STANDARD_MODELL,))})
    per_ar = {"alla": block(None)}
    for a in ar:
        b = block(f"{a}-01-01")
        # Hoppa över år som ger samma modellunderlag som "alla" (t.ex. första året med odds)
        if b and per_ar["alla"] and b["modeller"][0]["antal"] != per_ar["alla"]["modeller"][0]["antal"]:
            per_ar[a] = b
    return {k: v for k, v in per_ar.items() if v}


def bygg_statistik(conn: sqlite3.Connection, version: str, antal_omgangar: int = 10) -> Optional[dict]:
    """Hur bra modellen och källorna har träffat historiskt, totalt och från varje startår."""
    per_ar = statistik_per_ar(conn, version)
    if "alla" not in per_ar:
        return None
    modeller, kallor, ligor = per_ar["alla"]["modeller"], per_ar["alla"]["kallor"], per_ar["alla"]["ligor"]

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

    # Tipsarnas vikt i tips-v1 (skattad, eller startvikt om tipsaren har för få avgjorda matcher än)
    v = las_vikter(conn, "tips-v1")
    alla_kallor = {r[0]: (r[1], r[2], r[3]) for r in conn.execute(
        """SELECT k.namn, s.traff, s.brier, s.antal_matcher FROM kallstatistik s JOIN kallor k ON k.id = s.kalla_id
           WHERE s.liga = 'Alla'""")}
    tipsare = []
    for namn in TIPSKALLOR:
        skattad = v is not None and namn in v.w
        t, b, n = alla_kallor.get(namn, (None, None, 0))
        tipsare.append({"namn": namn, "vikt": round(v.w[namn], 3) if skattad else STARTVIKT_TIPS,
                        "skattad": skattad, "traff": round(t, 3) if t is not None else None, "antal": n or 0})
    oddsvikt = round(v.w.get("odds", 1.0), 3) if v else 1.0

    return {"aktiv_modell": version, "modeller": modeller, "kallor": kallor, "ligor": ligor, "senaste": senaste,
            "tipsare": tipsare, "tips_oddsvikt": oddsvikt, "per_ar": per_ar}


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
                   "matcher": [[chans1, chansX, chans2, streck1, streckX, streck2, "resultat",
                                [tipsviktad chans 1, X, 2] | null], ...]}]}
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
                             ORDER BY tidpunkt DESC LIMIT 1),
                          (SELECT json_array(p1, px, p2) FROM prognoser WHERE match_id = m.id
                             AND modellversion = 'tips-v1')
                   FROM matcher m WHERE m.omgang_id = ? ORDER BY m.matchnr""",
                (version, STANDARD_MODELL, version, o["id"])):
            if not m[0] or not m[1] or not m[2]:
                break
            chans, streck = json.loads(m[1]), json.loads(m[2])
            tips = [round(x, 4) for x in json.loads(m[3])] if m[3] else None
            matcher.append([round(x, 4) for x in chans] + [round(x, 1) for x in streck] + [m[0], tips])
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
        # Senast stängda omgången (för rättning i appen), även när en ny kupong har öppnat.
        senaste = conn.execute("SELECT id FROM omgangar WHERE spelstopp <= ? AND installd = 0 "
                               "ORDER BY spelstopp DESC LIMIT 1", (nu,)).fetchone()
        if senaste and skriv(bygg_kupong(conn, senaste[0], nu), config.DOCS_DIR / "senaste.json"):
            log.info("Export: senaste.json skriven (omgång %s)", senaste[0])
        historik = bygg_historik(conn)
        if skriv(historik, config.DOCS_DIR / "historik.json", kompakt=True):
            log.info("Export: historik.json skriven (%d omgångar)", len(historik["omgangar"]))
    return omgang_id
