from datetime import datetime, timezone

from pipeline import schema


def utc(s):
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def test_senaste_planerade_i_svensk_tid_sommar_och_vinter():
    # Onsdag 14 okt 2026 20:46 svensk sommartid (18:46 UTC) → onsdag 19:00 = 17:00 UTC
    assert schema.senaste_planerade(utc("2026-10-14T18:46:00")) == utc("2026-10-14T17:00:00")
    # Lördag 31 okt 2026 (vintertid) 15:30 svensk tid = 14:30 UTC → 15:25 svensk = 14:25 UTC
    assert schema.senaste_planerade(utc("2026-10-31T14:30:00")) == utc("2026-10-31T14:25:00")
    # Tisdag morgon → måndagens 10:00
    assert schema.senaste_planerade(utc("2026-10-13T06:00:00")) == utc("2026-10-12T08:00:00")


def test_forfallen_kor_bara_en_gang_per_planerad_tid():
    nu = utc("2026-10-14T18:46:00")
    assert schema.forfallen(None, nu) == utc("2026-10-14T17:00:00")
    assert schema.forfallen("2026-10-12T08:00:00Z", nu) == utc("2026-10-14T17:00:00")   # missad onsdag tas igen
    assert schema.forfallen("2026-10-14T17:00:00Z", nu) is None                          # redan körd
    # En timme senare har ingen ny tid passerats
    assert schema.forfallen("2026-10-14T17:00:00Z", utc("2026-10-14T19:46:00")) is None


def test_lordagens_tider_fram_till_spelstopp():
    tider = [t for d, t in schema.PLANERADE if d == 5]
    assert "15:25" in tider and all(t < "15:59" for t in tider if t != "16:20")
