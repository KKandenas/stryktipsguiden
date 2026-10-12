"""AI-anrop från pipelinen (aldrig från appen). Allt går genom anropa_json().

Två leverantörer, valda efter vilken nyckel som finns:
- Gemini (förval) via Googles SDK `google-genai`, nyckel GEMINI_API_KEY. Har en gratisnivå.
- Claude via Anthropics SDK `anthropic`, nyckel ANTHROPIC_API_KEY.
Finns båda används Gemini, om inte AI_LEVERANTOR=claude. Båda SDK:erna kräver Python 3.10+.
Saknas nyckel eller SDK hoppar AI-stegen över med en loggrad – resten av pipelinen fungerar ändå.
"""
from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Callable, Dict, Optional

log = logging.getLogger(__name__)

GEMINI_MODELL = os.environ.get("GEMINI_MODELL", "").strip() or "gemini-3.8-flash"  # kan sättas som repo-variabel
GEMINI_TANKANDE = "low"            # minimal | low | medium | high

CLAUDE_MODELL = "claude-opus-5-5"
CLAUDE_EFFORT = "medium"

MAX_FORSOK = 4                     # gratisnivån har låga gränser per minut och är ibland överbelastad
TILLFALLIGA_FEL = {429, 500, 502, 503, 504}

# Signaturen som resten av koden använder; tester skickar in en egen funktion med samma form.
Anropare = Callable[[str, str, Dict[str, Any], int], Dict[str, Any]]


class AiFel(Exception):
    pass


def leverantor() -> Optional[str]:
    har_gemini = bool(os.environ.get("GEMINI_API_KEY", "").strip())
    har_claude = bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())
    if os.environ.get("AI_LEVERANTOR", "").lower() == "claude" and har_claude:
        return "claude"
    if har_gemini:
        return "gemini"
    if har_claude:
        return "claude"
    return None


def modellnamn() -> str:
    return GEMINI_MODELL if leverantor() == "gemini" else CLAUDE_MODELL


def tillganglig() -> tuple:
    """(True, '') om en AI-modell kan anropas, annars (False, orsak)."""
    lev = leverantor()
    if lev is None:
        return False, "varken GEMINI_API_KEY eller ANTHROPIC_API_KEY är satt"
    try:
        if lev == "gemini":
            from google import genai  # noqa: F401
        else:
            import anthropic  # noqa: F401
    except ImportError:
        paket = "google-genai" if lev == "gemini" else "anthropic"
        return False, f"paketet {paket} är inte installerat (kräver Python 3.10+)"
    return True, ""


def _tolka_json(text: Optional[str]) -> Dict[str, Any]:
    if not text:
        raise AiFel("svaret saknar text")
    try:
        return json.loads(text)
    except ValueError as e:
        raise AiFel(f"svaret var inte giltig JSON: {e}") from e


# ---------- Gemini ----------

_gemini = None


def _anropa_gemini(system: str, anvandare: str, schema: Dict[str, Any], max_tokens: int) -> Dict[str, Any]:
    global _gemini
    from google import genai

    if _gemini is None:
        _gemini = genai.Client()  # läser GEMINI_API_KEY
    for forsok in range(1, MAX_FORSOK + 1):
        try:
            svar = _gemini.interactions.create(
                model=GEMINI_MODELL,
                system_instruction=system,
                input=anvandare,
                response_mime_type="application/json",
                response_format={"type": "text", "mime_type": "application/json", "schema": schema},
                generation_config={"thinking_level": GEMINI_TANKANDE, "max_output_tokens": max_tokens},
                store=False,
            )
            break
        except Exception as e:  # interactions-API:t har egna feltyper; titta bara på statuskoden
            kod = getattr(e, "code", None) or getattr(e, "status_code", None)
            if kod in TILLFALLIGA_FEL and forsok < MAX_FORSOK:
                log.info("Gemini: tillfälligt fel (%s), väntar 30 s (försök %d)", kod, forsok)
                time.sleep(30)
                continue
            raise AiFel(f"Gemini svarade {kod or type(e).__name__}: {e}") from e

    usage = getattr(svar, "usage", None)
    if usage is not None:
        log.info("Gemini: %s in / %s ut tokens (%s)", getattr(usage, "total_input_tokens", "?"),
                 getattr(usage, "total_output_tokens", "?"), GEMINI_MODELL)
    if svar.status != "completed":
        raise AiFel(f"Gemini avslutade med status {svar.status}")
    return _tolka_json(svar.output_text)


# ---------- Claude ----------

_claude = None


def _anropa_claude(system: str, anvandare: str, schema: Dict[str, Any], max_tokens: int) -> Dict[str, Any]:
    global _claude
    import anthropic

    if _claude is None:
        _claude = anthropic.Anthropic()
    try:
        svar = _claude.beta.messages.create(
            model=CLAUDE_MODELL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": anvandare}],
            output_config={"effort": CLAUDE_EFFORT, "format": {"type": "json_schema", "schema": schema}},
            # Om modellen avböjer körs samma anrop automatiskt på en reservmodell.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIStatusError as e:
        raise AiFel(f"Claude API svarade {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise AiFel(f"Nätverksfel mot Claude API: {e}") from e

    log.info("Claude: %s in / %s ut tokens (%s)", svar.usage.input_tokens, svar.usage.output_tokens, svar.model)
    if svar.stop_reason == "refusal":
        raise AiFel("Claude avböjde förfrågan")
    if svar.stop_reason == "max_tokens":
        raise AiFel("Claude-svaret blev avklippt (max_tokens)")
    return _tolka_json(next((b.text for b in svar.content if b.type == "text"), None))


def anropa_json(system: str, anvandare: str, schema: Dict[str, Any], max_tokens: int = 16000) -> Dict[str, Any]:
    """Ett anrop med strikt JSON-schema för svaret. Kastar AiFel vid avslag, avbrott eller API-fel."""
    lev = leverantor()
    if lev == "gemini":
        return _anropa_gemini(system, anvandare, schema, max_tokens)
    if lev == "claude":
        return _anropa_claude(system, anvandare, schema, max_tokens)
    raise AiFel("ingen AI-nyckel är satt")
