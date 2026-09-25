import type { PlanningDraftResponse, PlanningDraftSummaryResponse, PlanningStateResponse, ProjectCompileResponse, ProjectSnapshotSummaryResponse } from '@dahaze/api-client'
import type { RspdlDiagnostic } from '@dahaze/rspdl-editor'

import { documentHref } from '../navigation/views'
import { errorMessage } from '../../shared/api/errors'
import { renderDiagnosticMessage, renderDiagnosticTitle } from '../../shared/rspdl/diagnostic-messages'
import type { PlanningAiJob, PlanningCompilerReview, PlanningCompilerState, PlanningDraft, PlanningItem, PlanningMessage, PlanningProposal, PlanningWorkspaceModel } from './planning-types'

/*
 * 서버 응답을 기획 화면의 모델로 옮기는 순수 함수들. 검토 화면과 AI 패널이 함께 쓴다.
 * 화면 컴포넌트와 떼어 둔 이유는 AI 패널이 `AppShell` 안에 있어서, 화면 파일을 거쳐 오면
 * `AppShell` 로 되돌아가는 순환 import 가 생기기 때문이다.
 */

type LoadedResult<T> = { state: 'loading' | 'failed' | 'ready'; data?: T; failureMessage?: string }

export interface PlanningCompilerInputs {
  current: LoadedResult<ProjectCompileResponse>
  selectedDraft: LoadedResult<PlanningDraftResponse>
}

export function toModel(state: PlanningStateResponse, drafts: PlanningDraftSummaryResponse[], snapshots: ProjectSnapshotSummaryResponse[], selectedDraftId: string | null, compilerInputs: PlanningCompilerInputs, aiJobs: readonly unknown[] = []): PlanningWorkspaceModel {
  const decisions = state.decisions.map(toItem)
  const selectedDraft = compilerInputs.selectedDraft.data
  return {
    revision: state.revision, projectRevision: state.project_revision, sourceHash: state.source_hash,
    messages: toMessages(state),
    acceptedDecisions: decisions.filter((_, index) => state.decisions[index]?.status === 'decided'),
    unresolvedDecisions: decisions.filter((_, index) => state.decisions[index]?.status !== 'decided'),
    questions: state.proposals.filter((raw) => raw.kind === 'question' && proposalStatus(raw) === 'open').map(toItem),
    proposals: state.proposals.filter((raw) => raw.kind !== 'question' && raw.kind !== 'unsupported').map(toProposal),
    unsupported: state.proposals.filter((raw) => raw.kind === 'unsupported' && proposalStatus(raw) === 'open').map(toItem),
    jobs: toAiJobs(aiJobs),
    compiler: selectedDraftId === null
      ? currentCompilerReview(compilerInputs.current)
      : draftCompilerReview(state, drafts.find((draft) => draft.id === selectedDraftId), selectedDraftId, compilerInputs.selectedDraft),
    drafts: drafts.map((summary) => selectedDraft?.id === summary.id ? toDraft(selectedDraft) : ({ id: summary.id, summary: summary.summary ?? '변경안', baseRevision: summary.base_project_revision, status: summary.applied_revision === null ? 'draft' : 'applied', changes: [], diagnostics: [], analysis: [] })), selectedDraftId,
    snapshots: snapshots.map((entry) => ({ revision: entry.snapshot_version, createdAt: entry.created_at, changeKind: entry.change_kind, sourceHash: entry.source_hash })),
  }
}

export function toMessages(state: PlanningStateResponse): PlanningMessage[] {
  return state.messages.map((raw, index) => ({ id: string(raw.id) ?? `message-${index}`, role: raw.role === 'assistant' ? 'assistant' : 'user', content: string(raw.content) ?? '', createdAt: string(raw.created_at) ?? '' }))
}

export function toAiJobs(raw: readonly unknown[]): PlanningAiJob[] {
  return raw.map(toAiJob).filter((job): job is PlanningAiJob => job !== null)
}

function currentCompilerReview(result: LoadedResult<ProjectCompileResponse>): PlanningCompilerReview {
  const source = { kind: 'current' as const, documents: result.state === 'ready' && result.data !== undefined ? result.data.documents.map((document) => ({ id: document.id, path: document.path, sourceHash: document.source_hash })) : [] }
  if (result.state === 'loading') return { state: 'running', source, diagnostics: [] }
  if (result.state === 'failed') return { state: 'failed', source, diagnostics: [], failureMessage: result.failureMessage }
  if (result.data === undefined) return { state: 'not-run', source, diagnostics: [] }
  const state = compilerResultState(result.data.result, new Set(source.documents.map((document) => document.path)))
  return { state, source, rspdlVersion: result.data.rspdl_version, diagnostics: state === 'recognized' ? diagnostics(result.data.result) : [] }
}

