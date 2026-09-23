'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useApplyPlanningDraft,
  useCancelPlanningAiJob,
  useCompileProject,
  useCreatePlanningAiJob,
  useCaptureProjectSnapshot,
  useResolvePlanningDecision,
  useResolvePlanningProposal,
  useGetPlanningDraft,
  useGetPlanningState,
  useGetProjectSnapshot,
  useListPlanningAiJobs,
  useListPlanningDrafts,
  useListPlanningMetadataHistory,
  useListProjectSnapshots,
  usePatchPlanningMetadata,
  useRetryPlanningAiJob,
  useRestoreProjectSnapshot,
  useUndoPlanningMetadata,
  type PlanningDraftResponse,
  type PlanningDraftSummaryResponse,
  type PlanningAiJobResponse,
  type PlanningStateResponse,
  type PlanningMetadataRevisionResponse,
  type ProjectCompileResponse,
  type ProjectSnapshotResponse,
  type ProjectSnapshotSummaryResponse,
} from '@dahaze/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { Button, ErrorState, Skeleton, toast } from '@dahaze/ui'
import { useRouter } from 'next/navigation'

import { RequireSession } from '../auth/require-session'
import { documentHref } from '../navigation/views'
import { errorMessage } from '../../shared/api/errors'
import { AppShell, Crumb } from '../../shared/ui/app-shell'
import { renderDiagnosticMessage, renderDiagnosticTitle } from '../../shared/rspdl/diagnostic-messages'
import type { RspdlDiagnostic } from '@dahaze/rspdl-editor'
import type { PlanningAiJob, PlanningCompilerReview, PlanningCompilerState, PlanningDraft, PlanningItem, PlanningProposal, PlanningSubject, PlanningWorkspaceModel } from './planning-types'
import { PlanningWorkspace } from './planning-workspace'
import { HandoffInspector } from './handoff-inspector'
import { MetadataEditor } from './metadata-editor'
import { toMetadataCatalog } from './metadata-catalog'
import { DraftResultInspector } from './draft-result-inspector'
import { buildPlanningAiJobRequest } from './planning-ai-request'

export function PlanningWorkspaceScreen({ projectId, initialSubject }: { projectId: string; initialSubject?: PlanningSubject }) {
  return <AppShell fullBleed lockToViewport breadcrumb={<Crumb>기획 워크스페이스</Crumb>}><RequireSession><PlanningLoader projectId={projectId} initialSubject={initialSubject} /></RequireSession></AppShell>
}

