'use client'

import { useMemo, useState } from 'react'
import {
  useApplyPlanningDraft,
  useAppendPlanningDecision,
  useAppendPlanningMessage,
  useGetPlanningDraft,
  useGetPlanningState,
  useGetProjectSnapshot,
  useListPlanningDrafts,
  useListPlanningMetadataHistory,
  useListProjectSnapshots,
  usePatchPlanningMetadata,
  useRestoreProjectSnapshot,
  useUndoPlanningMetadata,
  type PlanningDraftResponse,
  type PlanningDraftSummaryResponse,
  type PlanningStateResponse,
  type PlanningMetadataRevisionResponse,
  type ProjectSnapshotResponse,
  type ProjectSnapshotSummaryResponse,
} from '@dahaze/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { ErrorState, Skeleton, toast } from '@dahaze/ui'

import { RequireSession } from '@/features/auth/require-session'
import { errorMessage } from '@/shared/api/errors'
import { AppShell, Crumb } from '@/shared/ui/app-shell'
import { renderDiagnosticMessage, renderDiagnosticTitle } from '@/shared/rspdl/diagnostic-messages'
import type { RspdlDiagnostic } from '@dahaze/rspdl-editor'
import type { PlanningDraft, PlanningItem, PlanningWorkspaceModel } from './planning-types'
import { PlanningWorkspace } from './planning-workspace'
import { HandoffInspector } from './handoff-inspector'
import { MetadataEditor } from './metadata-editor'

export function PlanningWorkspaceScreen({ projectId }: { projectId: string }) {
  return <AppShell fullBleed lockToViewport breadcrumb={<Crumb>기획 워크스페이스</Crumb>}><RequireSession><PlanningLoader projectId={projectId} /></RequireSession></AppShell>
}