function draftCompilerReview(state: PlanningStateResponse, summary: PlanningDraftSummaryResponse | undefined, draftId: string, result: LoadedResult<PlanningDraftResponse>): PlanningCompilerReview {
  const draft = result.data
  const baseProjectRevision = draft?.base_project_revision ?? summary?.base_project_revision ?? 0
  const baseSourceHash = draft?.base_source_hash ?? summary?.base_source_hash ?? ''
  const source = {
    kind: 'draft' as const,
    draftId,
    summary: draft?.summary ?? summary?.summary ?? '변경안',
    baseProjectRevision,
    baseSourceHash,
    candidateSourceHash: draft?.candidate_source_hash ?? summary?.candidate_source_hash ?? '',
    stale: baseProjectRevision !== state.project_revision || baseSourceHash !== state.source_hash,
  }
  if (result.state === 'loading') return { state: 'running', source, rspdlVersion: draft?.rspdl_version ?? summary?.rspdl_version, diagnostics: [] }
  if (result.state === 'failed') return { state: 'failed', source, rspdlVersion: summary?.rspdl_version, diagnostics: [], failureMessage: result.failureMessage }
  if (draft === undefined) return { state: 'not-run', source, rspdlVersion: summary?.rspdl_version, diagnostics: [] }
  const compileState = compilerResultState(draft.result)
  return { state: compileState, source, rspdlVersion: draft.rspdl_version, diagnostics: compileState === 'recognized' ? diagnostics(draft.result) : [] }
}

function compilerResultState(result: unknown, acceptedPaths?: ReadonlySet<string>): PlanningCompilerState {
  if (result === null || result === undefined) return 'not-run'
  return isRecord(result) && Array.isArray(result.files) && result.files.every((file) => isCompilerFile(file) && (acceptedPaths === undefined || acceptedPaths.has(file.path))) ? 'recognized' : 'unsupported-shape'
}

export function queryResult<T>(data: T | undefined, isFetching: boolean, error: unknown): LoadedResult<T> {
  if (isFetching) return { state: 'loading' }
  if (error !== null && error !== undefined) return { state: 'failed', failureMessage: errorMessage(error) }
  return { state: 'ready', data }
}

export function acceptedCompilerDocumentHref(projectId: string, compiler: PlanningCompilerReview, path: string): string | null {
  if (compiler.state !== 'recognized' || compiler.source.kind !== 'current') return null
  const document = compiler.source.documents.find((entry) => entry.path === path)
  return document === undefined ? null : documentHref(projectId, document.id)
}

function toDraft(raw: PlanningDraftResponse): PlanningDraft {
  const candidateByPath = new Map(raw.candidate_documents.filter(isRecord).map((entry) => [string(entry.path) ?? '', string(entry.text)]))
  return { id: raw.id, summary: typeof raw.summary === 'string' ? raw.summary : '변경안', baseRevision: raw.base_project_revision, status: raw.applied_revision === null ? 'draft' : 'applied', changes: raw.changes.filter(isRecord).map((change) => { const path = string(change.path) ?? '알 수 없는 문서'; const before = change.before_exists === true ? (string(change.before_text) ?? '') : change.before_exists === false ? null : undefined; return { path, before, after: candidateByPath.get(path) ?? (change.operation === 'delete' ? null : '후보 본문을 불러오지 못했습니다') } }), diagnostics: diagnostics(raw.result), analysis: [`rspdl ${raw.rspdl_version}`, `wire schema ${raw.wire_schema_version}`, `기준 원문 ${raw.base_source_hash.slice(0, 10)}`] }
}