function PlanningLoader({ projectId, initialSubject }: { projectId: string; initialSubject?: PlanningSubject }) {
  const router = useRouter()
  const state = useGetPlanningState<PlanningStateResponse>(projectId)
  const compilation = useCompileProject<ProjectCompileResponse>(projectId)
  const aiJobs = useListPlanningAiJobs<PlanningAiJobResponse[]>(projectId, { limit: 50 }, { query: { refetchInterval: (query) => Array.isArray(query.state.data) && query.state.data.some((job) => job.status === 'queued' || job.status === 'running') ? 1000 : false } })
  const drafts = useListPlanningDrafts<PlanningDraftSummaryResponse[]>(projectId, { limit: 50, offset: 0 })
  const snapshots = useListProjectSnapshots<ProjectSnapshotSummaryResponse[]>(projectId, { limit: 50, offset: 0 })
  const metadataHistory = useListPlanningMetadataHistory<PlanningMetadataRevisionResponse[]>(projectId, { limit: 100 })
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null)
  const activeDraftId = selectedDraftId
  const selectedDraft = useGetPlanningDraft<PlanningDraftResponse>(activeDraftId ?? '', { query: { enabled: activeDraftId !== null } })
  const [selectedSnapshotVersion, setSelectedSnapshotVersion] = useState<number | null>(null)
  const [compareSnapshotVersion, setCompareSnapshotVersion] = useState<number | null>(null)
  const [snapshotSummary, setSnapshotSummary] = useState('')
  const selectedSnapshot = useGetProjectSnapshot<ProjectSnapshotResponse>(projectId, selectedSnapshotVersion ?? 0, { query: { enabled: selectedSnapshotVersion !== null } })
  const compareSnapshot = useGetProjectSnapshot<ProjectSnapshotResponse>(projectId, compareSnapshotVersion ?? 0, { query: { enabled: compareSnapshotVersion !== null } })
  const queryClient = useQueryClient()
  const apply = useApplyPlanningDraft()
  const captureSnapshot = useCaptureProjectSnapshot()
  const restore = useRestoreProjectSnapshot()
  const createAiJob = useCreatePlanningAiJob()
  const cancelAiJob = useCancelPlanningAiJob()
  const retryAiJob = useRetryPlanningAiJob()
  const resolveDecision = useResolvePlanningDecision()
  const resolveProposal = useResolvePlanningProposal()
  const patchMetadata = usePatchPlanningMetadata()
  const undoMetadata = useUndoPlanningMetadata()

  const model = useMemo(() => state.data === undefined ? null : toModel(
    state.data,
    drafts.data ?? [],
    snapshots.data ?? [],
    selectedDraftId,
    {
      current: queryResult(compilation.data, compilation.isFetching, compilation.error),
      selectedDraft: queryResult(selectedDraft.data, selectedDraft.isFetching, selectedDraft.error),
    },
    aiJobs.data ?? [],
  ), [state.data, drafts.data, snapshots.data, selectedDraftId, compilation.data, compilation.isFetching, compilation.error, selectedDraft.data, selectedDraft.isFetching, selectedDraft.error, aiJobs.data])
  const observedTerminalJobs = useRef(new Set<string>())
  const pendingRequest = useRef<{ key: string; requestId: string } | null>(null)
  useEffect(() => {
    const terminal = (aiJobs.data ?? []).filter((job) => job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled')
    const fresh = terminal.filter((job) => !observedTerminalJobs.current.has(job.id))
    for (const job of terminal) observedTerminalJobs.current.add(job.id)
    if (fresh.length === 0) return
    void Promise.all([state.refetch(), drafts.refetch(), compilation.refetch()])
  }, [aiJobs.data, compilation, drafts, state])
  if (state.isPending || drafts.isPending || snapshots.isPending || metadataHistory.isPending || aiJobs.isPending) return <div className="grid min-h-0 flex-1 grid-cols-3 gap-px"><Skeleton /><Skeleton /><Skeleton /></div>
  if (state.error !== null || drafts.error !== null || snapshots.error !== null || metadataHistory.error !== null || aiJobs.error !== null || model === null) return <ErrorState title="기획 워크스페이스를 불러오지 못했습니다" description={errorMessage(state.error ?? drafts.error ?? snapshots.error ?? metadataHistory.error ?? aiJobs.error)} />

  const refresh = () => queryClient.invalidateQueries()
  const metadataBusy = patchMetadata.isPending || undoMetadata.isPending
  const catalog = toMetadataCatalog(compilation.data)
  const metadataEditor = <MetadataEditor metadata={state.data.metadata} metadataRevision={state.data.metadata_revision} catalog={catalog} history={metadataHistory.data ?? []} busy={metadataBusy} onSave={async (metadata, summary) => { try { const result = await patchMetadata.mutateAsync({ projectId, data: { expected_revision: model.revision, environments: metadata.environments, sample_data: metadata.sample_data, summary } }); await refresh(); toast.success('환경과 샘플 데이터를 저장했습니다'); return result.metadata_revision } catch (error) { toast.error('메타데이터를 저장하지 못했습니다', { description: errorMessage(error) }); return null } }} onUndo={(targetRevision) => undoMetadata.mutate({ projectId, data: { expected_revision: model.revision, target_revision: targetRevision } }, { onSuccess: async () => { await refresh(); toast.success('메타데이터 전체를 선택한 리비전으로 되돌렸습니다') }, onError: (error) => toast.error('되돌리지 못했습니다', { description: errorMessage(error) }) })} />
  const canOpenAcceptedSource = model.compiler.source.kind === 'current' && model.compiler.state === 'recognized'
  const aiBusy = createAiJob.isPending || cancelAiJob.isPending || retryAiJob.isPending || resolveProposal.isPending
  const sourceDraft = activeDraftId ?? undefined
  const createJob = async (kind: 'interview' | 'generate', instruction: string, subject?: PlanningSubject) => {
    const key = JSON.stringify({ kind, instruction, planningRevision: model.revision, projectRevision: model.projectRevision, sourceHash: model.sourceHash, sourceDraft, subject })
    if (pendingRequest.current?.key !== key) pendingRequest.current = { key, requestId: crypto.randomUUID() }
    const result = await createAiJob.mutateAsync({ projectId, data: buildPlanningAiJobRequest({ requestId: pendingRequest.current.requestId, kind, instruction, planningRevision: model.revision, projectRevision: model.projectRevision, sourceHash: model.sourceHash, sourceDraftId: sourceDraft, subject }) })
    pendingRequest.current = null
    return result
  }

  return <PlanningWorkspace
    model={model}
    initialSubject={initialSubject}
    busy={apply.isPending || restore.isPending || resolveDecision.isPending || metadataBusy || aiBusy}
    onSendMessage={async (content, subject) => { try { await createJob('interview', content, subject); await refresh(); toast.success('답변을 저장하고 AI 인터뷰를 시작했습니다'); return true } catch (error) { toast.error('AI 인터뷰를 시작하지 못했습니다', { description: errorMessage(error) }); return false } }}
    onGenerateDraft={() => { void createJob('generate', sourceDraft === undefined ? '확정한 목적과 정책, 대화를 바탕으로 컴파일 가능한 프로젝트 명세와 정보구조 초안을 작성해 주세요.' : '선택한 초안의 컴파일러 진단과 대화를 반영해 새 컴파일 후보를 작성해 주세요.').then(refresh).then(() => toast.success('명세·IA 초안 작성을 시작했습니다')).catch((error) => toast.error('초안 작성을 시작하지 못했습니다', { description: errorMessage(error) })) }}
    onCancelJob={(jobId) => cancelAiJob.mutate({ projectId, jobId }, { onSuccess: refresh, onError: (error) => toast.error('AI 작업을 취소하지 못했습니다', { description: errorMessage(error) }) })}
    onRetryJob={(jobId) => retryAiJob.mutate({ projectId, jobId }, { onSuccess: refresh, onError: (error) => toast.error('AI 작업을 다시 시작하지 못했습니다', { description: errorMessage(error) }) })}
    onResolveProposal={async (proposalId, action, reason) => { try { await resolveProposal.mutateAsync({ projectId, proposalId, data: { expected_revision: model.revision, status: action === 'adopt' ? 'adopted' : 'deferred', rationale: reason || null } }); await refresh(); toast.success(action === 'adopt' ? 'AI 제안을 정책으로 채택했습니다' : 'AI 제안을 보류했습니다'); return true } catch (error) { toast.error('AI 제안 결정을 저장하지 못했습니다', { description: errorMessage(error) }); return false } }}
    onResolveDecision={async (id, action, reason) => { const item = model.unresolvedDecisions.find((decision) => decision.id === id); if (!item) return false; try { await resolveDecision.mutateAsync({ projectId, decisionId: id, data: { status: action === 'adopt' ? 'decided' : 'deferred', rationale: reason || null, expected_revision: model.revision } }); await refresh(); return true } catch (error) { toast.error('결정을 저장하지 못했습니다', { description: errorMessage(error) }); return false } }}
    onSelectDraft={setSelectedDraftId}
    onApplyDraft={(draftId) => apply.mutate({ draftId, data: { expected_project_revision: model.projectRevision, expected_source_hash: model.sourceHash } }, { onSuccess: async (result) => { if (result.applied) setSelectedDraftId(null); await refresh(); toast[result.applied ? 'success' : 'error'](result.applied ? '변경안을 적용했습니다' : '변경안이 적용되지 않았습니다') }, onError: (error) => toast.error('변경안을 적용하지 못했습니다', { description: errorMessage(error) }) })}
    onOpenSource={canOpenAcceptedSource ? (path) => { const href = acceptedCompilerDocumentHref(projectId, model.compiler, path); if (href !== null) router.push(href) } : undefined}
    onInspectSnapshot={(version) => { setSelectedSnapshotVersion(version); if (compareSnapshotVersion === version) setCompareSnapshotVersion(null) }}
    onRestoreSnapshot={(snapshotVersion) => restore.mutate({ projectId, revision: snapshotVersion, data: { expected_planning_revision: model.revision, expected_project_revision: model.projectRevision, expected_source_hash: model.sourceHash } }, { onSuccess: async () => { await refresh(); toast.success('선택한 버전을 새 프로젝트 버전으로 복원했습니다') }, onError: (error) => toast.error('버전을 복원하지 못했습니다', { description: errorMessage(error) }) })}
    draftArtifacts={selectedDraft.data === undefined ? null : <DraftResultInspector draft={selectedDraft.data} planningState={state.data} />}
    handoff={<><section className="border-t p-4"><h3 className="text-sm font-semibold">개발 전달본 만들기</h3><div className="mt-2 flex gap-2"><input aria-label="전달본 요약" value={snapshotSummary} onChange={(event) => setSnapshotSummary(event.target.value)} placeholder="이번 전달본의 변경 요약" className="min-w-0 flex-1 rounded border bg-surface px-2 text-xs" /><Button size="sm" disabled={captureSnapshot.isPending} onClick={() => captureSnapshot.mutate({ projectId, data: { expected_planning_revision: model.revision, expected_project_revision: model.projectRevision, expected_source_hash: model.sourceHash, summary: snapshotSummary || null } }, { onSuccess: async (snapshot) => { setSelectedSnapshotVersion(snapshot.snapshot_version); setSnapshotSummary(''); await refresh(); toast.success('현재 상태로 전달본을 만들었습니다') }, onError: (error) => toast.error('전달본을 만들지 못했습니다', { description: errorMessage(error) }) })}>현재 상태로 만들기</Button></div></section>{metadataEditor}{selectedSnapshot.data ? <><label className="mx-4 mt-3 block text-xs">비교 버전 <select value={compareSnapshotVersion ?? ''} onChange={(event) => setCompareSnapshotVersion(event.target.value === '' ? null : Number(event.target.value))} className="ml-2 rounded border bg-surface px-2 py-1"><option value="">선택 안 함</option>{model.snapshots.filter((entry) => entry.revision !== selectedSnapshotVersion).map((entry) => <option key={entry.revision} value={entry.revision}>스냅샷 {entry.revision}</option>)}</select></label><HandoffInspector snapshot={selectedSnapshot.data} compare={compareSnapshot.data} /></> : null}</>}
  />
}

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
    messages: state.messages.map((raw, index) => ({ id: string(raw.id) ?? `message-${index}`, role: raw.role === 'assistant' ? 'assistant' : 'user', content: string(raw.content) ?? '', createdAt: string(raw.created_at) ?? '' })),
    acceptedDecisions: decisions.filter((_, index) => state.decisions[index]?.status === 'decided'),
    unresolvedDecisions: decisions.filter((_, index) => state.decisions[index]?.status !== 'decided'),
    questions: state.proposals.filter((raw) => raw.kind === 'question' && proposalStatus(raw) === 'open').map(toItem),
    proposals: state.proposals.filter((raw) => raw.kind !== 'question' && raw.kind !== 'unsupported').map(toProposal),
    unsupported: state.proposals.filter((raw) => raw.kind === 'unsupported' && proposalStatus(raw) === 'open').map(toItem),
    jobs: aiJobs.map(toAiJob).filter((job): job is PlanningAiJob => job !== null),
    compiler: selectedDraftId === null
      ? currentCompilerReview(compilerInputs.current)
      : draftCompilerReview(state, drafts.find((draft) => draft.id === selectedDraftId), selectedDraftId, compilerInputs.selectedDraft),
    drafts: drafts.map((summary) => selectedDraft?.id === summary.id ? toDraft(selectedDraft) : ({ id: summary.id, summary: summary.summary ?? '변경안', baseRevision: summary.base_project_revision, status: summary.applied_revision === null ? 'draft' : 'applied', changes: [], diagnostics: [], analysis: [] })), selectedDraftId,
    snapshots: snapshots.map((entry) => ({ revision: entry.snapshot_version, createdAt: entry.created_at, changeKind: entry.change_kind, sourceHash: entry.source_hash })),
  }
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

