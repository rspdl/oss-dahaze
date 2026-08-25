"""프로젝트 전체 컴파일 엔드포인트의 HTTP 계약 테스트.

이 경로는 정책 검토처럼 **프로젝트가 단위인 화면**이 쓴다. 지켜야 하는 것은 셋이다.
문서 전부가 한 응답에 담기는가, 경로가 문서로 되짚어지는가, 진단이 여전히 200 안에 오는가.

rspdl 0.1.0 에서 모듈은 파일마다 독립이다 (한 파일이 다른 파일의 모델을 참조하면
`RSPDL-KO-REF-001`). 그래서 테스트 소스는 파일마다 `@모듈` 을 갖는다 — 그 규칙은
컴파일러가 정하고, 여기서는 그 사실 위에서 계약만 검사한다.
"""

from __future__ import annotations

import httpx

# 정책이 있는 문서. allow 와 deny 를 둘 다 둔다 — 화면이 네 축을 그대로 받는지 본다.
EXPENSE_TEXT = (
    "@모듈 비용 승인(expense)\n"
    "\n"
    "비용 신청(request)은 다음 필드들로 구성되어 있다.\n"
    "    금액(amount): 필수 정수\n"
    "    승인 상태(status): 필수 문자열\n"
    "\n"
    "회계 관리자(accounting_manager)는 역할이다.\n"
    "사용자(user)는 역할이다.\n"
    "변경(change)은 행동이다.\n"
    "\n"
    "`회계 관리자`는 `비용 신청`의 `승인 상태`를 `변경`할 수 있다.\n"
    "\n"
    "`사용자`는 `비용 신청`의 `승인 상태`를 `변경`할 수 없다.\n"
)

# 정책이 없는 두 번째 문서. 프로젝트의 문서가 전부 한 응답에 오는지 확인하는 데 쓴다.
INVENTORY_TEXT = (
    "@모듈 재고(inventory)\n"
    "\n"
    "재고 항목(item)은 다음 필드들로 구성되어 있다.\n"
    "    이름(name): 필수 문자열\n"
)


async def _project(client: httpx.AsyncClient, slug: str) -> str:
    response = await client.post(
        "/api/projects", json={"slug": slug, "name": f"{slug} 프로젝트"}
    )
    assert response.status_code == 201, response.text
    project_id: str = response.json()["id"]
    return project_id


async def _document(
    client: httpx.AsyncClient, project_id: str, path: str, text: str
) -> str:
    response = await client.post(
        f"/api/projects/{project_id}/documents",
        json={"path": path, "title": path, "text": text},
    )
    assert response.status_code == 201, response.text
    document_id: str = response.json()["id"]
    return document_id


async def test_empty_project_returns_null_result_not_an_empty_compilation(
    client: httpx.AsyncClient,
) -> None:
    """문서가 없으면 `result` 가 `null` 이다.

    파일 0개짜리 결과를 지어내면 "컴파일했는데 아무 문제 없었다" 와 "컴파일한 적이 없다" 가
    화면에서 같아 보인다. 컴파일러를 부르지 않았다는 사실을 그대로 전한다.
    """
    project_id = await _project(client, "empty")

    response = await client.get(f"/api/projects/{project_id}/compile")

    assert response.status_code == 200
    body = response.json()
    assert body["result"] is None
    assert body["documents"] == []
    assert body["rspdl_version"]


async def test_every_document_lands_in_one_response(client: httpx.AsyncClient) -> None:
    """프로젝트의 문서가 **전부** 한 응답에 담긴다.

    이 테스트가 이 엔드포인트의 존재 이유다. 화면은 요청 한 번으로 프로젝트 전체의 IR 을
    받아야 정책 표를 한 번에 그릴 수 있다.
    """
    project_id = await _project(client, "expense")
    await _document(client, project_id, "expense.rspdl", EXPENSE_TEXT)
    await _document(client, project_id, "inventory.rspdl", INVENTORY_TEXT)

    body = (await client.get(f"/api/projects/{project_id}/compile")).json()

    files = body["result"]["files"]
    assert {f["path"] for f in files} == {"expense.rspdl", "inventory.rspdl"}
    assert all(f["diagnostics"] == [] for f in files), files


async def test_policies_carry_the_four_axes_untouched(
    client: httpx.AsyncClient,
) -> None:
    """정책 IR 을 그대로 통과시킨다.

    dahaze 가 정책에 이름을 붙이거나 필드를 평탄화하면 컴파일러의 결정론이 깨진다
    (ADR-0003). 역할·모델·필드·행동·효과가 온 그대로 있는지만 본다.
    """
    project_id = await _project(client, "axes")
    await _document(client, project_id, "expense.rspdl", EXPENSE_TEXT)

    body = (await client.get(f"/api/projects/{project_id}/compile")).json()

    policies = [
        policy
        for file in body["result"]["files"]
        for policy in file["module"]["policies"]
    ]
    assert len(policies) == 2
    assert {p["effect"] for p in policies} == {"allow", "deny"}
    for policy in policies:
        assert policy.keys() >= {
            "id",
            "role_id",
            "model_id",
            "field_id",
            "action_id",
            "effect",
        }


async def test_documents_map_paths_back_to_documents(
    client: httpx.AsyncClient,
) -> None:
    """IR 은 문서를 모른다. 경로 ↔ 문서를 잇는 고리를 응답이 함께 실어야
    화면이 "이 정책은 어느 문서에서 왔는가" 를 말할 수 있다."""
    project_id = await _project(client, "mapping")
    expense_id = await _document(client, project_id, "expense.rspdl", EXPENSE_TEXT)
    inventory_id = await _document(
        client, project_id, "inventory.rspdl", INVENTORY_TEXT
    )

    body = (await client.get(f"/api/projects/{project_id}/compile")).json()

    by_path = {d["path"]: d for d in body["documents"]}
    assert by_path["expense.rspdl"]["id"] == expense_id
    assert by_path["inventory.rspdl"]["id"] == inventory_id
    # 컴파일된 파일 경로가 전부 문서로 되짚어진다.
    assert {f["path"] for f in body["result"]["files"]} == set(by_path)


async def test_broken_source_is_200_with_diagnostics(
    client: httpx.AsyncClient,
) -> None:
    """진단은 HTTP 오류가 아니다. 프로젝트 단위 경로에서도 같다."""
    project_id = await _project(client, "broken")
    await _document(
        client, project_id, "broken.rspdl", "@모듈 깨짐(broken)\n\n재고 항목은"
    )

    response = await client.get(f"/api/projects/{project_id}/compile")

    assert response.status_code == 200
    assert response.json()["result"]["files"][0]["diagnostics"]


async def test_invalid_project_id_is_422(client: httpx.AsyncClient) -> None:
    """경로 매개변수 계약을 벗어난 입력은 FastAPI 검증 오류로 남는다."""
    response = await client.get("/api/projects/not-a-uuid/compile")

    assert response.status_code == 422


async def test_stranger_cannot_compile_someone_elses_project(
    client: httpx.AsyncClient, other_client: httpx.AsyncClient
) -> None:
    """접근 검사가 REST 의 다른 경로와 같아야 한다.

    남의 프로젝트가 존재한다는 사실도 노출하지 않으므로 403 이 아니라 404 다.
    """
    project_id = await _project(client, "private")
    await _document(client, project_id, "expense.rspdl", EXPENSE_TEXT)

    response = await other_client.get(f"/api/projects/{project_id}/compile")

    assert response.status_code == 404
