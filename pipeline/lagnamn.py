"""Matchning av lagnamn mellan Svenska Spel (svenska namn) och andra källor (oftast engelska).

Strategi: normalisera båda namnen, slå upp alias, och jämför sedan med likhet + delsträngar.
Hittar matchningen fel lag: lägg till ett alias i ALIAS nedan (nyckel = normaliserat Svenska Spel-namn).
"""
from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher

# Ord som inte säger något om vilket lag det är.
_FYLLORD = {"fc", "afc", "cf", "sc", "ac", "if", "ik", "bk", "ff", "fk", "sk", "aif", "bois", "the", "and", "de"}

ALIAS = {
    # Landslag
    "kroatien": "croatia", "skottland": "scotland", "nordmakedonien": "north macedonia",
    "schweiz": "switzerland", "slovenien": "slovenia", "tyskland": "germany", "frankrike": "france",
    "spanien": "spain", "italien": "italy", "nederlanderna": "netherlands", "belgien": "belgium",
    "danmark": "denmark", "norge": "norway", "sverige": "sweden", "polen": "poland",
    "osterrike": "austria", "tjeckien": "czech republic", "ungern": "hungary", "rumanien": "romania",
    "grekland": "greece", "turkiet": "turkey", "irland": "republic of ireland",
    "nordirland": "northern ireland", "island": "iceland", "serbien": "serbia",
    "bosnien": "bosnia and herzegovina", "bosnien hercegovina": "bosnia and herzegovina",
    "ukraina": "ukraine", "albanien": "albania", "georgien": "georgia", "bulgarien": "bulgaria",
    "slovakien": "slovakia", "estland": "estonia", "lettland": "latvia", "litauen": "lithuania",
    "luxemburg": "luxembourg", "cypern": "cyprus", "faroarna": "faroe islands",
    "azerbajdzjan": "azerbaijan", "kazakstan": "kazakhstan", "armenien": "armenia",
    "vitryssland": "belarus", "belarus": "belarus", "moldavien": "moldova",
    # Klubbar
    "sporting lissabon": "sporting lisbon", "wolverhampton": "wolverhampton wanderers",
    "wolves": "wolverhampton wanderers", "man utd": "manchester united", "man city": "manchester city",
    "nottingham": "nottingham forest", "brighton": "brighton hove albion", "spurs": "tottenham hotspur",
    "inter": "inter milan", "bayern munchen": "bayern munich", "koln": "fc koln",
    "st mirren": "st mirren", "st johnstone": "st johnstone",
}


def normalisera(namn: str) -> str:
    s = unicodedata.normalize("NFKD", namn).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s.replace("&", " and "))
    s = re.sub(r"\s+", " ", s).strip()
    s = ALIAS.get(s, s)
    ord_ = [w for w in s.split() if w not in _FYLLORD]
    return " ".join(ord_) or s


def likhet(a: str, b: str) -> float:
    """0..1, hur troligt det är att a och b är samma lag."""
    na, nb = normalisera(a), normalisera(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    if _delmangd(na.split(), nb.split()) or _delmangd(nb.split(), na.split()):
        return 0.9                    # "tottenham" ⊂ "tottenham hotspur", "sheffield w" ⊂ "sheffield wednesday"
    return SequenceMatcher(None, na, nb).ratio()


def _delmangd(kort: list, lang: list) -> bool:
    """Varje ord i `kort` är början på ett eget ord i `lang` (så "w" räknas som "wednesday")."""
    kvar = list(lang)
    for w in kort:
        traff = next((x for x in kvar if x.startswith(w)), None)
        if traff is None:
            return False
        kvar.remove(traff)
    return True
