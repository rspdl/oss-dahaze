"""MCP 서버와 도구 정의.

MCP 는 별도 앱이 아니라 이 API 안에 산다 (ADR-0005). 도구는 REST 라우터와 똑같이
`application/` 의 유스케이스만 부른다. 그래서 MCP 로 들어온 요청도 REST 와 **같은 접근
검사**를 지난다 — 저장소나 컴파일러를 직접 부르는 순간 그 보장이 깨진다.

도구 설명(description)은 주석이 아니라 인터페이스다. LLM 은 이 문장만 읽고 언제 무엇을
부를지 정하므로, 여기 적힌 말이 곧 계약이다.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fastapi import FastAPI
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.applications import Starlette
from starlette.routing import Route

from dahaze_api.application.analysis import AnalyzeWorkspace
from dahaze_api.application.workspace import WorkspaceService
from dahaze_api.domain.entities import Document, Project, User
from dahaze_api.domain.ports import RspdlCompilerPort
from dahaze_api.domain.rspdl import AnalysisOutcome, RspdlSource
from dahaze_api.infrastructure.auth.session import SessionTokens
from dahaze_api.infrastructure.db.analysis_cache import SqlAnalysisCache
from dahaze_api.infrastructure.db.repositories import (
    SqlDocumentRepository,
    SqlProjectRepository,
    SqlUserRepository,
)
from dahaze_api.infrastructure.db.session import get_session_factory
from dahaze_api.interface.mcp.auth import (
    BearerAuthMiddleware,
    McpAuthError,
    authenticated_user_id,
)
from dahaze_api.interface.rest.dependencies import get_compiler, get_session_tokens

MCP_PATH = "/mcp"

INSTRUCTIONS = """\
dahaze 는 RSPDL 로 쓴 제품 기획을 저장하고, 컴파일러로 검증하는 워크스페이스다.

- 문서의 **소스 텍스트가 유일한 진실**이다. 컴파일 결과는 언제든 다시 만들 수 있는 파생물이다.
- 문법·의미 오류는 실패가 아니라 `result` 안의 진단으로 돌아온다. 진단을 그대로 사람에게
  보여라. 요약하거나 지어내지 마라.
- 문서를 쓰기 전에 `compile_rspdl` 로 먼저 통과 여부를 확인하는 것이 좋다. 컴파일되지 않는
  텍스트도 저장할 수는 있지만, 그건 검증되지 않은 기획이다.
- 모든 도구는 토큰이 지목한 사용자 권한으로 동작한다. 그 사용자가 멤버가 아닌 프로젝트는
  존재하지 않는 것처럼 보인다.
