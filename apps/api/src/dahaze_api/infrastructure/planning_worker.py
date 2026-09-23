"""PostgreSQL lease로 실행되는 durable planning AI worker."""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Awaitable, Mapping
from contextlib import suppress
from typing import Any, TypeVar
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from dahaze_api.application.errors import Conflict
from dahaze_api.application.workspace import validate_document_identity
from dahaze_api.domain.ports import LlmPort, PlanningLlmPort, RspdlCompilerPort
from dahaze_api.domain.rspdl import RspdlSource, project_source_hash
from dahaze_api.infrastructure.db.planning_ai_repository import SqlPlanningAiJobRepository
from dahaze_api.infrastructure.llm.grammar import (
    PLANNING_AUTHORING_PROFILE,
    AuthoringContract,
    UnsupportedAuthoringProfile,
    select_authoring_contract,
)
from dahaze_api.infrastructure.llm.openai_adapter import LlmUnavailable
from dahaze_api.infrastructure.llm.prompts import CHANGE_PLAN_SYSTEM_PROMPT

LEASE_SECONDS = 300
POLL_SECONDS = 1.0
MAX_REPAIR_ATTEMPTS = 2
MAX_PLAN_ATTEMPTS = 3
T = TypeVar("T")


class PlanningAiWorker:
    def __init__(
        self,
        *,
        sessions: async_sessionmaker[AsyncSession],
        compiler: RspdlCompilerPort,
        llm: LlmPort,
        planning_llm: PlanningLlmPort,
    ) -> None:
        self._sessions = sessions
        self._compiler = compiler
        self._llm = llm
        self._planning_llm = planning_llm

    async def run_once(self) -> bool:
        async with self._sessions() as session:
            store = SqlPlanningAiJobRepository(session)
            job = await store.claim(lease_seconds=LEASE_SECONDS)
            await session.commit()
        if job is None:
            return False
        try:
            if job["kind"] == "interview":
                await self._interview(job)
            elif job["kind"] == "generate":
                await self._generate(job)
            else:
                await self._fail(job, "config", "알 수 없는 AI 작업 종류다.", False)
        except LlmUnavailable as exc:
            await self._fail(job, exc.code, str(exc), exc.retryable)
        except Conflict:
            await self._fail(
                job,
                "invalid_output",
                "AI 문서 변경 계획의 경로나 제목이 올바르지 않다.",
                False,
            )
        except UnsupportedAuthoringProfile:
            await self._fail(
                job,
                "config",
                "현재 RSPDL compiler가 요청한 기획 저작 계약을 지원하지 않는다.",
                False,
            )
        except Exception:
            await self._fail(
                job,
                "provider_failure",
                "AI 기획 작업을 처리하지 못했다. 저장된 작업에서 재시도할 수 있다.",
                True,
            )
        return True

    async def run_forever(self) -> None:
        try:
            while True:
                if not await self.run_once():
                    await asyncio.sleep(POLL_SECONDS)
        finally:
            await self._planning_llm.close()

    async def _interview(self, job: Mapping[str, Any]) -> None:
        if await self._cancelled(job):
            return
        capabilities = await self._compiler.capabilities()
        context = _llm_context(job)
        context["compiler"] = _runtime_payload(self._compiler, capabilities)
        if not await self._progress(job, "interviewing", 0, 1, "정책과 미정 사항을 검토하고 있다"):
            return
        response = dict(
            await self._await_guarded(job, self._planning_llm.interview_project(context=context))
        )
        if await self._cancelled(job):
            return
        proposals = response.get("proposals")
        if not isinstance(proposals, list):
            raise LlmUnavailable(
                code="invalid_output",
                message="AI 기획 응답의 제안 형식이 올바르지 않다.",
                retryable=True,
            )
        from uuid import uuid4

        selected = job["context"].get("selected_subject")
        selected_path = selected.get("source_path") if isinstance(selected, Mapping) else None
        selected_stable_id = selected.get("stable_id") if isinstance(selected, Mapping) else None
        policy_items = [
            {
                **dict(item),
                "id": str(uuid4()),
                "kind": "policy",
                "source_path": selected_path,
                "stable_id": selected_stable_id,
                "status": "open",
                "source": "ai",
                "job_id": str(job["id"]),
            }
            for item in proposals
            if isinstance(item, Mapping)
        ]
        question_items = [
            {
                "id": str(uuid4()),
                "kind": "question",
                "title": item.get("question"),
                "detail": item.get("reason"),
                "subject": item.get("subject"),
                "source_path": selected_path,
                "stable_id": selected_stable_id,
                "status": "open",
                "source": "ai",
                "job_id": str(job["id"]),
            }
            for item in response.get("policy_first_questions", [])
            if isinstance(item, Mapping)
        ]
        unsupported_items = [
            {
                "id": str(uuid4()),
                "kind": "unsupported",
                "title": item,
                "status": "open",
                "source": "ai",
                "job_id": str(job["id"]),
            }
            for item in response.get("unsupported", [])
            if isinstance(item, str)
        ]
        response["proposals"] = [*policy_items, *question_items, *unsupported_items]
        response["decision_updates"] = [
            {**dict(item), "status": "suggested"}
            for item in response.get("decision_updates", [])
            if isinstance(item, Mapping)
        ]
        response["provenance"] = {
            "model": self._planning_llm.model,
            **_runtime_payload(self._compiler, capabilities),
        }
        async with self._sessions() as session:
            stored = await SqlPlanningAiJobRepository(session).finish_interview(
                UUID(str(job["id"])), lease_token=UUID(str(job["lease_token"])), result=response
            )
            if stored:
                await session.commit()

    async def _generate(self, job: Mapping[str, Any]) -> None:
        if await self._cancelled(job):
            return
        capabilities = await self._compiler.capabilities()
        runtime = self._compiler.runtime
        contract = select_authoring_contract(
            rspdl_version=runtime.rspdl_version,
            wire_schema_version=runtime.wire_schema_version,
            capabilities=capabilities,
            requested_profile=(PLANNING_AUTHORING_PROFILE if capabilities else None),
        )
        checkpoint_provenance = _provenance(
            self._planning_llm.model, contract, self._compiler, capabilities
        )
        checkpoints = dict(job.get("checkpoints") or {})
        if checkpoints.get("provenance") != checkpoint_provenance:
            checkpoints = {"provenance": checkpoint_provenance}
        plan = checkpoints.get("plan")
        if not isinstance(plan, Mapping):
            if not await self._progress(job, "planning", 0, 1, "문서 변경 범위를 정리하고 있다"):
                return
            plan_context = _llm_context(job)
            plan_context["accepted_decisions"] = _accepted_decisions(job)
            plan_context["unresolved_proposals"] = _unresolved_proposals(job)
            plan_context["compiler"] = _runtime_payload(self._compiler, capabilities)
            plan_context["authoring_contract"] = {
                "profile": contract.profile,
                "output": "RSPDL source accepted by the selected grammar and compiler",
                "note": (
                    "The full grammar reference is used only by the later source-writing step. "
                    "This planner must return concise prose instructions, never source text."
                ),
            }
            plan_context["rule"] = (
                "Only accepted_decisions and the explicit instruction are normative. "
                "Never turn unresolved_proposals into RSPDL policy."
            )
            generated_plan: Mapping[str, Any] | None = None
            for plan_attempt in range(1, MAX_PLAN_ATTEMPTS + 1):
                generated_plan = dict(
                    await self._await_guarded(
                        job, self._planning_llm.plan_project_changes(context=plan_context)
                    )
                )
                if await self._cancelled(job):
                    return
                try:
                    _validate_change_plan(generated_plan, job["context"])
                    break
                except (Conflict, LlmUnavailable) as exc:
                    if plan_attempt == MAX_PLAN_ATTEMPTS:
                        raise LlmUnavailable(
                            code="invalid_output",
                            message="AI 문서 변경 계획의 형식을 세 번 검증했지만 고치지 못했다.",
                            retryable=True,
                        ) from exc
                    plan_context["validation_feedback"] = {
                        "attempt": plan_attempt,
                        "message": str(exc),
                        "rule": (
                            "Return a complete replacement plan. Keep each path unique; do not "
                            "merge or retain any invalid previous change."
                        ),
                    }
                    if not await self._progress(
                        job,
                        "planning",
                        plan_attempt,
                        MAX_PLAN_ATTEMPTS,
                        f"변경 계획 형식 수정 {plan_attempt + 1}/{MAX_PLAN_ATTEMPTS}",
                    ):
                        return
            assert generated_plan is not None
            plan = generated_plan
            checkpoints["plan"] = plan
            if not await self._checkpoint(
                job, checkpoints, "planned", 0, 1, "변경 계획을 저장했다"
            ):
                return
        _validate_change_plan(plan, job["context"])
        changes = plan.get("changes")
        if not isinstance(changes, list):
            raise LlmUnavailable(
                code="invalid_output",
                message="AI 문서 변경 계획의 형식이 올바르지 않다.",
                retryable=True,
            )
        if not changes:
            await self._finish_generation(
                job,
                {
                    "draft_id": None,
                    "summary": plan.get("summary"),
                    "questions": plan.get("questions", []),
                    "changes": [],
                    "provenance": _provenance(
                        self._planning_llm.model, contract, self._compiler, capabilities
                    ),
                },
            )
            return

        base_documents = _base_documents(job["context"])
        base_result = checkpoints.get("base_result")
        if checkpoints.get("base_result_ready") is not True:
            base_result = job["context"].get("base_compiler_result")
            if not isinstance(base_result, Mapping) and base_documents:
                base_result = await self._await_guarded(job, self._compile(base_documents))
                if await self._cancelled(job):
                    return
            checkpoints["base_result"] = base_result
            checkpoints["base_result_ready"] = True
            if not await self._checkpoint(
                job,
                checkpoints,
                "planned",
                0,
                len(changes),
                "기준 원문 검증을 저장했다",
            ):
                return
        candidate = _candidate_from_checkpoint(checkpoints, job["context"])
        completed = set(checkpoints.get("completed_paths", []))
        total = len(changes)
        compiler_result: Mapping[str, Any] | None = (
            checkpoints.get("compiler_result")
            if isinstance(checkpoints.get("compiler_result"), Mapping)
            else None
        )
        for index, raw_change in enumerate(changes):
            if not isinstance(raw_change, Mapping):
                raise LlmUnavailable(
                    code="invalid_output",
                    message="AI 문서 변경 항목이 올바르지 않다.",
                    retryable=True,
                )
            path = raw_change.get("path")
            operation = raw_change.get("operation")
            if not isinstance(path, str) or operation not in {"upsert", "delete"}:
                raise LlmUnavailable(
                    code="invalid_output",
                    message="AI 문서 변경 경로가 올바르지 않다.",
                    retryable=True,
                )
            if path in completed:
                continue
            if await self._cancelled(job):
                return
            if not await self._progress(job, "generating", index, total, f"{path} 작성 중"):
                return
            if operation == "delete":
                candidate.pop(path, None)
                outcome = await self._await_guarded(job, self._compile(candidate))
                if await self._cancelled(job):
                    return
                compiler_result = outcome
            else:
                title = raw_change.get("title")
                instruction = raw_change.get("instruction")
                if not isinstance(title, str) or not title or not isinstance(instruction, str):
                    raise LlmUnavailable(
                        code="invalid_output",
                        message="AI upsert 계획이 올바르지 않다.",
                        retryable=True,
                    )
                current = candidate.get(path, {}).get("text")
                diagnostics: list[Mapping[str, Any]] = []
                for repair_attempt in range(MAX_REPAIR_ATTEMPTS + 1):
                    text = await self._await_guarded(
                        job,
                        self._llm.draft_document(
                            instruction=instruction,
                            current_text=current if isinstance(current, str) else None,
                            diagnostics=diagnostics,
                            grammar=contract.grammar,
                            system_prompt=contract.system_prompt,
                        ),
                    )
                    if await self._cancelled(job):
                        return
                    candidate[path] = {
                        "id": candidate.get(path, {}).get("id"),
                        "path": path,
                        "title": title,
                        "text": text,
                        "target_rspdl_version": runtime.rspdl_version,
                    }
                    compiler_result = await self._await_guarded(job, self._compile(candidate))
                    if await self._cancelled(job):
                        return
                    diagnostics = _error_diagnostics(compiler_result)
                    current = text
                    error_count = len(diagnostics)
                    if error_count and repair_attempt < MAX_REPAIR_ATTEMPTS:
                        repair_message = (
                            f"{path} 컴파일 오류 {error_count}건 · "
                            f"수정 시도 {repair_attempt + 2}/{MAX_REPAIR_ATTEMPTS + 1}"
                        )
                    else:
                        repair_message = f"{path} 컴파일 완료 · 오류 {error_count}건"
                    if not await self._progress(
                        job, "generating", index, total, repair_message
                    ):
                        return
                    if not diagnostics:
                        break
            completed.add(path)
            checkpoints.update(
                completed_paths=sorted(completed),
                candidate_documents=list(candidate.values()),
                compiler_result=compiler_result,
            )
            error_count = len(_error_diagnostics(compiler_result or {}))
            message = f"{path} 컴파일 완료 · 오류 {error_count}건"
            if not await self._checkpoint(
                job, checkpoints, "generating", len(completed), total, message
            ):
                return

        final_result = (
            await self._await_guarded(job, self._compile(candidate)) if candidate else None
        )
        draft_changes = _diff_documents(base_documents, candidate)
        draft = {
            "base_project_revision": job["frozen_project_revision"],
            "base_source_hash": job["frozen_source_hash"],
            "changes": draft_changes,
            "candidate_documents": list(candidate.values()),
            "candidate_source_hash": project_source_hash(
                [RspdlSource(path=item["path"], text=item["text"]) for item in candidate.values()]
            ),
            "summary": plan.get("summary"),
            "rspdl_version": runtime.rspdl_version,
            "wire_schema_version": runtime.wire_schema_version,
            "locale": runtime.locale,
            "result": final_result,
            "base_result": base_result,
        }
        result = {
            "summary": plan.get("summary"),
            "questions": plan.get("questions", []),
            "changes": [
                {key: value for key, value in item.items() if key not in {"text", "before_text"}}
                for item in draft_changes
            ],
            "provenance": _provenance(
                self._planning_llm.model, contract, self._compiler, capabilities
            ),
        }
        async with self._sessions() as session:
            stored = await SqlPlanningAiJobRepository(session).finish_generation_draft(
                UUID(str(job["id"])),
                lease_token=UUID(str(job["lease_token"])),
                draft=draft,
                result=result,
            )
            if stored:
                await session.commit()

    async def _compile(self, documents: Mapping[str, Mapping[str, Any]]) -> Mapping[str, Any]:
        outcome = await self._compiler.compile(
            [RspdlSource(path=path, text=str(item["text"])) for path, item in documents.items()]
        )
        return outcome.result

    async def _progress(
        self, job: Mapping[str, Any], stage: str, completed: int, total: int, message: str
    ) -> bool:
        async with self._sessions() as session:
            ok = await SqlPlanningAiJobRepository(session).heartbeat(
                UUID(str(job["id"])),
                lease_token=UUID(str(job["lease_token"])),
                lease_seconds=LEASE_SECONDS,
                progress={
                    "stage": stage,
                    "completed": completed,
                    "total": max(total, 1),
                    "message": message,
                },
            )
            if ok:
                await session.commit()
            return ok

    async def _checkpoint(
        self,
        job: Mapping[str, Any],
        checkpoints: Mapping[str, Any],
        stage: str,
        completed: int,
        total: int,
        message: str,
    ) -> bool:
        async with self._sessions() as session:
            ok = await SqlPlanningAiJobRepository(session).checkpoint(
                UUID(str(job["id"])),
                lease_token=UUID(str(job["lease_token"])),
                checkpoints=checkpoints,
                progress={
                    "stage": stage,
                    "completed": completed,
                    "total": max(total, 1),
                    "message": message,
                },
            )
            if ok:
                await session.commit()
            return ok

    async def _cancelled(self, job: Mapping[str, Any]) -> bool:
        async with self._sessions() as session:
            store = SqlPlanningAiJobRepository(session)
            cancelled = await store.cancelled(
                UUID(str(job["id"])), lease_token=UUID(str(job["lease_token"]))
            )
            if cancelled:
                await store.finish_cancelled(
                    UUID(str(job["id"])), lease_token=UUID(str(job["lease_token"]))
                )
                await session.commit()
            return cancelled

    async def _finish_generation(self, job: Mapping[str, Any], result: Mapping[str, Any]) -> None:
        async with self._sessions() as session:
            ok = await SqlPlanningAiJobRepository(session).finish_generation(
                UUID(str(job["id"])), lease_token=UUID(str(job["lease_token"])), result=result
            )
            if ok:
                await session.commit()

    async def _fail(self, job: Mapping[str, Any], code: str, message: str, retryable: bool) -> None:
        async with self._sessions() as session:
            ok = await SqlPlanningAiJobRepository(session).finish_failed(
                UUID(str(job["id"])),
                lease_token=UUID(str(job["lease_token"])),
                error={"code": code, "message": message, "retryable": retryable},
            )
            if ok:
                await session.commit()

    async def _await_guarded(self, job: Mapping[str, Any], awaitable: Awaitable[T]) -> T:
        stopped = asyncio.Event()

        async def keep_lease() -> None:
            while not stopped.is_set():
                try:
                    await asyncio.wait_for(stopped.wait(), timeout=30)
                    return
                except TimeoutError:
                    async with self._sessions() as session:
                        ok = await SqlPlanningAiJobRepository(session).renew_lease(
                            UUID(str(job["id"])),
                            lease_token=UUID(str(job["lease_token"])),
                            lease_seconds=LEASE_SECONDS,
                        )
                        if ok:
                            await session.commit()
                        else:
                            return

        heartbeat = asyncio.create_task(keep_lease())
        try:
            return await awaitable
        finally:
            stopped.set()
            heartbeat.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat


