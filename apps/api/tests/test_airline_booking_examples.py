"""항공 예약 데모가 설명한 진단 계약을 계속 만족하는지 검증한다."""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import pytest

from dahaze_api.domain.rspdl import RspdlSource
from dahaze_api.infrastructure.rspdl import LocalRspdlCompiler

EXAMPLE_DIR = Path(__file__).parents[3] / "examples" / "airline-booking"

EXPECTED_DIAGNOSTICS = {
    "good.rspdl": Counter(),
    "conflict-cancellation.rspdl": Counter({"RSPDL-DATA-004": 1}),
    "conflict-relation-rules.rspdl": Counter({"RSPDL-REL-004": 1}),
    "conflict-total-producers.rspdl": Counter({"RSPDL-DATA-004": 2}),
    "missing-fare-recalculation.rspdl": Counter(
        {"RSPDL-DATA-003": 1, "RSPDL-DATA-W002": 1}
    ),
    "missing-payment-creator.rspdl": Counter(
        {"RSPDL-DATA-001": 3, "RSPDL-DATA-002": 3}
    ),
    "missing-ticket-number-producer.rspdl": Counter({"RSPDL-DATA-001": 1}),
}


@pytest.mark.parametrize("filename", EXPECTED_DIAGNOSTICS)
async def test_airline_booking_example_diagnostics(filename: str) -> None:
    path = EXAMPLE_DIR / filename
    source = RspdlSource(path=filename, text=path.read_text(encoding="utf-8"))

    outcome = await LocalRspdlCompiler().compile([source])

    result = outcome.result["files"][0]
    actual = Counter(diagnostic["rule_id"] for diagnostic in result["diagnostics"])
    assert actual == EXPECTED_DIAGNOSTICS[filename]
    assert (result["module"] is not None) is (filename == "good.rspdl")
