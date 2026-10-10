"""Tunn wrapper runt Anthropics SDK. Allt Claude-anrop går genom anropa_json().

Kräver ANTHROPIC_API_KEY och paketet `anthropic` (Python 3.10+). Saknas något hoppar AI-stegen
över med en loggrad – resten av pipelinen fungerar ändå.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable, Dict

log = logging.getLogger(__name__)

MODELL = "claude-opus-5-5"
EFFORT = "medium"

# Signaturen som resten av koden använder; tester skickar in en egen funktion med samma form.
Anropare = Callable[[str, str, Dict[str, Any], int], Dict[str, Any]]


class AiFel(Exception):
    pass


def tillganglig() -> tuple:
    """(True, '') om Claude kan anropas, annars (False, orsak)."""
    if not os.environ.get("ANTHROPIC_API_KEY", "").strip():
        return False, "ANTHROPIC_API_KEY saknas"
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False, "paketet anthropic är inte installerat (kräver Python 3.10+)"
    return True, ""


_klient = None


def anropa_json(system: str, anvandare: str, schema: Dict[str, Any], max_tokens: int = 16000) -> Dict[str, Any]:
    """Ett anrop med strikt JSON-schema för svaret. Kastar AiFel vid avslag, avbrott eller API-fel."""
    global _klient
    import anthropic

    if _klient is None:
        _klient = anthropic.Anthropic()
    try:
        svar = _klient.beta.messages.create(
            model=MODELL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": anvandare}],
            output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": schema}},
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
    text = next((b.text for b in svar.content if b.type == "text"), None)
    if text is None:
        raise AiFel("Claude-svaret saknar text")
    try:
        return json.loads(text)
    except ValueError as e:
        raise AiFel(f"Claude-svaret var inte giltig JSON: {e}") from e
