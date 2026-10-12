import time

import pytest

from pipeline.ai import klient
from pipeline.ai.klient import AiFel


@pytest.fixture(autouse=True)
def nollstall(monkeypatch):
    monkeypatch.setattr(klient, "_start", None)
    monkeypatch.setattr(klient, "_fel_i_rad", 0)
    monkeypatch.setattr(klient, "leverantor", lambda: "gemini")


def test_hangande_anrop_ger_upp_efter_tidsgransen():
    start = time.monotonic()
    with pytest.raises(AiFel, match="inget svar"):
        klient._med_tidsgrans(lambda: time.sleep(5), 0.2)
    assert time.monotonic() - start < 2


def test_fel_i_anropet_skickas_vidare():
    def boom():
        raise ValueError("x")
    with pytest.raises(ValueError):
        klient._med_tidsgrans(boom, 1)


def test_ai_hoppas_over_efter_flera_fel_i_rad(monkeypatch):
    anrop = []

    def trasig(*a):
        anrop.append(1)
        raise AiFel("503")
    monkeypatch.setattr(klient, "_anropa_gemini", trasig)
    for _ in range(klient.MAX_FEL_I_RAD):
        with pytest.raises(AiFel, match="503"):
            klient.anropa_json("s", "u", {})
    with pytest.raises(AiFel, match="i rad"):
        klient.anropa_json("s", "u", {})
    assert len(anrop) == klient.MAX_FEL_I_RAD


def test_lyckat_anrop_nollstaller_felraknaren(monkeypatch):
    svar = iter([AiFel("503"), AiFel("503"), {"ok": 1}, AiFel("503"), AiFel("503"), {"ok": 2}])

    def ibland(*a):
        x = next(svar)
        if isinstance(x, Exception):
            raise x
        return x
    monkeypatch.setattr(klient, "_anropa_gemini", ibland)
    resultat = []
    for _ in range(6):
        try:
            resultat.append(klient.anropa_json("s", "u", {}))
        except AiFel:
            pass
    assert resultat == [{"ok": 1}, {"ok": 2}]


def test_tidsbudgeten_stoppar_fler_anrop(monkeypatch):
    monkeypatch.setattr(klient, "_anropa_gemini", lambda *a: {"ok": 1})
    assert klient.anropa_json("s", "u", {}) == {"ok": 1}
    monkeypatch.setattr(klient, "_start", time.monotonic() - klient.AI_TIDSBUDGET - 1)
    with pytest.raises(AiFel, match="tidsbudgeten"):
        klient.anropa_json("s", "u", {})


class _Svar:
    status = "completed"
    output_text = '{"ok": 1}'
    usage = None


class _Fel(Exception):
    def __init__(self, kod, text="overloaded"):
        super().__init__(text)
        self.code = kod


class _FalskGemini:
    """Svarar enligt en tabell modell -> lista av utfall (Exception eller "ok")."""
    def __init__(self, utfall):
        self.utfall, self.anrop = utfall, []
        self.interactions = self

    def create(self, model, **k):
        self.anrop.append(model)
        u = self.utfall[model].pop(0) if self.utfall[model] else "ok"
        if isinstance(u, Exception):
            raise u
        return _Svar()


def test_reservmodell_tar_over_vid_overbelastning(monkeypatch):
    falsk = _FalskGemini({"huvud": [_Fel(503), _Fel(503)], "reserv1": [], "reserv2": []})
    monkeypatch.setattr(klient, "_gemini", falsk)
    monkeypatch.setattr(klient, "GEMINI_MODELL", "huvud")
    monkeypatch.setattr(klient, "GEMINI_RESERVER", ["reserv1", "reserv2"])
    monkeypatch.setattr(klient, "_ordning", [])
    monkeypatch.setattr(klient, "_ur_spel", set())
    assert klient.anropa_json("s", "u", {}) == {"ok": 1}
    assert falsk.anrop == ["huvud", "reserv1"]
    # Huvudmodellen ligger nu sist – nästa anrop går direkt till reserven
    assert klient.anropa_json("s", "u", {}) == {"ok": 1}
    assert falsk.anrop[-1] == "reserv1"


def test_okand_modell_hoppas_over_och_andra_fel_kastas(monkeypatch):
    falsk = _FalskGemini({"huvud": [_Fel(404, "model not found")], "reserv1": [_Fel(400, "bad schema")]})
    monkeypatch.setattr(klient, "_gemini", falsk)
    monkeypatch.setattr(klient, "GEMINI_MODELL", "huvud")
    monkeypatch.setattr(klient, "GEMINI_RESERVER", ["reserv1"])
    monkeypatch.setattr(klient, "_ordning", [])
    monkeypatch.setattr(klient, "_ur_spel", set())
    with pytest.raises(AiFel, match="bad schema"):
        klient.anropa_json("s", "u", {})
    assert klient._ur_spel == {"huvud"}


def test_alla_modeller_nere_ger_aifel_efter_tva_varv(monkeypatch):
    falsk = _FalskGemini({"huvud": [_Fel(503)] * 5, "reserv1": [_Fel(429)] * 5})
    monkeypatch.setattr(klient, "_gemini", falsk)
    monkeypatch.setattr(klient, "GEMINI_MODELL", "huvud")
    monkeypatch.setattr(klient, "GEMINI_RESERVER", ["reserv1"])
    monkeypatch.setattr(klient, "_ordning", [])
    monkeypatch.setattr(klient, "_ur_spel", set())
    monkeypatch.setattr(klient.time, "sleep", lambda s: None)
    with pytest.raises(AiFel):
        klient.anropa_json("s", "u", {})
    assert len(falsk.anrop) == 2 * klient.MAX_VARV
