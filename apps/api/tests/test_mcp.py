"""MCP 서버 테스트.

가장 중요한 것은 두 가지다.

1. **MCP 토큰은 세션 토큰이 아니다.** audience 가 다르므로 서로 대신 쓸 수 없다 (ADR-0005).
2. **MCP 도 REST 와 같은 접근 검사를 지난다.** 도구가 `WorkspaceService` 만 부르므로,
   남의 프로젝트로 가는 경로가 MCP 쪽에만 따로 생기지 않는다.

도구는 전송(transport)에서 떼어 검사한다. MCP 프로토콜을 태우지 않아도 "토큰으로 행위자를
정하고 유스케이스를 부른다" 는 규칙은 그대로 확인할 수 있다. 프로토콜 왕복 자체는 마지막
절의 HTTP 테스트가 한 번 통과시킨다.
"""

from __future__ import annotations

import inspect
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import httpx
import jwt
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from dahaze_api.application.errors import AccessDenied, NotFound
from dahaze_api.application.workspace import WorkspaceService
from dahaze_api.domain.entities import Project, ProjectRole, User
from dahaze_api.infrastructure.auth.session import (
    ALGORITHM,
    MCP_AUDIENCE,
    SessionTokens,
)
from dahaze_api.infrastructure.db.repositories import (
    SqlDocumentRepository,
    SqlProjectRepository,
)
from dahaze_api.infrastructure.db.session import get_session
from dahaze_api.interface.mcp import McpAuthError, McpTools, mount_mcp
from dahaze_api.interface.rest.dependencies import get_compiler, get_session_tokens
from dahaze_api.main import create_app

# HMAC-SHA256 권장 길이를 넘긴다. 짧은 키는 경고를 내고, 경고가 섞이면 진짜 실패가 묻힌다.
SECRET = "test-only-secret-that-is-long-enough-32"

VALID_TEXT = (
    "@모듈 재고(inventory)\n"
    "\n"
    "재고 항목(item)은 다음 필드들로 구성되어 있다.\n"
    "    이름(name): 필수 문자열\n"
    "    수량(quantity): 필수 정수\n"
)


@pytest.fixture
def tokens() -> SessionTokens:
    return SessionTokens(SECRET)


@pytest.fixture
def tools(session: AsyncSession, tokens: SessionTokens) -> McpTools:
    """테스트 세션을 쓰는 도구 모음.

    도구 호출마다 새 세션을 여는 대신 픽스처가 만든 세션 하나를 공유한다. 그래야 아직
    커밋되지 않은 준비 데이터가 도구에도 보인다.
    """

    @asynccontextmanager
    async def scope() -> AsyncIterator[AsyncSession]:
        yield session

    return McpTools(sessions=scope, tokens=tokens, compiler=get_compiler())


@pytest.fixture
def workspace(session: AsyncSession) -> WorkspaceService:
    """준비 데이터를 만드는 통로. MCP 에는 프로젝트 생성 도구가 없다."""
    return WorkspaceService(
        projects=SqlProjectRepository(session),
        documents=SqlDocumentRepository(session),
        compiler=get_compiler(),
    )


@pytest.fixture
async def project(workspace: WorkspaceService, user: User) -> Project:
    return await workspace.create_project(
        actor_id=user.id, slug="mcp-fixture", name="MCP 픽스처"
    )


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------- 인증


async def test_mcp_token_authenticates(
    tools: McpTools, tokens: SessionTokens, user: User, project: Project
) -> None:
    result = await tools.list_projects(auth(tokens.issue_mcp(user.id)))

    assert [p["id"] for p in result] == [str(project.id)]


async def test_session_token_is_rejected_for_mcp(
    tools: McpTools, tokens: SessionTokens, user: User
) -> None:
    """세션 쿠키를 그대로 MCP 에 들이밀 수 없다.

    audience 를 나눠 둔 이유가 이것이다 — 한쪽이 새어도 다른 쪽에서 쓰이지 않는다.
    """
    with pytest.raises(McpAuthError):
        await tools.list_projects(auth(tokens.issue(user.id)))


async def test_expired_token_is_rejected(tools: McpTools, user: User) -> None:
    past = datetime.now(UTC) - timedelta(days=1)
    expired = jwt.encode(
        {"sub": str(user.id), "aud": MCP_AUDIENCE, "iat": past, "exp": past},
        SECRET,
        algorithm=ALGORITHM,
    )

    with pytest.raises(McpAuthError):
        await tools.list_projects(auth(expired))


async def test_token_signed_with_another_secret_is_rejected(
    tools: McpTools, user: User
) -> None:
    forged = SessionTokens("another-secret-that-is-long-enough-32b").issue_mcp(user.id)

    with pytest.raises(McpAuthError):
        await tools.list_projects(auth(forged))