def _llm_context(job: Mapping[str, Any]) -> dict[str, Any]:
    return {"instruction": job["request"]["instruction"], **dict(job["context"])}


def _accepted_decisions(job: Mapping[str, Any]) -> list[Any]:
    state = job["context"].get("planning_state", {})
    return [
        item
        for item in state.get("decisions", [])
        if isinstance(item, Mapping) and item.get("status") == "decided"
    ]


def _unresolved_proposals(job: Mapping[str, Any]) -> list[Any]:
    state = job["context"].get("planning_state", {})
    return [
        item
        for item in state.get("proposals", [])
        if isinstance(item, Mapping) and item.get("status") in {"open", "deferred"}
    ]


def _runtime_payload(compiler: RspdlCompilerPort, capabilities: frozenset[str]) -> dict[str, Any]:
    runtime = compiler.runtime
    return {
        "rspdl_version": runtime.rspdl_version,
        "wire_schema_version": runtime.wire_schema_version,
        "locale": runtime.locale,
        "capabilities": sorted(capabilities),
    }


def _provenance(
    model: str,
    contract: AuthoringContract,
    compiler: RspdlCompilerPort,
    capabilities: frozenset[str],
) -> dict[str, Any]:
    contract_payload = "\0".join(
        (
            contract.profile,
            contract.system_prompt,
            contract.grammar.name,
            contract.grammar.start_rule,
            contract.grammar.definition,
        )
    )
    return {
        "model": model,
        "authoring_profile": contract.profile,
        "authoring_contract_hash": hashlib.sha256(contract_payload.encode()).hexdigest(),
        "planning_prompt_hash": hashlib.sha256(CHANGE_PLAN_SYSTEM_PROMPT.encode()).hexdigest(),
        **_runtime_payload(compiler, capabilities),
    }