"""

# 도구 호출 하나가 쓸 DB 세션의 수명을 여는 함수. 테스트가 자기 세션을 밀어 넣는 지점이다.
SessionScope = Callable[[], AbstractAsyncContextManager[AsyncSession]]


@asynccontextmanager
async def _request_session() -> AsyncIterator[AsyncSession]:
    """도구 호출 하나에 세션 하나. REST 의 요청당 세션과 같은 수명이다."""
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@dataclass(frozen=True, slots=True)
class _Actor:
    """이번 도구 호출을 수행하는 사용자와, 그 사용자로 조립된 유스케이스."""

    user: User
    workspace: WorkspaceService
    analyzer: AnalyzeWorkspace


def _project_payload(project: Project) -> dict[str, Any]:
    return {
        "id": str(project.id),
        "slug": project.slug,
        "name": project.name,
        "description": project.description,
        "default_rspdl_version": project.default_rspdl_version,
        "is_archived": project.is_archived,
    }


def _document_payload(document: Document, *, include_text: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": str(document.id),
        "project_id": str(document.project_id),
        "path": document.path,
        "title": document.title,
        "target_rspdl_version": document.target_rspdl_version,
        "updated_at": document.updated_at.isoformat(),
    }
    if include_text:
        payload["text"] = document.text
    return payload


def _analysis_payload(outcome: AnalysisOutcome) -> dict[str, Any]:
    """컴파일러 응답을 도구 결과로 옮긴다.

    `result` 는 SDK 가 준 그대로 통과시킨다. 정렬하거나 평탄화하거나 이름을 바꾸지
    않는다 — 결정론이 RSPDL 의 계약이고 중간에서 손대면 깨진다 (ADR-0003).
    """
    return {
        "kind": str(outcome.kind),
        "rspdl_version": outcome.runtime.rspdl_version,
        "wire_schema_version": outcome.runtime.wire_schema_version,
        "locale": outcome.runtime.locale,
        "result": dict(outcome.result),
    }


def _uuid(value: str, *, field: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as exc:
        raise ValueError(f"{field} 가 UUID 형식이 아니다: {value!r}") from exc


class McpTools:
    """MCP 도구의 본체.

    전송에서 떼어 놓는다. 도구가 실제로 하는 일은 "토큰으로 행위자를 정하고 유스케이스를
    부른다" 뿐이고, 그 규칙이 지켜지는지는 MCP 프로토콜을 태우지 않고도 검사할 수 있어야
    한다.
    """

    def __init__(
        self,
        *,
        sessions: SessionScope | None = None,
        tokens: SessionTokens | None = None,
        compiler: RspdlCompilerPort | None = None,
    ) -> None:
        self._sessions: SessionScope = sessions or _request_session
        self._tokens = tokens or get_session_tokens()
        self._compiler = compiler or get_compiler()

    @property
    def session_tokens(self) -> SessionTokens:
        """전송 앞단의 인증 게이트가 도구와 같은 서명 키를 쓰도록 노출한다."""
        return self._tokens

    # ------------------------------------------------------------------- 도구

    async def list_projects(self, headers: Mapping[str, str] | None) -> list[dict[str, Any]]:
        async with self._acting(headers) as actor:
            projects = await actor.workspace.list_projects(actor_id=actor.user.id)
            return [_project_payload(p) for p in projects]

    async def list_documents(
        self, headers: Mapping[str, str] | None, *, project_id: str
    ) -> list[dict[str, Any]]:
        async with self._acting(headers) as actor:
            documents = await actor.workspace.list_documents(
                actor_id=actor.user.id, project_id=_uuid(project_id, field="project_id")
            )
            return [_document_payload(d, include_text=False) for d in documents]

    async def read_document(
        self, headers: Mapping[str, str] | None, *, document_id: str
    ) -> dict[str, Any]:
        async with self._acting(headers) as actor:
            document = await actor.workspace.get_document(
                actor_id=actor.user.id,
                document_id=_uuid(document_id, field="document_id"),
            )
            return _document_payload(document, include_text=True)

    async def create_document(
        self,
        headers: Mapping[str, str] | None,
        *,
        project_id: str,
        path: str,
        title: str,
        text: str,
    ) -> dict[str, Any]:
        async with self._acting(headers) as actor:
            document = await actor.workspace.create_document(
                actor_id=actor.user.id,
                project_id=_uuid(project_id, field="project_id"),
                path=path,
                title=title,
                text=text,
            )
            return _document_payload(document, include_text=True)

    async def update_document(
        self,
        headers: Mapping[str, str] | None,
        *,
        document_id: str,
        text: str,
        summary: str | None = None,
    ) -> dict[str, Any]:
        async with self._acting(headers) as actor:
            document = await actor.workspace.update_document(
                actor_id=actor.user.id,
                document_id=_uuid(document_id, field="document_id"),
                text=text,
                summary=summary,
            )
            return _document_payload(document, include_text=True)

    async def compile_rspdl(
        self, headers: Mapping[str, str] | None, *, sources: list[dict[str, str]]
    ) -> dict[str, Any]:
        async with self._acting(headers) as actor:
            outcome = await actor.analyzer.compile(_to_sources(sources))
            return _analysis_payload(outcome)

    async def find_bounded_model(
        self,
        headers: Mapping[str, str] | None,
        *,
        path: str,
        text: str,
        scope_per_model: int | None = None,
        timeout_ms: int | None = None,
    ) -> dict[str, Any]:
        async with self._acting(headers) as actor:
            outcome = await actor.analyzer.find_model(
                RspdlSource(path=path, text=text),
                scope_per_model=scope_per_model,
                timeout_ms=timeout_ms,
            )
            return _analysis_payload(outcome)

    # ------------------------------------------------------------------- 내부

    @asynccontextmanager
    async def _acting(self, headers: Mapping[str, str] | None) -> AsyncIterator[_Actor]:
        """토큰이 지목한 사용자로 유스케이스를 조립한다.

        도구가 저장소를 직접 잡지 않고 여기서 조립된 `WorkspaceService` 만 쓰게 한 이유는
        하나다: 접근 검사가 그 안에 있고, 우회로를 만들지 않기 위해서다.
        """
        user_id = authenticated_user_id(headers, tokens=self._tokens)
        async with self._sessions() as session:
            user = await SqlUserRepository(session).get(user_id)
            if user is None:
                # 서명은 맞는데 사용자가 사라진 경우. 만료된 토큰과 같게 취급한다.
                raise McpAuthError("MCP 토큰이 유효하지 않다")
            yield _Actor(
                user=user,
                workspace=WorkspaceService(
                    projects=SqlProjectRepository(session),
                    documents=SqlDocumentRepository(session),
                    compiler=self._compiler,
                ),
                analyzer=AnalyzeWorkspace(
                    compiler=self._compiler, cache=SqlAnalysisCache(session)
                ),
            )


def _to_sources(sources: list[dict[str, str]]) -> list[RspdlSource]:
    """도구 인자를 컴파일러 입력으로 옮긴다.

    빠진 키를 KeyError 로 흘리지 않는다. LLM 이 인자 모양을 틀렸을 때 무엇이 없는지
    말해 줘야 스스로 고친다.
    """
    if not sources:
        raise ValueError("소스가 하나 이상 필요하다")
    for index, source in enumerate(sources):
        missing = {"path", "text"} - set(source)
        if missing:
            raise ValueError(
                f"sources[{index}] 에 {sorted(missing)} 가 없다. "
                '각 항목은 {"path": ..., "text": ...} 여야 한다'
            )
    return [RspdlSource(path=s["path"], text=s["text"]) for s in sources]


def create_mcp_server(tools: McpTools) -> MCPServer[Any]:
    """도구를 등록한 MCP 서버.

    각 도구는 `ctx.headers` 에서 이번 요청의 Bearer 토큰을 읽는다. 행위자를 인자로 받지
    않는 이유는, 받으면 호출자가 남의 사용자 id 를 적어 넣을 수 있기 때문이다.
    """
    mcp: MCPServer[Any] = MCPServer(
        name="dahaze",
        title="dahaze RSPDL 워크스페이스",
        instructions=INSTRUCTIONS,
        version="0.1.0",
    )

    @mcp.tool(
        name="list_projects",
        description=(
            "내가 멤버인 RSPDL 프로젝트 목록을 돌려준다. 다른 도구에 넘길 `project_id` 를 "
            "여기서 얻는다. 멤버가 아닌 프로젝트는 목록에 나타나지 않는다."
        ),
    )
    async def list_projects(ctx: Context) -> list[dict[str, Any]]:
        return await tools.list_projects(ctx.headers)

    @mcp.tool(
        name="list_documents",
        description=(
            "한 프로젝트에 있는 RSPDL 문서 목록을 돌려준다. 본문은 싣지 않는다 — 본문이 "
            "필요하면 `read_document` 를 쓴다. 멤버가 아닌 프로젝트를 물으면 없는 것으로 "
            "응답한다."
        ),
    )
    async def list_documents(project_id: str, ctx: Context) -> list[dict[str, Any]]:
        return await tools.list_documents(ctx.headers, project_id=project_id)

    @mcp.tool(
        name="read_document",
        description=(
            "문서 하나의 RSPDL 소스 전문을 읽는다. `text` 가 이 문서의 유일한 진실이고, "
            "`target_rspdl_version` 은 그 텍스트가 어느 문법 버전으로 쓰였는지를 뜻한다."
        ),
    )
    async def read_document(document_id: str, ctx: Context) -> dict[str, Any]:
        return await tools.read_document(ctx.headers, document_id=document_id)

    @mcp.tool(
        name="create_document",
        description=(
            "프로젝트에 RSPDL 문서를 새로 만든다. `path` 는 `.rspdl` 로 끝나야 하고 "
            "프로젝트 안에서 유일해야 한다. `text` 는 부분이 아니라 소스 전문이다. "
            "저장 전에 `compile_rspdl` 로 진단을 확인하기를 권한다 — 컴파일되지 않는 "
            "텍스트도 저장은 되지만, 그건 검증되지 않은 기획이다."
        ),
    )
    async def create_document(
        project_id: str, path: str, title: str, text: str, ctx: Context
    ) -> dict[str, Any]:
        return await tools.create_document(
            ctx.headers, project_id=project_id, path=path, title=title, text=text
        )

    @mcp.tool(
        name="update_document",
        description=(
            "문서 본문을 바꾼다. `text` 는 항상 **소스 전문**이다 — 일부만 보내면 나머지가 "
            "지워진다. 내용이 실제로 달라졌을 때만 리비전이 남으므로, 되돌릴 수 없는 이력을 "
            "만든다는 점을 알고 부른다. `summary` 에 무엇을 왜 바꿨는지 한 줄 남긴다."
        ),
    )
    async def update_document(
        document_id: str, text: str, ctx: Context, summary: str | None = None
    ) -> dict[str, Any]:
        return await tools.update_document(
            ctx.headers, document_id=document_id, text=text, summary=summary
        )

    @mcp.tool(
        name="compile_rspdl",
        description=(
            "RSPDL 소스를 컴파일해 Canonical IR 과 진단을 얻는다. `sources` 는 "
            "`{\"path\": ..., \"text\": ...}` 목록이며, 서로를 참조하는 문서는 한 번에 "
            "넘겨야 한다. 문법·의미 오류는 실패가 아니라 `result` 안의 진단으로 돌아온다. "
            "진단은 컴파일러가 준 그대로 사람에게 보여라 — 요약하거나 원인을 지어내지 마라."
        ),
    )
    async def compile_rspdl(
        sources: list[dict[str, str]], ctx: Context
    ) -> dict[str, Any]:
        return await tools.compile_rspdl(ctx.headers, sources=sources)

    @mcp.tool(
        name="find_bounded_model",
        description=(
            "선언을 만족하는 가상 모델(witness)을 유한 scope 안에서 찾는다. 실제 데이터를 "
            "쓰지 않고 '이 선언이 애초에 만족 가능한가' 를 본다. scope 안에서 못 찾으면 "
            "`unsat_within_bound` 이며, 이는 전역 모순이 아니라 '이 범위에서는 못 찾았다' "
            "는 뜻이다. 그 결과를 모순이라고 단정해 말하지 마라."
        ),
    )
    async def find_bounded_model(
        path: str,
        text: str,
        ctx: Context,
        scope_per_model: int | None = None,
        timeout_ms: int | None = None,
    ) -> dict[str, Any]:
        return await tools.find_bounded_model(
            ctx.headers,
            path=path,
            text=text,
            scope_per_model=scope_per_model,
            timeout_ms=timeout_ms,
        )

    return mcp


def create_mcp_app(tools: McpTools | None = None, *, path: str = MCP_PATH) -> Starlette:
    """Streamable HTTP 로 MCP 를 서비스하는 ASGI 앱.

    `stateless_http` 로 둔다. 세션을 서버에 들고 있으면 워커가 여러 개일 때 클라이언트가
    같은 워커로 다시 붙어야 하고(sticky session), 그건 배포 형태에 제약을 건다. 도구가
    서버→클라이언트 요청을 쓰지 않으므로 상태를 들 이유도 없다.

    DNS rebinding 방어는 끄고 상위 FastAPI 앱의 CORS 설정에 맡긴다. 이 앱은 자기가 어느
    호스트로 노출되는지 모른 채 붙으므로, 여기서 Host 를 판단하면 배포 도메인마다 설정이
    갈라진다.
    """
    toolkit = tools or McpTools()
    server = create_mcp_server(toolkit)
    # 상위 앱이 이 앱을 경로 접두사를 떼지 않고 그대로 호출하므로, 안쪽 경로도 같아야 한다.
    app = server.streamable_http_app(
        streamable_http_path=path,
        json_response=True,
        stateless_http=True,
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=False
        ),
    )
    # 인증 게이트는 개별 라우트가 아니라 앱 전체를 감싼다. 나중에 경로가 늘어도 무인증
    # 구멍이 생기지 않는다.
    app.add_middleware(BearerAuthMiddleware, tokens=toolkit.session_tokens)
    return app


def mount_mcp(
    app: FastAPI, *, path: str = MCP_PATH, tools: McpTools | None = None
) -> Starlette:
    """FastAPI 앱에 MCP 를 붙인다. `main.py` 가 부르는 유일한 함수다.

    `app.mount()` 를 쓰지 않는 이유가 둘 있다.

    1. Mount 는 `/mcp` 를 `/mcp/` 로 리다이렉트한다. MCP 클라이언트는 설정 파일에 적힌
       URL 로 정확히 붙으므로, 왕복 하나를 더 만들 이유가 없다.
    2. Starlette 은 하위 앱에 lifespan 이벤트를 전달하지 않는다. MCP 세션 매니저는
       lifespan 에서 뜨는 task group 없이는 요청을 처리하지 못하므로, 상위 앱의 lifespan
       에 하위 앱의 것을 직접 이어 붙인다.
    """
    mcp_app = create_mcp_app(tools, path=path)

    # 이미 붙어 있으면 갈아 끼운다. 그냥 append 하면 같은 경로의 라우트가 조용히 둘이 되고,
    # 먼저 등록된 쪽이 모든 요청을 가져간다 — 나중 호출이 무시된 걸 알아채기 어렵다.
    # 테스트가 자기 tools 를 주입해 실제 마운트 경로를 그대로 검사할 수 있는 것도 이 덕분이다.
    app.router.routes[:] = [
        route for route in app.router.routes if getattr(route, "name", None) != "mcp"
    ]
    app.router.routes.append(Route(path, endpoint=mcp_app, name="mcp"))

    outer = app.router.lifespan_context
    inner = mcp_app.router.lifespan_context

    @asynccontextmanager
    async def combined(owner: Any) -> AsyncIterator[Any]:
        async with outer(owner) as state, inner(mcp_app):
            yield state

    app.router.lifespan_context = combined
    return mcp_app