function diagnostics(result: unknown): PlanningItem[] { if (!isRecord(result) || !Array.isArray(result.files)) return []; const items: PlanningItem[] = []; for (const file of result.files) { if (!isRecord(file) || !Array.isArray(file.diagnostics)) continue; const path = string(file.path); for (const diagnostic of file.diagnostics) if (isDiagnostic(diagnostic)) items.push({ id: `${path}:${items.length}`, title: renderDiagnosticTitle(diagnostic), detail: renderDiagnosticMessage(diagnostic), sourcePath: path ?? undefined }); } return items }
function toItem(raw: Record<string, unknown>, index = 0): PlanningItem { return { id: string(raw.id) ?? `item-${index}`, title: string(raw.title) ?? string(raw.question) ?? string(raw.content) ?? '제목 없음', detail: string(raw.rationale) ?? string(raw.detail) ?? string(raw.reason) ?? undefined, resolutionRationale: string(raw.resolution_rationale) ?? undefined, sourcePath: string(raw.source_path) ?? undefined } }
function toProposal(raw: Record<string, unknown>, index = 0): PlanningProposal { return { ...toItem(raw, index), status: proposalStatus(raw), rationale: string(raw.rationale) ?? undefined } }
function proposalStatus(raw: Record<string, unknown>): PlanningProposal['status'] { return raw.status === 'adopted' || raw.status === 'deferred' ? raw.status : 'open' }
export function toAiJob(value: unknown): PlanningAiJob | null {
  if (!isRecord(value) || typeof value.id !== 'string' || (value.kind !== 'interview' && value.kind !== 'generate') || !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(String(value.status))) return null
  const progress = isRecord(value.progress) ? value.progress : null
  const error = isRecord(value.error) ? value.error : null
  const result = isRecord(value.result) ? value.result : null
  const conflict = isRecord(result?.conflict) ? result.conflict : null
  const attempt = number(value.attempt) ?? 1
  const maxAttempts = number(value.max_attempts) ?? 1
  return {
    id: value.id,
    kind: value.kind,
    status: value.status as PlanningAiJob['status'],
    stage: string(progress?.stage) ?? undefined,
    completed: number(progress?.completed) ?? undefined,
    total: number(progress?.total) ?? undefined,
    message: string(progress?.message) ?? undefined,
    errorMessage: string(error?.message) ?? undefined,
    retryable: (value.status === 'failed' || value.status === 'cancelled') && error?.retryable !== false && attempt < maxAttempts,
    disposition: result?.disposition === 'stale' ? 'stale' : result?.disposition === 'current' ? 'current' : undefined,
    conflictMessage: staleConflictMessage(conflict),
    draftId: string(result?.draft_id) ?? undefined,
    resultMessage: string(result?.assistant_message) ?? string(result?.summary) ?? undefined,
    resultItems: aiResultItems(result),
    createdAt: string(value.created_at) ?? '',
  }
}
function aiResultItems(result: Record<string, unknown> | null): string[] | undefined {
  if (result === null) return undefined
  const entries = [...(Array.isArray(result.proposals) ? result.proposals : []), ...(Array.isArray(result.policy_first_questions) ? result.policy_first_questions : []), ...(Array.isArray(result.unsupported) ? result.unsupported : []), ...(Array.isArray(result.questions) ? result.questions : [])]
  const items = entries.flatMap((entry) => { if (typeof entry === 'string') return [entry]; const raw = isRecord(entry) ? entry : null; const title = string(raw?.title) ?? string(raw?.question) ?? string(raw?.content); return title === null ? [] : [title] })
  const unique = [...new Set(items)]
  return unique.length === 0 ? undefined : unique
}
function staleConflictMessage(conflict: Record<string, unknown> | null): string | undefined {
  if (conflict === null) return undefined
  const frozenPlanning = number(conflict.frozen_planning_revision)
  const currentPlanning = number(conflict.current_planning_revision)
  if (frozenPlanning !== null && currentPlanning !== null && frozenPlanning !== currentPlanning) return `기준 기획 리비전 ${frozenPlanning}에서 만든 결과이며 현재 리비전은 ${currentPlanning}입니다.`
  const reasons = Array.isArray(conflict.reasons) ? conflict.reasons : []
  if (reasons.includes('project_revision_changed') || reasons.includes('source_hash_changed')) return '작업 중 저장 명세가 바뀌어 결과가 현재 상태에 자동 반영되지 않았습니다.'
  if (reasons.includes('planning_revision_changed')) return '작업 중 기획 판단이 바뀌어 결과가 현재 상태에 자동 반영되지 않았습니다.'
  return '작업 중 프로젝트가 바뀌어 결과가 현재 상태에 자동 반영되지 않았습니다.'
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function string(value: unknown): string | null { return typeof value === 'string' ? value : null }
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function isCompilerFile(value: unknown): value is { path: string; diagnostics: RspdlDiagnostic[] } { return isRecord(value) && typeof value.path === 'string' && Array.isArray(value.diagnostics) && value.diagnostics.every(isDiagnostic) }
function isDiagnostic(value: unknown): value is RspdlDiagnostic {
  if (!isRecord(value) || typeof value.rule_id !== 'string' || typeof value.message_key !== 'string' || !['error', 'warning', 'info'].includes(String(value.severity))) return false
  const span = isRecord(value.span) ? value.span : null
  if (span === null || typeof span.start !== 'number' || typeof span.end !== 'number') return false
  if (value.message !== undefined && typeof value.message !== 'string') return false
  if (value.arguments === undefined) return true
  return isRecord(value.arguments) && Object.values(value.arguments).every((argument) => typeof argument === 'string')
}
