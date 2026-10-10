'use client'

import { useEffect } from 'react'
import {
  getListAgentItemsQueryKey,
  getListAgentSessionsQueryKey,
  getListAgentTurnsQueryKey,
  getListCommitsQueryKey,
  getListTreeChangesQueryKey,
  getListTreeQueryKey,
  getReadTreeFileQueryKey,
  getCompileTreeQueryKey,
} from '@dahaze/api-client'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import { absoluteApiUrl } from '@/shared/api/base-url'
import { useWorkspaceStore } from './workspace-store'

/**
 * 프로젝트 이벤트 스트림(SSE)을 받아 조회를 다시 읽게 한다.
 *
 * 스트림은 생성 클라이언트에 없다(OpenAPI 밖). 그래서 `EventSource` 로 직접 붙는다. 이벤트의
 * payload 에는 바뀐 내용이 없고 무엇이 바뀌었는지만 있다 — 내용은 해당 조회가 다시 읽는다.
 * 그래서 이 훅은 서버 상태를 들지 않고, Query 캐시를 무효화만 한다 (ADR-0006).
 *
 * 끊기면 브라우저가 `retry` 간격(서버가 3초로 준다)으로 다시 붙고, `Last-Event-ID` 로 놓친
 * 이벤트부터 받는다.
 *
 * 프레임 모양: `id=seq`, `event=type`, `data={seq, type, payload, created_at}`.
 */

interface EventFrame {
  seq: number
  type: string
  payload: Record<string, unknown>
}

const EVENT_TYPES = [
  'tree.changed',
  'locks.released',
  'commit.created',
  'agent.item',
  'agent.text_delta',
  'agent.turn',
] as const

function parse(data: string): EventFrame | null {
  try {
    const value: unknown = JSON.parse(data)
    if (typeof value !== 'object' || value === null) return null
    const frame = value as Partial<EventFrame>
    if (typeof frame.type !== 'string' || typeof frame.payload !== 'object' || frame.payload === null) {
      return null
    }
    return frame as EventFrame
  } catch {
    return null
  }
}

function stringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' ? value : null
}

function invalidateTree(queryClient: QueryClient, projectId: string, paths: readonly string[]) {
  void queryClient.invalidateQueries({ queryKey: getListTreeQueryKey(projectId) })
  void queryClient.invalidateQueries({ queryKey: getListTreeChangesQueryKey(projectId) })
  void queryClient.invalidateQueries({ queryKey: getCompileTreeQueryKey(projectId) })
  for (const path of paths) {
    void queryClient.invalidateQueries({ queryKey: getReadTreeFileQueryKey(projectId, { path }) })
  }
}

export function handleProjectEvent(
  queryClient: QueryClient,
  projectId: string,
  frame: EventFrame,
): void {
  const { payload } = frame
  const store = useWorkspaceStore.getState()

  switch (frame.type) {
    case 'tree.changed': {
      const paths = Array.isArray(payload.paths)
        ? payload.paths.filter((path): path is string => typeof path === 'string')
        : []
      /*
        AI(holder 가 있다)가 쓴 파일의 저장하지 않은 입력은 버린다. 잠긴 동안 에디터는 읽기
        전용이고, AI 가 쓴 뒤의 원문이 진실이다 (docs/plans/agent-workspace.md "잠금").
      */
      if (payload.holder !== null && payload.holder !== undefined) {
        for (const path of paths) store.dropDraft(path)
      }
      invalidateTree(queryClient, projectId, paths)
      return
    }
    case 'locks.released':
      void queryClient.invalidateQueries({ queryKey: getListTreeQueryKey(projectId) })
      return
    case 'commit.created':
      void queryClient.invalidateQueries({ queryKey: getListCommitsQueryKey(projectId) })
      void queryClient.invalidateQueries({ queryKey: getListTreeChangesQueryKey(projectId) })
      void queryClient.invalidateQueries({ queryKey: getListTreeQueryKey(projectId) })
      return
    case 'agent.item': {
      const sessionId = stringField(payload, 'session_id')
      const turnId = stringField(payload, 'turn_id')
      if (sessionId !== null) {
        void queryClient.invalidateQueries({ queryKey: getListAgentItemsQueryKey(sessionId) })
      }
      void queryClient.invalidateQueries({ queryKey: getListAgentSessionsQueryKey(projectId) })
      // 최종 답변이 기록되면 흘려보내던 조각은 그 항목과 겹친다.
      if (turnId !== null && payload.kind === 'assistant_message') store.clearStreaming(turnId)
      return
    }
    case 'agent.text_delta': {
      const turnId = stringField(payload, 'turn_id')
      const delta = stringField(payload, 'delta')
      if (turnId !== null && delta !== null) store.appendDelta(turnId, delta)
      return
    }
    case 'agent.turn': {
      const sessionId = stringField(payload, 'session_id')
      const turnId = stringField(payload, 'turn_id')
      const status = stringField(payload, 'status')
      if (sessionId !== null) {
        void queryClient.invalidateQueries({ queryKey: getListAgentTurnsQueryKey(sessionId) })
        void queryClient.invalidateQueries({ queryKey: getListAgentItemsQueryKey(sessionId) })
      }
      if (turnId !== null && status !== null && status !== 'queued' && status !== 'running') {
        store.clearStreaming(turnId)
      }
      // 턴이 끝나면 잠금이 풀린다. 트리의 자물쇠 표시를 바로 지운다.
      void queryClient.invalidateQueries({ queryKey: getListTreeQueryKey(projectId) })
      return
    }
  }
}

export function useProjectEvents(projectId: string): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const source = new EventSource(absoluteApiUrl(`/api/projects/${projectId}/events/stream`), {
      withCredentials: true,
    })

    const listener = (event: MessageEvent<string>) => {
      const frame = parse(event.data)
      if (frame !== null) handleProjectEvent(queryClient, projectId, frame)
    }
    for (const type of EVENT_TYPES) source.addEventListener(type, listener)

    return () => {
      for (const type of EVENT_TYPES) source.removeEventListener(type, listener)
      source.close()
    }
  }, [projectId, queryClient])
}