@pytest.mark.parametrize(
    "headers",
    [
        None,
        {},
        {"Authorization": "Bearer"},
        {"Authorization": "Bearer "},
        {"Authorization": "Basic abcdef"},
        {"Authorization": "Bearer not-a-jwt"},
    ],
)
async def test_malformed_credentials_are_rejected(
    tools: McpTools, headers: Mapping[str, str] | None
) -> None:
    with pytest.raises(McpAuthError):
        await tools.list_projects(headers)


async def test_token_for_a_deleted_user_is_rejected(
    tools: McpTools, tokens: SessionTokens
) -> None:
    """서명은 맞지만 사용자가 없는 토큰. 만료된 토큰과 같게 취급한다."""
    with pytest.raises(McpAuthError):
        await tools.list_projects(auth(tokens.issue_mcp(uuid4())))


async def test_header_name_is_case_insensitive(
    tools: McpTools, tokens: SessionTokens, user: User
) -> None:
    """전송 계층마다 헤더 정규화가 다르다. 도구가 그걸 흡수한다."""
    token = tokens.issue_mcp(user.id)

    assert await tools.list_projects({"authorization": f"Bearer {token}"}) == []


# ------------------------------------------------------------------ 접근 격리


async def test_foreign_project_is_invisible(
    tools: McpTools, tokens: SessionTokens, other_user: User, project: Project
) -> None:
    assert await tools.list_projects(auth(tokens.issue_mcp(other_user.id))) == []


async def test_tool_cannot_list_documents_of_a_foreign_project(
    tools: McpTools, tokens: SessionTokens, other_user: User, project: Project
) -> None:
    """멤버가 아니면 프로젝트가 존재하지 않는 것처럼 보인다.

    접근 거부가 아니라 '없음' 인 이유는 남의 프로젝트가 존재한다는 사실 자체를 숨기기
    위해서다. REST 와 같은 검사를 지나므로 이 성질도 그대로 따라온다.
    """
    with pytest.raises(NotFound):
        await tools.list_documents(
            auth(tokens.issue_mcp(other_user.id)), project_id=str(project.id)
        )


async def test_tool_cannot_read_a_foreign_document(
    tools: McpTools, tokens: SessionTokens, user: User, other_user: User, project: Project
) -> None:
    created = await tools.create_document(
        auth(tokens.issue_mcp(user.id)),
        project_id=str(project.id),
        path="secret.rspdl",
        title="비공개",
        text=VALID_TEXT,
    )

    with pytest.raises(NotFound):
        await tools.read_document(
            auth(tokens.issue_mcp(other_user.id)), document_id=str(created["id"])
        )


async def test_viewer_cannot_create_a_document(
    tools: McpTools,
    tokens: SessionTokens,
    workspace: WorkspaceService,
    user: User,
    other_user: User,
    project: Project,
) -> None:
    """역할 검사도 MCP 를 그냥 통과하지 않는다."""
    await workspace.add_member(
        actor_id=user.id,
        project_id=project.id,
        user_id=other_user.id,
        role=ProjectRole.VIEWER,
    )

    with pytest.raises(AccessDenied):
        await tools.create_document(
            auth(tokens.issue_mcp(other_user.id)),
            project_id=str(project.id),
            path="attempt.rspdl",
            title="시도",
            text=VALID_TEXT,
        )


async def test_actor_comes_from_the_token_not_from_arguments(
    tools: McpTools, tokens: SessionTokens, user: User, project: Project
) -> None:
    """도구는 행위자를 인자로 받지 않는다.

    받는 순간 호출자가 남의 사용자 id 를 적어 넣을 수 있다. 이 테스트는 그런 인자가
    생기면 깨진다.
    """
    for tool in (tools.list_projects, tools.create_document, tools.compile_rspdl):
        parameters = set(inspect.signature(tool).parameters)
        assert not parameters & {"actor_id", "user_id", "user"}


# --------------------------------------------------------------------- 왕복


async def test_create_then_read_document(
    tools: McpTools, tokens: SessionTokens, user: User, project: Project
) -> None:
    headers = auth(tokens.issue_mcp(user.id))

    created = await tools.create_document(
        headers,
        project_id=str(project.id),
        path="inventory.rspdl",
        title="재고",
        text=VALID_TEXT,
    )
    read = await tools.read_document(headers, document_id=str(created["id"]))

    assert read["text"] == VALID_TEXT
    assert read["path"] == "inventory.rspdl"
    # 문서는 자기가 어느 문법으로 쓰였는지 기록한다 (ADR-0002).
    assert read["target_rspdl_version"] == project.default_rspdl_version


