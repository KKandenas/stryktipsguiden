import pytest

from pipeline.model.modeller import OddsModell, Underlag
from pipeline.model.sannolikhet import brier, marginal, potens, proportionell, snitt, varde


def test_marginal():
    assert marginal(2.0, 4.0, 4.0) == pytest.approx(0.0)
    assert marginal(1.70, 4.40, 4.80) == pytest.approx(0.0238, abs=1e-4)


@pytest.mark.parametrize("metod", [proportionell, potens])
def test_sannolikheter_summerar_till_ett(metod):
    for odds in [(1.70, 4.40, 4.80), (1.15, 7.5, 15.0), (2.6, 3.1, 2.9)]:
        p = metod(*odds)
        assert sum(p) == pytest.approx(1.0)
        assert all(0 < x < 1 for x in p)
        assert p[0] > p[2] if odds[0] < odds[2] else p[0] < p[2]


def test_proportionell_kanda_varden():
    # 1/2 + 1/4 + 1/4 = 1 → ingen marginal att ta bort
    assert proportionell(2.0, 4.0, 4.0) == pytest.approx((0.5, 0.25, 0.25))
    # 10 % marginal jämnt fördelad: 1/1.8 + 1/3.6 + 1/3.6 = 1.111…
    assert proportionell(1.8, 3.6, 3.6) == pytest.approx((0.5, 0.25, 0.25))


def test_potens_tar_mer_marginal_fran_skrallen():
    prop, pot = proportionell(1.15, 7.5, 15.0), potens(1.15, 7.5, 15.0)
    assert pot[2] < prop[2] and pot[0] > prop[0]


def test_snitt_och_varde():
    assert snitt([(0.5, 0.3, 0.2), (0.6, 0.2, 0.2)]) == pytest.approx((0.55, 0.25, 0.2))
    assert snitt([]) is None
    assert varde((0.55, 0.25, 0.20), (65, 20, 15)) == pytest.approx((-0.10, 0.05, 0.05))


def test_brier():
    assert brier((1, 0, 0), "1") == 0
    assert brier((1, 0, 0), "2") == 2
    assert brier((0.5, 0.25, 0.25), "X") == pytest.approx(0.25 + 0.5625 + 0.0625)


def test_oddsmodell_snittar_bolag_och_ignorerar_startodds():
    m = OddsModell()
    u = Underlag(1, odds={"a": (2.0, 4.0, 4.0), "b": (1.8, 3.6, 3.6), "svenskaspel_start": (3.0, 3.0, 3.0)})
    assert m.prognos(u) == pytest.approx((0.5, 0.25, 0.25))
    # Bara startodds → används som nödlösning
    assert m.prognos(Underlag(1, odds={"svenskaspel_start": (3.0, 3.0, 3.0)})) == pytest.approx((1/3, 1/3, 1/3))
    assert m.prognos(Underlag(1)) is None
