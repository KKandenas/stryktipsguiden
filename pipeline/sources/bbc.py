"""Ligatabeller med form från BBC Sport (för matchdetaljen och Lagkoll).

Tabellsidorna (/sport/football/<liga>/table) är tillåtna i robots.txt och renderas på servern. Varje rad har
placering, lag, matcher, V/O/F, mål, poäng och formen i de senaste sex matcherna ("Result Win" osv, äldst
först). Sidorna hämtas via webb.hamta_sida, som respekterar robots.txt och cachar.
"""
from __future__ import annotations

import html as htmllib
import re
from typing import List, Optional, Tuple

from ..webb import hamta_sida

BAS = "https://www.bbc.com/sport/football/{}/table"

# (land, ligor som Svenska Spel skriver dem) -> BBC:s namn på ligan i adressen
SIDOR = [
    ("England", ["Premier League"], "premier-league"),
    ("England", ["Championship"], "championship"),
    ("England", ["League One"], "league-one"),
    ("England", ["League Two"], "league-two"),
    ("Skottland", ["Premiership"], "scottish-premiership"),
    ("Sverige", ["Allsvenskan"], "swedish-allsvenskan"),
    ("Tyskland", ["Bundesliga"], "german-bundesliga"),
    ("Spanien", ["La Liga", "LaLiga"], "spanish-la-liga"),
    ("Italien", ["Serie A"], "italian-serie-a"),
    ("Frankrike", ["Ligue 1"], "french-ligue-one"),
    ("Nederländerna", ["Eredivisie"], "dutch-eredivisie"),
    ("Portugal", ["Primeira Liga"], "portuguese-primeira-liga"),
    ("Danmark", ["Superligan", "Superligaen"], "danish-superliga"),
    ("Belgien", ["Pro League"], "belgian-pro-league"),
    ("USA", ["MLS"], "us-major-league"),
]
RESULTAT = {"Win": "W", "Draw": "D", "Loss": "L"}


def url(land: str, liga: Optional[str]) -> Optional[str]:
    l = (liga or "").lower()
    for sl, ligor, slug in SIDOR:
        if sl == land and l in (x.lower() for x in ligor):
            return BAS.format(slug)
    return None


def _text(cell: str) -> str:
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", cell))).strip()


def tolka_tabell(sida: str) -> List[dict]:
    """Rader ur första tabellen: plats, lag, spelade … poäng och form (senaste matchen först)."""
    m = re.search(r"<table\b.*?</table>", sida, re.S)
    if not m:
        return []
    ut = []
    for rad in re.findall(r"<tr\b.*?</tr>", m.group(0), re.S):
        celler = re.findall(r"<t[dh]\b.*?</t[dh]>", rad, re.S)
        if len(celler) < 9:
            continue
        # Formen står både som bokstav och som dold text ("Result Win"); den dolda är entydig.
        form = "".join(RESULTAT[r] for r in re.findall(r"Result (Win|Draw|Loss)", celler[-1]))
        varden = [_text(c) for c in celler]
        forsta = re.match(r"(\d+)\s+(.+)", varden[0])      # "1 Swansea City" – placering och lag i samma cell
        if not forsta:
            continue
        tal = [int(v.replace("+", "").replace("−", "-")) if re.fullmatch(r"[+−-]?\d+", v) else None
               for v in varden[1:9]]
        if None in (tal[0], tal[7]):
            continue
        ut.append({"plats": int(forsta.group(1)), "lag": forsta.group(2).strip(), "spelade": tal[0], "vunna": tal[1],
                   "oavgjorda": tal[2], "forlorade": tal[3], "gjorda": tal[4], "inslappta": tal[5],
                   "poang": tal[7], "form": form[::-1] or None})
    return ut


def hamta_tabell(land: str, liga: Optional[str]) -> Tuple[Optional[str], List[dict]]:
    """(url, tabell). Kastar HamtningsFel om sidan inte går att hämta."""
    u = url(land, liga)
    if not u:
        return None, []
    return u, tolka_tabell(hamta_sida(u, max_alder_h=6))