async def test_update_replaces_the_whole_text(
    tools: McpTools, tokens: SessionTokens, user: User, project: Project
) -> None:
    headers = auth(tokens.issue_mcp(user.id))
    created = await tools.create_document(
        headers,
        project_id=str(project.id),
        path="inventory.rspdl",
        title="재고",
        text=VALID_TEXT,
    )

    await tools.update_document(
        headers,
        document_id=str(created["id"]),
        text="@모듈 둘째(second)\n",
        summary="모듈명 변경",
    )

    read = await tools.read_document(headers, document_id=str(created["id"]))
    assert read["text"] == "@모듈 둘째(second)\n"


async def test_documents_are_listed_without_their_text(
    tools: McpTools, tokens: SessionTokens, user: User, project: Project
) -> None:
    headers = auth(tokens.issue_mcp(user.id))
    await tools.create_document(
        headers,
        project_id=str(project.id),
        path="inventory.rspdl",
        title="재고",
        text=VALID_TEXT,
    )

    listed = await tools.list_documents(headers, project_id=str(project.id))

    assert [d["path"] for d in listed] == ["inventory.rspdl"]
    assert "text" not in listed[0]


@pytest.mark.parametrize("bad_id", ["not-a-uuid", "", "123"])
async def test_malformed_id_is_a_clear_error(
    tools: McpTools, tokens: SessionTokens, user: User, bad_id: str
) -> None:
    """LLM 은 id 를 지어내기도 한다. 무엇이 잘못됐는지 말해 주는 편이 낫다."""
    with pytest.raises(ValueError, match="UUID"):
        await tools.read_document(auth(tokens.issue_mcp(user.id)), document_id=bad_id)


# --------------------------------------------------------------------- 분석


async def test_compile_passes_the_compiler_result_through(
    tools: McpTools, tokens: SessionTokens, user: User
) -> None:
    """`result` 를 재작성하지 않는다 (ADR-0003).

    컴파일러가 준 모양 그대로여야 진단의 rule_id 와 span 이 살아 있다.
    """
    result = await tools.compile_rspdl(
        auth(tokens.issue_mcp(user.id)),
        sources=[{"path": "inventory.rspdl", "text": VALID_TEXT}],
    )

    assert result["kind"] == "compile"
    assert result["result"]["files"][0]["diagnostics"] == []


async def test_broken_source_returns_diagnostics_not_an_exception(
    tools: McpTools, tokens: SessionTokens, user: User
) -> None:
    """문법 오류는 실패가 아니라 진단이다. 도구 오류로 바꾸면 LLM 이 고칠 재료를 잃는다."""
    result = await tools.compile_rspdl(
        auth(tokens.issue_mcp(user.id)),
        sources=[{"path": "broken.rspdl", "text": "@모듈 깨짐(broken)\n\n재고 항목은"}],
    )

    diagnostics = result["result"]["files"][0]["diagnostics"]
    assert diagnostics
    assert "span" in diagnostics[0]


async def test_find_bounded_model_reports_its_kind(
    tools: McpTools, tokens: SessionTokens, user: User
) -> None:
    result = await tools.find_bounded_model(
        auth(tokens.issue_mcp(user.id)),
        path="inventory.rspdl",
        text=VALID_TEXT,
        scope_per_model=2,
    )

    assert result["kind"] == "find_model"


async def test_empty_source_list_is_rejected(
    tools: McpTools, tokens: SessionTokens, user: User
) -> None:
    with pytest.raises(ValueError):
        await tools.compile_rspdl(auth(tokens.issue_mcp(user.id)), sources=[])


# ------------------------------------------------------------------ 프로토콜


@asynccontextmanager
async def mcp_over_http(
    session: AsyncSession, tools: McpTools
) -> AsyncIterator[httpx.AsyncClient]:
    """MCP 가 마운트된 실제 FastAPI 앱.

    `mount_mcp` 가 lifespan 까지 이어 붙이는지가 여기서 드러난다 — 세션 매니저의 task
    group 이 뜨지 않으면 어떤 요청도 처리되지 않는다.

    픽스처가 아니라 컨텍스트 매니저인 이유: pytest-asyncio 는 픽스처의 setup 과 teardown 을
    서로 다른 태스크에서 돌릴 수 있고, 그러면 lifespan 안의 task group 이 자기가 열린 곳이
    아닌 곳에서 닫히며 깨진다.
    """
    app = create_app()

    async def _session_override() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_session] = _session_override
    mount_mcp(app, tools=tools)

    async with app.router.lifespan_context(app), httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client


def rpc(method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"jsonrpc": "2.0", "id": 1, "method": method}
    if params is not None:
        body["params"] = params
    return body


MCP_HEADERS = {"Accept": "application/json, text/event-stream"}


