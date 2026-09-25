'use client'

import { useEffect, useMemo } from 'react'
import {
  useApplyPlanningDraft,
  useCompileProject,
  useResolvePlanningDecision,
  useResolvePlanningProposal,
  useGetPlanningDraft,
  useGetPlanningState,
  useListPlanningAiJobs,
  useListPlanningDrafts,
  type PlanningDraftResponse,
  type PlanningDraftSummaryResponse,
  type PlanningAiJobResponse,
  type PlanningStateResponse,
  type ProjectCompileResponse,
} from '@dahaze/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { ErrorState, Skeleton, toast } from '@dahaze/ui'
import { useRouter } from 'next/navigation'

import { RequireSession } from '../auth/require-session'
import { errorMessage } from '../../shared/api/errors'
import { AppShell, Crumb } from '../../shared/ui/app-shell'
import type { PlanningSubject } from './planning-types'
import { acceptedCompilerDocumentHref, queryResult, toModel } from './planning-model'
import { PlanningReview } from './planning-review'
import { DraftResultInspector } from './draft-result-inspector'
import { usePlanningUiStore } from './planning-ui-store'
import { activeJobsRefetchInterval, usePlanningAiJob } from './use-planning-ai-job'

/**
 * 검토 화면. 프로젝트의 첫 화면이다.
 *
 * 주소로 맥락(`subject*`)이나 초안(`draft`)이 오면 받아서 AI 패널과 선택 상태에 넘긴다. 예전
 * 링크가 여기로 맥락을 실어 보냈고, 그 링크가 계속 동작해야 한다.
 */
export function PlanningReviewScreen({ projectId, initialSubject, initialDraftId }: { projectId: string; initialSubject?: PlanningSubject; initialDraftId?: string }) {
  return <AppShell breadcrumb={<Crumb>검토</Crumb>}><RequireSession><PlanningReviewLoader projectId={projectId} initialSubject={initialSubject} initialDraftId={initialDraftId} /></RequireSession></AppShell>
}