def _error_diagnostics(result: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    found: list[Mapping[str, Any]] = []
    files = result.get("files")
    if isinstance(files, list):
        for file in files:
            if isinstance(file, Mapping) and isinstance(file.get("diagnostics"), list):
                found.extend(
                    item
                    for item in file["diagnostics"]
                    if isinstance(item, Mapping)
                    and str(item.get("severity", "")).lower() == "error"
                )
    return found


def _candidate_from_checkpoint(
    checkpoints: Mapping[str, Any], context: Mapping[str, Any]
) -> dict[str, dict[str, Any]]:
    values = checkpoints.get("candidate_documents", context.get("documents", []))
    return {
        str(item["path"]): dict(item)
        for item in values
        if isinstance(item, Mapping) and isinstance(item.get("path"), str)
    }


def _base_documents(context: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    candidate = _candidate_from_checkpoint({}, context)
    for change in reversed(context.get("source_changes", [])):
        if not isinstance(change, Mapping) or not isinstance(change.get("path"), str):
            continue
        path = str(change["path"])
        if change.get("before_exists"):
            candidate[path] = {
                "id": candidate.get(path, {}).get("id"),
                "path": path,
                "title": change.get("before_title"),
                "text": change.get("before_text"),
                "target_rspdl_version": candidate.get(path, {}).get("target_rspdl_version"),
            }
        else:
            candidate.pop(path, None)
    return candidate


def _validate_change_plan(plan: Mapping[str, Any], context: Mapping[str, Any]) -> None:
    """Reject provider-authored file identities before source generation or persistence."""
    changes = plan.get("changes")
    if not isinstance(changes, list):
        raise LlmUnavailable(
            code="invalid_output",
            message="AI 문서 변경 계획의 형식이 올바르지 않다.",
            retryable=True,
        )
    paths: set[str] = set()
    available = set(_candidate_from_checkpoint({}, context))
    for item in changes:
        if not isinstance(item, Mapping):
            raise LlmUnavailable(
                code="invalid_output",
                message="AI 문서 변경 항목이 올바르지 않다.",
                retryable=True,
            )
        path, operation = item.get("path"), item.get("operation")
        if not isinstance(path, str) or operation not in {"upsert", "delete"}:
            raise LlmUnavailable(
                code="invalid_output",
                message="AI 문서 변경 경로가 올바르지 않다.",
                retryable=True,
            )
        if path in paths:
            raise LlmUnavailable(
                code="invalid_output",
                message="AI 문서 변경 계획에 중복 경로가 있다.",
                retryable=False,
            )
        paths.add(path)
        if operation == "upsert":
            title, instruction = item.get("title"), item.get("instruction")
            if (
                not isinstance(title, str)
                or not isinstance(instruction, str)
                or not instruction
                or len(instruction) > 2000
            ):
                raise LlmUnavailable(
                    code="invalid_output",
                    message="AI upsert 계획이 올바르지 않다.",
                    retryable=True,
                )
            validate_document_identity(path=path, title=title)
            available.add(path)
        else:
            validate_document_identity(path=path, title="삭제")
            if path not in available:
                raise LlmUnavailable(
                    code="invalid_output",
                    message="AI 문서 변경 계획이 존재하지 않는 문서를 삭제하려 한다.",
                    retryable=False,
                )
            available.remove(path)


def _diff_documents(
    base: Mapping[str, Mapping[str, Any]], candidate: Mapping[str, Mapping[str, Any]]
) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for path in sorted(set(base) | set(candidate)):
        before, after = base.get(path), candidate.get(path)
        if before == after:
            continue
        if after is None:
            changes.append(
                {
                    "operation": "delete",
                    "path": path,
                    "before_exists": True,
                    "before_title": before.get("title") if before else None,
                    "before_text": before.get("text") if before else None,
                }
            )
        else:
            changes.append(
                {
                    "operation": "upsert",
                    "path": path,
                    "title": after.get("title"),
                    "text": after.get("text"),
                    "before_exists": before is not None,
                    "before_title": before.get("title") if before else None,
                    "before_text": before.get("text") if before else None,
                }
            )
    return changes
