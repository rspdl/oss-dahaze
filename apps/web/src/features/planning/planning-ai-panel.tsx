'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  useCancelPlanningAiJob,
  useGetPlanningState,
  useListPlanningAiJobs,
  useRetryPlanningAiJob,
  type PlanningAiJobResponse,
  type PlanningStateResponse,
} from '@dahaze/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Skeleton, cn, toast } from '@dahaze/ui'
import { useRouter } from 'next/navigation'

import { viewHref } from '../navigation/views'
import { errorMessage } from '../../shared/api/errors'
import { SparkleIcon, XIcon } from '../../shared/ui/icons'
import { PlanningInterview } from './planning-interview'
import { toAiJobs, toMessages } from './planning-model'
import { usePlanningUiStore } from './planning-ui-store'
import { activeJobsRefetchInterval, usePlanningAiJob } from './use-planning-ai-job'

/**
 * 프로젝트 화면 오른쪽에 붙는 AI 대화 패널.
 *
 * 대화를 메뉴 하나에 가두지 않는다. 화면 흐름을 보다가, 정책 표를 보다가 그 자리에서 물어볼
 * 수 있어야 대화로 작성하는 흐름이 끊기지 않는다. 그래서 `AppShell` 이 프로젝트 화면마다
 * 이 패널을 붙인다.
 *
 * 접어도 트리에서 떼지 않는다. 떼면 입력 중인 글이 사라지고, AI 작업이 끝났는지 묻는 폴링도
 * 멈춘다. 작업이 끝나면 여기서 프로젝트 조회를 전부 무효화한다 — 어느 화면이 열려 있든
 * 새 초안과 제안이 그 화면에 반영되게 하기 위해서다.
 */
export function PlanningAiPanel({ projectId }: { projectId: string }) {
  const panelOpen = usePlanningUiStore((store) => store.panelOpen)
  const mobileOpen = usePlanningUiStore((store) => store.mobileOpen)
  const setPanelOpen = usePlanningUiStore((store) => store.setPanelOpen)
  const setMobileOpen = usePlanningUiStore((store) => store.setMobileOpen)
  const enter = usePlanningUiStore((store) => store.enter)

  useEffect(() => enter(projectId), [enter, projectId])

  return <aside
    aria-label="AI 대화"
    className={cn(
      'flex-col border-l bg-surface',
      /* 좁은 화면에서는 본문을 덮는 서랍이다. 처음부터 열어 두면 본문이 보이지 않는다. */
      mobileOpen ? 'fixed inset-y-0 right-0 z-40 flex w-full max-w-md' : 'hidden',
      panelOpen ? 'md:sticky md:top-0 md:flex md:h-dvh md:w-[22rem] lg:w-[26rem]' : 'md:hidden',
    )}
  >
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SparkleIcon className="size-4 text-text-subtle" />
      <h2 className="text-sm font-semibold">AI 대화</h2>
      <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="AI 대화 닫기" onClick={() => { setPanelOpen(false); setMobileOpen(false) }}><XIcon /></Button>
    </header>
    <PanelBody projectId={projectId} />
  </aside>
}

function PanelBody({ projectId }: { projectId: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const subject = usePlanningUiStore((store) => store.subject)
  const clearSubject = usePlanningUiStore((store) => store.clearSubject)
  const selectDraft = usePlanningUiStore((store) => store.selectDraft)
  const storeProjectId = usePlanningUiStore((store) => store.projectId)
  const storeDraftId = usePlanningUiStore((store) => store.selectedDraftId)
  const selectedDraftId = storeProjectId === projectId ? storeDraftId : null

  const state = useGetPlanningState<PlanningStateResponse>(projectId)
  const aiJobs = useListPlanningAiJobs<PlanningAiJobResponse[]>(projectId, { limit: 50 }, { query: { refetchInterval: activeJobsRefetchInterval } })
  const cancelAiJob = useCancelPlanningAiJob()
  const retryAiJob = useRetryPlanningAiJob()
  const aiJob = usePlanningAiJob(projectId)

  const messages = useMemo(() => state.data === undefined ? [] : toMessages(state.data), [state.data])
  const jobs = useMemo(() => toAiJobs(aiJobs.data ?? []), [aiJobs.data])

  /*
    끝난 작업을 처음 볼 때만 새로 읽는다. 폴링마다 무효화하면 끝난 작업 하나가 1초마다 모든
    조회를 다시 부른다. 처음 받은 목록의 끝난 작업은 "이미 본 것" 으로 친다 — 들어오자마자
    전부 다시 읽을 이유가 없다.
  */
  const observed = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (aiJobs.data === undefined) return
    const terminal = aiJobs.data.filter((job) => job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled').map((job) => job.id)
    if (observed.current === null) { observed.current = new Set(terminal); return }
    const fresh = terminal.filter((id) => !observed.current!.has(id))
    for (const id of fresh) observed.current.add(id)
    if (fresh.length > 0) void queryClient.invalidateQueries()
  }, [aiJobs.data, queryClient])

  if (state.isPending || aiJobs.isPending) return <div className="space-y-3 p-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-3/4" /></div>
  if (state.error !== null || aiJobs.error !== null) return <p className="p-4 text-sm text-text-muted">대화를 불러오지 못했습니다. {errorMessage(state.error ?? aiJobs.error)}</p>

  const refresh = () => queryClient.invalidateQueries()
  const base = { planningRevision: state.data.revision, projectRevision: state.data.project_revision, sourceHash: state.data.source_hash, sourceDraftId: selectedDraftId ?? undefined }

  return <PlanningInterview
    messages={messages}
    jobs={jobs}
    subject={subject}
    busy={aiJob.isPending || cancelAiJob.isPending || retryAiJob.isPending}
    onClearSubject={clearSubject}
    onSendMessage={async (content, context) => { try { await aiJob.create('interview', content, base, context); await refresh(); return true } catch (error) { toast.error('AI 인터뷰를 시작하지 못했습니다', { description: errorMessage(error) }); return false } }}
    onCancelJob={(jobId) => cancelAiJob.mutate({ projectId, jobId }, { onSuccess: refresh, onError: (error) => toast.error('AI 작업을 취소하지 못했습니다', { description: errorMessage(error) }) })}
    onRetryJob={(jobId) => retryAiJob.mutate({ projectId, jobId }, { onSuccess: refresh, onError: (error) => toast.error('AI 작업을 다시 시작하지 못했습니다', { description: errorMessage(error) }) })}
    onOpenDraft={(draftId) => { selectDraft(draftId); router.push(viewHref(projectId, 'planning')) }}
  />
}