function PlanningReviewLoader({ projectId, initialSubject, initialDraftId }: { projectId: string; initialSubject?: PlanningSubject; initialDraftId?: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const enter = usePlanningUiStore((store) => store.enter)
  const askAbout = usePlanningUiStore((store) => store.askAbout)
  const selectDraft = usePlanningUiStore((store) => store.selectDraft)
  const storeProjectId = usePlanningUiStore((store) => store.projectId)
  const storeDraftId = usePlanningUiStore((store) => store.selectedDraftId)
  // 다른 프로젝트에서 고른 초안이 남아 있으면 이 프로젝트의 초안으로 읽지 않는다.
  const selectedDraftId = storeProjectId === projectId ? storeDraftId : null

  useEffect(() => {
    enter(projectId)
    if (initialDraftId !== undefined) selectDraft(initialDraftId)
    if (initialSubject !== undefined) askAbout(initialSubject)
  }, [askAbout, enter, initialDraftId, initialSubject, projectId, selectDraft])

  const state = useGetPlanningState<PlanningStateResponse>(projectId)
  const compilation = useCompileProject<ProjectCompileResponse>(projectId)
  const aiJobs = useListPlanningAiJobs<PlanningAiJobResponse[]>(projectId, { limit: 50 }, { query: { refetchInterval: activeJobsRefetchInterval } })
  const drafts = useListPlanningDrafts<PlanningDraftSummaryResponse[]>(projectId, { limit: 50, offset: 0 })
  const selectedDraft = useGetPlanningDraft<PlanningDraftResponse>(selectedDraftId ?? '', { query: { enabled: selectedDraftId !== null } })
  const apply = useApplyPlanningDraft()
  const resolveDecision = useResolvePlanningDecision()
  const resolveProposal = useResolvePlanningProposal()
  const aiJob = usePlanningAiJob(projectId)

  const model = useMemo(() => state.data === undefined ? null : toModel(
    state.data,
    drafts.data ?? [],
    [],
    selectedDraftId,
    {
      current: queryResult(compilation.data, compilation.isFetching, compilation.error),
      selectedDraft: queryResult(selectedDraft.data, selectedDraft.isFetching, selectedDraft.error),
    },
    aiJobs.data ?? [],
  ), [state.data, drafts.data, selectedDraftId, compilation.data, compilation.isFetching, compilation.error, selectedDraft.data, selectedDraft.isFetching, selectedDraft.error, aiJobs.data])
  if (state.isPending || drafts.isPending || aiJobs.isPending) return <div className="flex max-w-3xl flex-col gap-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-4 w-72" /><Skeleton className="mt-6 h-64 w-full" /></div>
  if (state.error !== null || drafts.error !== null || aiJobs.error !== null || model === null) return <ErrorState title="검토 화면을 불러오지 못했습니다" description={errorMessage(state.error ?? drafts.error ?? aiJobs.error)} />

  const refresh = () => queryClient.invalidateQueries()
  const canOpenAcceptedSource = model.compiler.source.kind === 'current' && model.compiler.state === 'recognized'
  const hasActiveJob = model.jobs.some((job) => job.status === 'queued' || job.status === 'running')
  const base = { planningRevision: model.revision, projectRevision: model.projectRevision, sourceHash: model.sourceHash, sourceDraftId: selectedDraftId ?? undefined }

  return <PlanningReview
    model={model}
    busy={apply.isPending || resolveDecision.isPending || resolveProposal.isPending || aiJob.isPending}
    hasActiveJob={hasActiveJob}
    onGenerateDraft={() => { void aiJob.create('generate', selectedDraftId === null ? '확정한 목적과 정책, 대화를 바탕으로 컴파일 가능한 프로젝트 명세와 정보구조 초안을 작성해 주세요.' : '선택한 초안의 컴파일러 진단과 대화를 반영해 새 컴파일 후보를 작성해 주세요.', base).then(refresh).then(() => toast.success('명세·IA 초안 작성을 시작했습니다', { description: '진행 상황은 AI 대화 패널에서 볼 수 있습니다.' })).catch((error) => toast.error('초안 작성을 시작하지 못했습니다', { description: errorMessage(error) })) }}
    onAskAi={askAbout}
    onResolveProposal={async (proposalId, action, reason) => { try { await resolveProposal.mutateAsync({ projectId, proposalId, data: { expected_revision: model.revision, status: action === 'adopt' ? 'adopted' : 'deferred', rationale: reason || null } }); await refresh(); toast.success(action === 'adopt' ? 'AI 제안을 정책으로 채택했습니다' : 'AI 제안을 보류했습니다'); return true } catch (error) { toast.error('AI 제안 결정을 저장하지 못했습니다', { description: errorMessage(error) }); return false } }}
    onResolveDecision={async (id, action, reason) => { const item = model.unresolvedDecisions.find((decision) => decision.id === id); if (!item) return false; try { await resolveDecision.mutateAsync({ projectId, decisionId: id, data: { status: action === 'adopt' ? 'decided' : 'deferred', rationale: reason || null, expected_revision: model.revision } }); await refresh(); return true } catch (error) { toast.error('결정을 저장하지 못했습니다', { description: errorMessage(error) }); return false } }}
    onSelectDraft={selectDraft}
    onApplyDraft={(draftId) => apply.mutate({ draftId, data: { expected_project_revision: model.projectRevision, expected_source_hash: model.sourceHash } }, { onSuccess: async (result) => { if (result.applied) selectDraft(null); await refresh(); toast[result.applied ? 'success' : 'error'](result.applied ? '변경안을 적용했습니다' : '변경안이 적용되지 않았습니다') }, onError: (error) => toast.error('변경안을 적용하지 못했습니다', { description: errorMessage(error) }) })}
    onOpenSource={canOpenAcceptedSource ? (path) => { const href = acceptedCompilerDocumentHref(projectId, model.compiler, path); if (href !== null) router.push(href) } : undefined}
    draftArtifacts={selectedDraft.data === undefined ? null : <DraftResultInspector draft={selectedDraft.data} planningState={state.data} />}
  />
}
