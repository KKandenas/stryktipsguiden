"""Hämtning av webbsidor från tipssajter: respekterar robots.txt, cachar och pausar mellan anrop.

Svenska Spel och The Odds API är API:er och går via http.hamta_json; det här är för vanliga sidor.
"""
from __future__ import annotations

import hashlib
import logging
import re
import time
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, Optional
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import requests

from . import config
from .http import HamtningsFel, session

log = logging.getLogger(__name__)

CACHE_DIR = config.ROOT / "data" / "cache"
PAUS_PER_DOMAN = 2.0      # sekunder mellan anrop till samma sajt

_robots: Dict[str, Optional[RobotFileParser]] = {}
_senast: Dict[str, float] = {}


class Blockerad(HamtningsFel):
    """robots.txt förbjuder sidan, eller sajten blockerar automatiska anrop."""


def _vanta(doman: str) -> None:
    sedan = time.monotonic() - _senast.get(doman, 0)
    if sedan < PAUS_PER_DOMAN:
        time.sleep(PAUS_PER_DOMAN - sedan)
    _senast[doman] = time.monotonic()


def tolka_robots(text: str) -> RobotFileParser:
    rp = RobotFileParser()
    rp.parse(text.splitlines())
    return rp


def tillats(url: str) -> bool:
    delar = urlsplit(url)
    doman = f"{delar.scheme}://{delar.netloc}"
    if doman not in _robots:
        try:
            _vanta(delar.netloc)
            r = session().get(doman + "/robots.txt", timeout=config.HTTP_TIMEOUT)
            if r.status_code == 200 and "text/html" not in r.headers.get("content-type", ""):
                _robots[doman] = tolka_robots(r.text)
            elif 400 <= r.status_code < 500 and r.status_code not in (401, 403, 429):
                _robots[doman] = None            # ingen robots.txt = allt tillåtet
            else:
                _robots[doman] = tolka_robots("User-agent: *\nDisallow: /")  # blockerad/oklar: avstå
        except requests.RequestException as e:
            log.warning("Kunde inte läsa robots.txt för %s (%s) – avstår", doman, e)
            _robots[doman] = tolka_robots("User-agent: *\nDisallow: /")
    rp = _robots[doman]
    return rp is None or rp.can_fetch(config.USER_AGENT, url)


def _cachefil(url: str) -> Path:
    return CACHE_DIR / (hashlib.sha1(url.encode()).hexdigest() + ".html")


def hamta_sida(url: str, max_alder_h: float = 6) -> str:
    """HTML/XML för en sida. Läser från cachen om den är färskare än max_alder_h."""
    fil = _cachefil(url)
    if fil.exists() and time.time() - fil.stat().st_mtime < max_alder_h * 3600:
        return fil.read_text(encoding="utf-8")
    if not tillats(url):
        raise Blockerad(f"robots.txt tillåter inte {url}")
    _vanta(urlsplit(url).netloc)
    try:
        r = session().get(url, timeout=config.HTTP_TIMEOUT)
    except requests.RequestException as e:
        raise HamtningsFel(f"Nätverksfel mot {url}: {e}") from e
    if r.status_code in (403, 429) or "challenges.cloudflare.com" in r.text[:5000]:
        raise Blockerad(f"{url} blockerar automatiska anrop ({r.status_code})")
    if r.status_code != 200:
        raise HamtningsFel(f"{url} svarade {r.status_code}")
    r.encoding = r.encoding or "utf-8"
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fil.write_text(r.text, encoding="utf-8")
    return r.text


class _Text(HTMLParser):
    HOPPA = {"script", "style", "noscript", "nav", "header", "footer", "aside", "form", "svg", "iframe"}
    BLOCK = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "tr", "section", "article", "table"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.djup = 0
        self.delar = []

    def handle_starttag(self, tag, attrs):
        if tag in self.HOPPA:
            self.djup += 1
        elif tag in self.BLOCK:
            self.delar.append("\n")

    def handle_endtag(self, tag):
        if tag in self.HOPPA and self.djup:
            self.djup -= 1
        elif tag in self.BLOCK:
            self.delar.append("\n")

    def handle_data(self, data):
        if not self.djup:
            self.delar.append(data)


def html_till_text(html: str) -> str:
    p = _Text()
    p.feed(html)
    text = "".join(p.delar).replace("\xa0", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]