function PlanningLoader({ projectId }: { projectId: string }) {
  const state = useGetPlanningState<PlanningStateResponse>(projectId)
  const drafts = useListPlanningDrafts<PlanningDraftSummaryResponse[]>(projectId, { limit: 50, offset: 0 })
  const snapshots = useListProjectSnapshots<ProjectSnapshotSummaryResponse[]>(projectId, { limit: 50, offset: 0 })
  const metadataHistory = useListPlanningMetadataHistory<PlanningMetadataRevisionResponse[]>(projectId)
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null)
  const activeDraftId = selectedDraftId ?? drafts.data?.[0]?.id ?? null
  const selectedDraft = useGetPlanningDraft<PlanningDraftResponse>(activeDraftId ?? '', { query: { enabled: activeDraftId !== null } })
  const [selectedSnapshotVersion, setSelectedSnapshotVersion] = useState<number | null>(null)
  const [compareSnapshotVersion, setCompareSnapshotVersion] = useState<number | null>(null)
  const selectedSnapshot = useGetProjectSnapshot<ProjectSnapshotResponse>(projectId, selectedSnapshotVersion ?? 0, { query: { enabled: selectedSnapshotVersion !== null } })
  const compareSnapshot = useGetProjectSnapshot<ProjectSnapshotResponse>(projectId, compareSnapshotVersion ?? 0, { query: { enabled: compareSnapshotVersion !== null } })
  const queryClient = useQueryClient()
  const apply = useApplyPlanningDraft()
  const restore = useRestoreProjectSnapshot()
  const appendMessage = useAppendPlanningMessage()
  const appendDecision = useAppendPlanningDecision()
  const patchMetadata = usePatchPlanningMetadata()
  const undoMetadata = useUndoPlanningMetadata()

  const model = useMemo(() => state.data === undefined ? null : toModel(state.data, drafts.data ?? [], selectedDraft.data, snapshots.data ?? [], activeDraftId), [state.data, drafts.data, selectedDraft.data, snapshots.data, activeDraftId])
  if (state.isPending || drafts.isPending || snapshots.isPending || metadataHistory.isPending) return <div className="grid min-h-0 flex-1 grid-cols-3 gap-px"><Skeleton /><Skeleton /><Skeleton /></div>
  if (state.error !== null || drafts.error !== null || snapshots.error !== null || metadataHistory.error !== null || model === null) return <ErrorState title="기획 워크스페이스를 불러오지 못했습니다" description={errorMessage(state.error ?? drafts.error ?? snapshots.error ?? metadataHistory.error)} />

  const refresh = () => queryClient.invalidateQueries()
  const metadataBusy = patchMetadata.isPending || undoMetadata.isPending
  const metadataRevision = Math.max(0, ...(metadataHistory.data ?? []).map((entry) => entry.revision))
  const metadataEditor = <MetadataEditor key={metadataRevision} metadata={state.data.metadata} revision={model.revision} history={metadataHistory.data ?? []} busy={metadataBusy} onSave={async (metadata, summary) => { try { await patchMetadata.mutateAsync({ projectId, data: { expected_revision: model.revision, environments: metadata.environments, sample_data: metadata.sample_data, summary } }); await refresh(); toast.success('환경과 샘플 데이터를 저장했습니다'); return true } catch (error) { toast.error('메타데이터를 저장하지 못했습니다', { description: errorMessage(error) }); return false } }} onUndo={(targetRevision) => undoMetadata.mutate({ projectId, data: { expected_revision: model.revision, target_revision: targetRevision } }, { onSuccess: async () => { await refresh(); toast.success('메타데이터 전체를 선택한 리비전으로 되돌렸습니다') }, onError: (error) => toast.error('되돌리지 못했습니다', { description: errorMessage(error) }) })} />
  return <PlanningWorkspace model={model} busy={apply.isPending || restore.isPending || appendMessage.isPending || appendDecision.isPending || metadataBusy} onSendMessage={async (content) => { try { await appendMessage.mutateAsync({ projectId, data: { role: 'user', content, expected_revision: model.revision } }); await refresh(); toast.success('답변을 저장했습니다', { description: 'AI 응답은 아직 생성하지 않습니다.' }); return true } catch (error) { toast.error('답변을 저장하지 못했습니다', { description: errorMessage(error) }); return false } }} onResolveDecision={async (id, action, reason) => { const item = model.unresolvedDecisions.find((decision) => decision.id === id); if (!item) return false; try { await appendDecision.mutateAsync({ projectId, data: { title: item.title, status: action === 'adopt' ? 'decided' : 'deferred', rationale: reason || null, expected_revision: model.revision } }); await refresh(); return true } catch (error) { toast.error('결정을 저장하지 못했습니다', { description: errorMessage(error) }); return false } }} onSelectDraft={setSelectedDraftId} onApplyDraft={(draftId) => apply.mutate({ draftId, data: { expected_project_revision: model.projectRevision, expected_source_hash: model.sourceHash } }, { onSuccess: async (result) => { await refresh(); toast[result.applied ? 'success' : 'error'](result.applied ? '변경안을 적용했습니다' : '변경안이 적용되지 않았습니다') }, onError: (error) => toast.error('변경안을 적용하지 못했습니다', { description: errorMessage(error) }) })} onInspectSnapshot={(version) => { setSelectedSnapshotVersion(version); if (compareSnapshotVersion === version) setCompareSnapshotVersion(null) }} onRestoreSnapshot={(snapshotVersion) => restore.mutate({ projectId, revision: snapshotVersion, data: { expected_planning_revision: model.revision, expected_project_revision: model.projectRevision, expected_source_hash: model.sourceHash } }, { onSuccess: async () => { await refresh(); toast.success('선택한 버전을 새 프로젝트 버전으로 복원했습니다') }, onError: (error) => toast.error('버전을 복원하지 못했습니다', { description: errorMessage(error) }) })} handoff={<>{metadataEditor}{selectedSnapshot.data ? <><label className="mx-4 mt-3 block text-xs">비교 버전 <select value={compareSnapshotVersion ?? ''} onChange={(event) => setCompareSnapshotVersion(event.target.value === '' ? null : Number(event.target.value))} className="ml-2 rounded border bg-surface px-2 py-1"><option value="">선택 안 함</option>{model.snapshots.filter((entry) => entry.revision !== selectedSnapshotVersion).map((entry) => <option key={entry.revision} value={entry.revision}>스냅샷 {entry.revision}</option>)}</select></label><HandoffInspector snapshot={selectedSnapshot.data} compare={compareSnapshot.data} /></> : null}</>} />
}