async def test_http_request_without_a_token_is_401(
    session: AsyncSession, tools: McpTools
) -> None:
    """자격증명이 없는 요청은 핸드셰이크 전에 끊는다.

    도구 오류로 돌려주면 클라이언트가 '인증하라' 로 읽지 못한다.
    """
    async with mcp_over_http(session, tools) as mcp:
        response = await mcp.post("/mcp", json=rpc("tools/list"), headers=MCP_HEADERS)

    assert response.status_code == 401
    assert response.headers["www-authenticate"].startswith("Bearer")


async def test_http_request_with_a_session_token_is_401(
    session: AsyncSession, tools: McpTools, tokens: SessionTokens, user: User
) -> None:
    async with mcp_over_http(session, tools) as mcp:
        response = await mcp.post(
            "/mcp",
            json=rpc("tools/list"),
            headers={**MCP_HEADERS, **auth(tokens.issue(user.id))},
        )

    assert response.status_code == 401


async def test_tools_are_advertised_over_http(
    session: AsyncSession, tools: McpTools, tokens: SessionTokens, user: User
) -> None:
    async with mcp_over_http(session, tools) as mcp:
        response = await mcp.post(
            "/mcp",
            json=rpc("tools/list"),
            headers={**MCP_HEADERS, **auth(tokens.issue_mcp(user.id))},
        )

    assert response.status_code == 200
    advertised = response.json()["result"]["tools"]
    assert {tool["name"] for tool in advertised} == {
        "list_projects",
        "list_documents",
        "read_document",
        "create_document",
        "update_document",
        "compile_rspdl",
        "find_bounded_model",
    }
    # 설명이 LLM 에게는 유일한 인터페이스다. 비어 있으면 도구가 없는 것과 같다.
    assert all(tool["description"] for tool in advertised)


async def test_tool_call_round_trip_over_http(
    session: AsyncSession,
    tools: McpTools,
    tokens: SessionTokens,
    user: User,
    project: Project,
) -> None:
    """프로토콜을 거친 왕복 하나. 도구 → 유스케이스 → DB 가 실제로 이어지는지 본다."""
    headers = {**MCP_HEADERS, **auth(tokens.issue_mcp(user.id))}

    async with mcp_over_http(session, tools) as mcp:
        created = await mcp.post(
            "/mcp",
            json=rpc(
                "tools/call",
                {
                    "name": "create_document",
                    "arguments": {
                        "project_id": str(project.id),
                        "path": "inventory.rspdl",
                        "title": "재고",
                        "text": VALID_TEXT,
                    },
                },
            ),
            headers=headers,
        )
        assert created.status_code == 200, created.text
        assert not created.json()["result"].get("isError")
        document = created.json()["result"]["structuredContent"]

        read = await mcp.post(
            "/mcp",
            json=rpc(
                "tools/call",
                {"name": "read_document", "arguments": {"document_id": document["id"]}},
            ),
            headers=headers,
        )

    assert read.json()["result"]["structuredContent"]["text"] == VALID_TEXT


async def test_a_foreign_project_is_unreachable_over_http(
    session: AsyncSession,
    tools: McpTools,
    tokens: SessionTokens,
    other_user: User,
    project: Project,
) -> None:
    """토큰이 다른 사람이면 프로토콜을 거쳐도 남의 프로젝트에 닿지 못한다."""
    async with mcp_over_http(session, tools) as mcp:
        response = await mcp.post(
            "/mcp",
            json=rpc(
                "tools/call",
                {
                    "name": "create_document",
                    "arguments": {
                        "project_id": str(project.id),
                        "path": "intrusion.rspdl",
                        "title": "침입",
                        "text": VALID_TEXT,
                    },
                },
            ),
            headers={**MCP_HEADERS, **auth(tokens.issue_mcp(other_user.id))},
        )

    assert response.json()["result"]["isError"] is True


async def test_mcp_token_endpoint_requires_a_session(
    anon_client: httpx.AsyncClient,
) -> None:
    response = await anon_client.post("/api/auth/mcp-token")

    assert response.status_code == 401


async def test_issued_mcp_token_works_as_a_bearer(
    client: httpx.AsyncClient, tools: McpTools, user: User
) -> None:
    """발급 엔드포인트가 낸 토큰이 실제로 MCP 에서 통해야 한다.

    두 곳이 서로 다른 audience 나 다른 비밀을 쓰면 여기서 갈라진다.
    """
    response = await client.post("/api/auth/mcp-token")
    assert response.status_code == 201

    body = response.json()
    assert body["token_type"] == "Bearer"
    assert datetime.fromisoformat(body["expires_at"]) > datetime.now(UTC)
    # 엔드포인트는 서버 설정의 비밀로 서명하므로 테스트 도구의 비밀로는 검증할 수 없다.
    # 실제 배선이 같은 audience 로 같은 사용자를 지목하는지만 본다.
    assert get_session_tokens().verify_mcp(body["token"]) == user.id
