"""LLM 저작 엔드포인트의 HTTP 계약 테스트.

**실제 OpenAI 를 부르지 않는다.** `LlmPort` 구현체를 `dependency_overrides` 로 갈아끼우고,
컴파일러는 진짜를 쓴다 — 검사하려는 것은 LLM 의 실력이 아니라 초안이 컴파일 게이트를
지나는지, 진단이 되먹여지는지, 끝내 실패해도 진단과 함께 돌아오는지다 (ADR-0005).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping, Sequence
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.application.authoring import MAX_REPAIR_ATTEMPTS
from dahaze_api.domain.entities import User
from dahaze_api.infrastructure.db.session import get_session
from dahaze_api.interface.rest import authoring
from dahaze_api.interface.rest.dependencies import get_current_user, get_llm
from dahaze_api.main import create_app

VALID_TEXT = (
    "@모듈 재고(inventory)\n"
    "\n"
    "재고 항목(item)은 다음 필드들로 구성되어 있다.\n"
    "    이름(name): 필수 문자열\n"
    "    수량(quantity): 필수 정수\n"
)

# 마침표가 없어 상위 선언으로 인식되지 않는다. 컴파일러가 진단을 낸다.
BROKEN_TEXT = "@모듈 깨짐(broken)\n\n재고 항목(item)은 다음 필드들로 구성되어 있다"


class FakeLlm:
    """미리 정한 초안을 순서대로 돌려주는 `LlmPort`.

    마지막 텍스트는 계속 반복한다. "끝내 컴파일되지 않는 초안" 을 시도 횟수와 무관하게
    표현할 수 있어야 하기 때문이다.
    """

    def __init__(self, *texts: str) -> None:
        self._texts = texts
        self.calls: list[dict[str, Any]] = []

    @property
    def model(self) -> str:
        return "fake-model"

    async def draft_document(
        self,
        *,
        instruction: str,
        current_text: str | None,
        diagnostics: Sequence[Mapping[str, Any]],
    ) -> str:
        self.calls.append(
            {
                "instruction": instruction,
                "current_text": current_text,
                "diagnostics": list(diagnostics),
            }
        )
        index = min(len(self.calls) - 1, len(self._texts) - 1)
        return self._texts[index]


def _build_client(
    session: AsyncSession, current: User | None, llm: FakeLlm | None
) -> httpx.AsyncClient:
    """저작 라우터를 얹은 앱. `main.py` 가 이미 얹었다면 다시 얹지 않는다."""
    app = create_app()
    if not any(getattr(r, "name", None) == "draft_rspdl_document" for r in app.routes):
        app.include_router(authoring.router)

    async def _session_override() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = _session_override
    if current is not None:
        app.dependency_overrides[get_current_user] = lambda: current
    if llm is not None:
        app.dependency_overrides[get_llm] = lambda: llm

    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


@pytest.fixture
def llm() -> FakeLlm:
    """기본은 한 번에 컴파일되는 초안."""
    return FakeLlm(VALID_TEXT)


async def _project(client: httpx.AsyncClient, slug: str) -> dict[str, Any]:
    response = await client.post(
        "/api/projects", json={"slug": slug, "name": f"{slug} 프로젝트"}
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def _document(
    client: httpx.AsyncClient, project_id: str, text: str
) -> dict[str, Any]:
    response = await client.post(
        f"/api/projects/{project_id}/documents",
        json={"path": "inventory.rspdl", "title": "재고", "text": text},
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


# ------------------------------------------------------------------ 수리 루프


async def test_clean_draft_stops_after_one_attempt(
    session: AsyncSession, user: User, llm: FakeLlm
) -> None:
    """첫 초안이 컴파일되면 더 부르지 않는다. 수리는 필요할 때만 한다."""
    async with _build_client(session, user, llm) as client:
        project = await _project(client, "clean")

        response = await client.post(
            f"/api/authoring/projects/{project['id']}/draft",
            json={"instruction": "재고 항목을 이름과 수량으로 관리한다."},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["text"] == VALID_TEXT
    assert body["model"] == "fake-model"
    assert body["attempts"] == [{"attempt": 1, "diagnostic_count": 0}]
    assert body["analysis"]["result"]["files"][0]["diagnostics"] == []
    assert len(llm.calls) == 1


async def test_diagnostics_are_fed_back_until_the_draft_compiles(
    session: AsyncSession, user: User
) -> None:
    """진단이 나오면 그 진단을 다시 넣어 재시도하고, 이력이 그 과정을 설명한다."""
    llm = FakeLlm(BROKEN_TEXT, VALID_TEXT)

    async with _build_client(session, user, llm) as client:
        project = await _project(client, "repair")

        response = await client.post(
            f"/api/authoring/projects/{project['id']}/draft",
            json={"instruction": "재고 항목을 선언한다."},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert [a["attempt"] for a in body["attempts"]] == [1, 2]
    assert body["attempts"][0]["diagnostic_count"] > 0
    assert body["attempts"][1]["diagnostic_count"] == 0
    assert body["text"] == VALID_TEXT

    # 두 번째 호출은 첫 초안과 그 진단을 함께 받아야 한다. 진단 없이 다시 물으면
    # 같은 실수를 반복할 이유가 그대로 남는다.
    assert llm.calls[0]["diagnostics"] == []
    assert llm.calls[1]["current_text"] == BROKEN_TEXT
    # 진단은 컴파일러가 준 모양 그대로 간다. 요약해서 넘기면 어디를 고칠지 알 수 없다.
    fed_back = llm.calls[1]["diagnostics"][0]
    assert fed_back["rule_id"].startswith("RSPDL-")
    assert "span" in fed_back


async def test_draft_that_never_compiles_is_200_with_diagnostics(
    session: AsyncSession, user: User
) -> None:
    """끝내 컴파일되지 않아도 실패로 만들지 않는다.

    반쯤 맞는 초안과 그 진단은 사람이 판단할 재료다. 500 이나 422 로 바꾸면 그 재료가
    통째로 사라진다 (ADR-0005).
    """
    llm = FakeLlm(BROKEN_TEXT)

    async with _build_client(session, user, llm) as client:
        project = await _project(client, "hopeless")

        response = await client.post(
            f"/api/authoring/projects/{project['id']}/draft",
            json={"instruction": "말이 되지 않는 것을 선언한다."},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["text"] == BROKEN_TEXT
    assert len(body["attempts"]) == 1 + MAX_REPAIR_ATTEMPTS
    assert all(a["diagnostic_count"] > 0 for a in body["attempts"])
    assert body["analysis"]["result"]["files"][0]["diagnostics"]
    assert len(llm.calls) == 1 + MAX_REPAIR_ATTEMPTS


async def test_draft_does_not_create_a_document(
    session: AsyncSession, user: User, llm: FakeLlm
) -> None:
    """저작은 저장하지 않는다. 리비전은 되돌릴 수 없는 이력이므로 사람이 만든다."""
    async with _build_client(session, user, llm) as client:
        project = await _project(client, "nosave")

        await client.post(
            f"/api/authoring/projects/{project['id']}/draft",
            json={"instruction": "재고를 선언한다.", "path": "inventory.rspdl"},
        )
        documents = await client.get(f"/api/projects/{project['id']}/documents")

    assert documents.json() == []


# -------------------------------------------------------------------- 문서 수정


async def test_revise_sends_the_current_text_and_leaves_it_untouched(
    session: AsyncSession, user: User, llm: FakeLlm
) -> None:
    original = "@모듈 재고(inventory)\n"

    async with _build_client(session, user, llm) as client:
        project = await _project(client, "revise")
        document = await _document(client, str(project["id"]), original)

        response = await client.post(
            f"/api/authoring/documents/{document['id']}/revise",
            json={"instruction": "수량 필드를 추가한다."},
        )
        after = await client.get(f"/api/documents/{document['id']}")

    assert response.status_code == 200, response.text
    assert response.json()["path"] == "inventory.rspdl"
    assert llm.calls[0]["current_text"] == original
    # 초안은 돌려줬지만 문서 본문은 그대로여야 한다.
    assert after.json()["text"] == original


# ------------------------------------------------------------------- 접근 검사


async def test_non_member_cannot_draft_in_someone_elses_project(
    session: AsyncSession, user: User, other_user: User, llm: FakeLlm
) -> None:
    """권한 없음을 404 로 감춘다. 403 이면 그 프로젝트가 존재한다는 사실이 새어 나간다."""
    async with _build_client(session, user, llm) as owner_client:
        project = await _project(owner_client, "private")

    async with _build_client(session, other_user, llm) as stranger:
        response = await stranger.post(
            f"/api/authoring/projects/{project['id']}/draft",
            json={"instruction": "남의 프로젝트에 초안을 만든다."},
        )

    assert response.status_code == 404
    # 접근 검사에서 막혔으므로 LLM 을 부르지도 않았어야 한다.
    assert llm.calls == []


async def test_non_member_cannot_revise_someone_elses_document(
    session: AsyncSession, user: User, other_user: User, llm: FakeLlm
) -> None:
    async with _build_client(session, user, llm) as owner_client:
        project = await _project(owner_client, "private-doc")
        document = await _document(owner_client, str(project["id"]), VALID_TEXT)

    async with _build_client(session, other_user, llm) as stranger:
        response = await stranger.post(
            f"/api/authoring/documents/{document['id']}/revise",
            json={"instruction": "남의 문서를 고친다."},
        )

    assert response.status_code == 404
    assert llm.calls == []


async def test_anonymous_request_is_401(session: AsyncSession, llm: FakeLlm) -> None:
    async with _build_client(session, None, llm) as client:
        response = await client.post(
            "/api/authoring/projects/00000000-0000-0000-0000-000000000000/draft",
            json={"instruction": "익명으로 초안을 만든다."},
        )

    assert response.status_code == 401


async def test_empty_instruction_is_rejected(
    session: AsyncSession, user: User, llm: FakeLlm
) -> None:
    async with _build_client(session, user, llm) as client:
        project = await _project(client, "empty")

        response = await client.post(
            f"/api/authoring/projects/{project['id']}/draft",
            json={"instruction": ""},
        )

    assert response.status_code == 422


# ---------------------------------------------------------------------- 미설정


async def test_missing_api_key_is_503_not_a_crash(
    session: AsyncSession, user: User
) -> None:
    """OPENAI_API_KEY 가 없는 배포에서도 나머지 API 는 살아 있어야 한다.

    그래서 자격증명 확인이 import 나 startup 이 아니라 요청 시점에 일어난다. `llm` 을
    갈아끼우지 않고 진짜 provider 를 그대로 쓴다 — 테스트 환경에는 키가 없다.
    """
    async with _build_client(session, user, None) as client:
        project = await _project(client, "nokey")

        response = await client.post(
            f"/api/authoring/projects/{project['id']}/draft",
            json={"instruction": "키 없이 초안을 만든다."},
        )
        healthy = await client.get("/health")

    assert response.status_code == 503
    assert healthy.status_code == 200