function toModel(state: PlanningStateResponse, drafts: PlanningDraftSummaryResponse[], selectedDraft: PlanningDraftResponse | undefined, snapshots: ProjectSnapshotSummaryResponse[], selectedDraftId: string | null): PlanningWorkspaceModel {
  const decisions = state.decisions.map(toItem)
  const selectedDiagnostics = selectedDraft === undefined ? [] : diagnostics(selectedDraft.result)
  const compileState = selectedDraft === undefined ? 'not-run' : isRecord(selectedDraft.result) && Array.isArray(selectedDraft.result.files) ? 'recognized' : 'unsupported-shape'
  return {
    revision: state.revision, projectRevision: state.project_revision, sourceHash: state.source_hash,
    messages: state.messages.map((raw, index) => ({ id: string(raw.id) ?? `message-${index}`, role: raw.role === 'assistant' ? 'assistant' : 'user', content: string(raw.content) ?? '', createdAt: string(raw.created_at) ?? '' })),
    acceptedDecisions: decisions.filter((_, index) => state.decisions[index]?.status === 'decided'),
    unresolvedDecisions: decisions.filter((_, index) => state.decisions[index]?.status !== 'decided'),
    questions: state.proposals.filter((raw) => raw.kind === 'question').map(toItem),
    unsupported: state.proposals.filter((raw) => raw.kind === 'unsupported').map(toItem),
    compiler: { state: compileState, rspdlVersion: selectedDraft?.rspdl_version, diagnostics: selectedDiagnostics },
    drafts: drafts.map((summary) => selectedDraft?.id === summary.id ? toDraft(selectedDraft) : ({ id: summary.id, summary: summary.summary ?? '변경안', baseRevision: summary.base_project_revision, status: summary.applied_revision === null ? 'draft' : 'applied', changes: [], diagnostics: [], analysis: [] })), selectedDraftId,
    snapshots: snapshots.map((entry) => ({ revision: entry.snapshot_version, createdAt: entry.created_at, changeKind: entry.change_kind, sourceHash: entry.source_hash })),
  }
}

function toDraft(raw: PlanningDraftResponse): PlanningDraft {
  const candidateByPath = new Map(raw.candidate_documents.filter(isRecord).map((entry) => [string(entry.path) ?? '', string(entry.text)]))
  return { id: raw.id, summary: typeof raw.summary === 'string' ? raw.summary : '변경안', baseRevision: raw.base_project_revision, status: raw.applied_revision === null ? 'draft' : 'applied', changes: raw.changes.filter(isRecord).map((change) => { const path = string(change.path) ?? '알 수 없는 문서'; const before = change.before_exists === true ? (string(change.before_text) ?? '') : change.before_exists === false ? null : undefined; return { path, before, after: candidateByPath.get(path) ?? (change.operation === 'delete' ? null : '후보 본문을 불러오지 못했습니다') } }), diagnostics: diagnostics(raw.result), analysis: [`rspdl ${raw.rspdl_version}`, `wire schema ${raw.wire_schema_version}`, `기준 원문 ${raw.base_source_hash.slice(0, 10)}`] }
}

function diagnostics(result: unknown): PlanningItem[] { if (!isRecord(result) || !Array.isArray(result.files)) return []; const items: PlanningItem[] = []; for (const file of result.files) { if (!isRecord(file) || !Array.isArray(file.diagnostics)) continue; const path = string(file.path); for (const diagnostic of file.diagnostics) if (isDiagnostic(diagnostic)) items.push({ id: `${path}:${items.length}`, title: renderDiagnosticTitle(diagnostic), detail: renderDiagnosticMessage(diagnostic), sourcePath: path ?? undefined }); } return items }
function toItem(raw: Record<string, unknown>, index = 0): PlanningItem { return { id: string(raw.id) ?? `item-${index}`, title: string(raw.title) ?? string(raw.question) ?? string(raw.content) ?? '제목 없음', detail: string(raw.rationale) ?? string(raw.detail) ?? string(raw.reason) ?? undefined, sourcePath: string(raw.source_path) ?? undefined } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function string(value: unknown): string | null { return typeof value === 'string' ? value : null }
function isDiagnostic(value: unknown): value is RspdlDiagnostic { return isRecord(value) && typeof value.rule_id === 'string' && typeof value.message_key === 'string' && isRecord(value.arguments) }
