'use client'

import { useCallback, useRef } from 'react'
import { useCreatePlanningAiJob } from '@dahaze/api-client'

import { buildPlanningAiJobRequest } from './planning-ai-request'
import type { PlanningSubject } from './planning-types'

export interface PlanningJobBase {
  planningRevision: number
  projectRevision: number
  sourceHash: string
  /** 검토 화면에서 고른 초안. 인터뷰와 재작성 요청이 이 초안을 기준으로 삼는다. */
  sourceDraftId?: string
}

/**
 * AI 작업을 만든다. AI 패널(인터뷰)과 검토 화면(초안 만들기)이 함께 쓴다.
 *
 * 같은 요청을 다시 보내면 같은 `requestId` 를 쓴다. 응답을 받기 전에 연결이 끊겨 재시도해도
 * 서버가 같은 작업을 돌려주므로 AI 작업이 두 번 돌지 않는다. 요청 내용이 하나라도 다르면
 * 새 id 를 만든다.
 */
export function usePlanningAiJob(projectId: string) {
  const createAiJob = useCreatePlanningAiJob()
  const pendingRequest = useRef<{ key: string; requestId: string } | null>(null)
  const { mutateAsync } = createAiJob

  const create = useCallback(async (kind: 'interview' | 'generate', instruction: string, base: PlanningJobBase, subject?: PlanningSubject) => {
    const key = JSON.stringify({ kind, instruction, planningRevision: base.planningRevision, projectRevision: base.projectRevision, sourceHash: base.sourceHash, sourceDraft: base.sourceDraftId, subject })
    if (pendingRequest.current?.key !== key) pendingRequest.current = { key, requestId: crypto.randomUUID() }
    const result = await mutateAsync({ projectId, data: buildPlanningAiJobRequest({ requestId: pendingRequest.current.requestId, kind, instruction, planningRevision: base.planningRevision, projectRevision: base.projectRevision, sourceHash: base.sourceHash, sourceDraftId: base.sourceDraftId, subject }) })
    pendingRequest.current = null
    return result
  }, [mutateAsync, projectId])

  return { create, isPending: createAiJob.isPending }
}

/** 대기 중이거나 도는 작업이 있으면 목록을 1초마다 다시 묻는다. 끝나면 멈춘다. */
export function activeJobsRefetchInterval(query: { state: { data: unknown } }): number | false {
  const data = query.state.data
  return Array.isArray(data) && data.some((job) => job.status === 'queued' || job.status === 'running') ? 1000 : false
}
