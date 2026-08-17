"""분석 엔드포인트의 HTTP 계약 테스트."""

from __future__ import annotations

import httpx

VALID_TEXT = (
    "@모듈 재고(inventory)\n"
    "\n"
    "재고 항목(item)은 다음 필드들로 구성되어 있다.\n"
    "    이름(name): 필수 문자열\n"
    "    수량(quantity): 필수 정수\n"
)


async def test_health_reports_loaded_compiler(client: httpx.AsyncClient) -> None:
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["rspdl_version"]


async def test_runtime_endpoint_exposes_compiler_identity(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/analysis/runtime")

    body = response.json()
    assert body["locale"] == "ko-KR"
    assert body["wire_schema_version"] == 1


async def test_compile_returns_ir_and_empty_diagnostics(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/api/analysis/compile",
        json={"sources": [{"path": "inventory.rspdl", "text": VALID_TEXT}]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "compile"
    assert body["rspdl_version"]
    assert body["result"]["files"][0]["diagnostics"] == []


async def test_invalid_source_is_200_with_diagnostics_not_an_error(
    client: httpx.AsyncClient,
) -> None:
    """문법 오류를 HTTP 오류로 바꾸지 않는다.

    에디터가 진단의 rule_id 와 span 을 받아 오류 위치를 표시해야 하므로, 이 경로가
    500 이 되면 제품의 핵심 기능이 죽는다.
    """
    response = await client.post(
        "/api/analysis/compile",
        json={"sources": [{"path": "broken.rspdl", "text": "@모듈 깨짐(broken)\n\n재고 항목은"}]},
    )

    assert response.status_code == 200
    diagnostics = response.json()["result"]["files"][0]["diagnostics"]
    assert diagnostics
    assert "span" in diagnostics[0]


async def test_empty_source_list_is_rejected(client: httpx.AsyncClient) -> None:
    response = await client.post("/api/analysis/compile", json={"sources": []})

    assert response.status_code == 422


async def test_find_model_reports_scope_in_result(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/api/analysis/model",
        json={"source": {"path": "inventory.rspdl", "text": VALID_TEXT}, "scope_per_model": 2},
    )

    assert response.status_code == 200
    assert response.json()["kind"] == "find_model"
