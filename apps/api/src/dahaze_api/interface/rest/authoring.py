"""LLM 저작 엔드포인트.

**아무것도 저장하지 않는다.** 초안과 그 컴파일 결과를 돌려줄 뿐이고, 저장은 사용자가
`PUT /api/documents/{id}` 로 명시적으로 한다 (ADR-0005).

접근 검사는 `WorkspaceService` 를 지난다. 여기서 저장소를 직접 부르면 REST 와 MCP 의
권한 확인이 갈라지고, 갈라진 뒤에는 어느 쪽이 옳은지 알 수 없게 된다.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from dahaze_api.application.authoring import AuthoringDraft
from dahaze_api.application.errors import NotFound
from dahaze_api.infrastructure.llm import LlmUnavailable
from dahaze_api.interface.rest.dependencies import CurrentUser, Drafter, Workspace
from dahaze_api.interface.rest.schemas import (
    AnalysisResponse,
    AuthoringAttemptResponse,
    AuthoringDraftResponse,
    DraftDocumentRequest,
    ReviseDocumentRequest,
)

router = APIRouter(prefix="/api/authoring", tags=["authoring"])


def _draft(draft: AuthoringDraft) -> AuthoringDraftResponse:
    return AuthoringDraftResponse(
        path=draft.path,
        text=draft.text,
        model=draft.model,
        attempts=[
            AuthoringAttemptResponse(
                attempt=a.attempt, diagnostic_count=a.diagnostic_count
            )
            for a in draft.attempts
        ],
        analysis=AnalysisResponse(
            kind=str(draft.outcome.kind),
            rspdl_version=draft.outcome.runtime.rspdl_version,
            wire_schema_version=draft.outcome.runtime.wire_schema_version,
            locale=draft.outcome.runtime.locale,
            result=dict(draft.outcome.result),
        ),
    )


@router.post("/projects/{project_id}/draft", name="draft_rspdl_document")
async def draft_rspdl_document(
    project_id: UUID,
    body: DraftDocumentRequest,
    user: CurrentUser,
    workspace: Workspace,
    drafter: Drafter,
) -> AuthoringDraftResponse:
    """지시로 새 RSPDL 초안을 만든다. 문서는 만들어지지 않는다.

    쓰기 권한이 아니라 멤버십만 요구한다. 저장하지 않으므로 프로젝트 상태가 바뀌지 않고,
    읽기 전용 멤버도 초안을 받아 본 뒤 쓸 수 있는 사람에게 넘길 수 있어야 한다.

    진단이 남은 초안도 200 이다. 재시도 뒤에도 컴파일되지 않는 초안을 오류로 바꾸면
    사람이 판단할 재료를 뺏는 것이다 (ADR-0005).
    """
    # 프로젝트를 볼 수 없는 사용자에게는 404 다. 존재 여부 자체를 노출하지 않는다.
    try:
        await workspace.get_project(actor_id=user.id, project_id=project_id)
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    try:
        draft = await drafter.draft(instruction=body.instruction, path=body.path)
    except LlmUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return _draft(draft)


@router.post("/documents/{document_id}/revise", name="revise_rspdl_document")
async def revise_rspdl_document(
    document_id: UUID,
    body: ReviseDocumentRequest,
    user: CurrentUser,
    workspace: Workspace,
    drafter: Drafter,
) -> AuthoringDraftResponse:
    """기존 문서 본문을 지시대로 고친 초안을 만든다. 문서는 그대로 남는다.

    응답의 `text` 는 부분 수정본이 아니라 전문이다. 에디터가 현재 본문과 나란히 놓고
    사람이 받아들일지 정한 뒤에야 저장으로 이어진다.
    """
    try:
        document = await workspace.get_document(
            actor_id=user.id, document_id=document_id
        )
    except NotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    try:
        draft = await drafter.draft(
            instruction=body.instruction,
            path=document.path,
            current_text=document.text,
        )
    except LlmUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return _draft(draft)