function queryResult<T>(data: T | undefined, isFetching: boolean, error: unknown): LoadedResult<T> {
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
function toItem(raw: Record<string, unknown>, index = 0): PlanningItem { return { id: string(raw.id) ?? `item-${index}`, title: string(raw.title) ?? string(raw.question) ?? string(raw.content) ?? '제목 없음', detail: string(raw.rationale) ?? string(raw.detail) ?? string(raw.reason) ?? undefined, sourcePath: string(raw.source_path) ?? undefined } }
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
    conflictMessage: conflict === null ? undefined : `기준 기획 리비전 ${number(conflict.frozen_planning_revision) ?? '?'}에서 만든 결과이며 현재 리비전은 ${number(conflict.current_planning_revision) ?? '?'}입니다.`,
    draftId: string(result?.draft_id) ?? undefined,
    resultMessage: string(result?.assistant_message) ?? string(result?.summary) ?? undefined,
    resultItems: aiResultItems(result),
    createdAt: string(value.created_at) ?? '',
  }
}
function aiResultItems(result: Record<string, unknown> | null): string[] | undefined {
  if (result === null) return undefined
  const entries = [...(Array.isArray(result.proposals) ? result.proposals : []), ...(Array.isArray(result.policy_first_questions) ? result.policy_first_questions : []), ...(Array.isArray(result.unsupported) ? result.unsupported : [])]
  const items = entries.flatMap((entry) => { if (typeof entry === 'string') return [entry]; const raw = isRecord(entry) ? entry : null; const title = string(raw?.title) ?? string(raw?.question) ?? string(raw?.content); return title === null ? [] : [title] })
  return items.length === 0 ? undefined : items
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
