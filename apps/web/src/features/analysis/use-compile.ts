'use client'

import {
  compileWorkspace,
  deterministicAnalysisOptions,
  type AnalysisResponse,
} from '@dahaze/api-client'
import type { RspdlDiagnostic } from '@dahaze/rspdl-editor'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { payload } from '@/shared/api/payload'
import { useDebouncedValue } from '@/shared/use-debounced-value'
import { collectDiagnostics } from '@/shared/rspdl/analysis'

/**
 * 편집 중인 텍스트를 자동으로 컴파일한다.
 *
 * 세 가지가 이 훅의 전부다.
 *
 * 1. **디바운스.** 서버에서 실제 solver 가 돈다. 타자마다 부르면 서버도 사용자도 손해다.
 * 2. **취소.** 디바운스가 다시 걸리면 이전 요청은 이미 쓸모없다. 조회를 취소해 `AbortSignal`
 *    로 끊는다 — 화면을 떠날 때도 마찬가지다.
 * 3. **진단과 그 진단이 가리키는 텍스트를 함께 준다.** 진단의 `span` 은 특정 텍스트에 대한
 *    바이트 오프셋이라, 다른 텍스트에 얹으면 행·열이 조용히 어긋난다 (ADR-0006). 그래서
 *    결과를 텍스트와 한 쌍으로 들고 다니고, 편집 중이라 짝이 맞지 않으면 화면이 그렇게 말한다.
 *
 * 컴파일은 `POST` 라 생성된 훅은 mutation 이지만 여기서는 **조회로 쓴다.** 같은 소스의 컴파일
 * 결과는 결정적이고 (ADR-0003) 서버도 캐시한다 — `deterministicAnalysisOptions` 가 그 전제로
 * 만들어져 있다. mutation 으로 쓰면 취소도 캐시 재사용도 잃는다. 요청 자체는 생성된
 * `compileWorkspace` 가 그대로 보낸다.
 */

/** 타자가 멈춘 뒤 이만큼 조용해야 컴파일한다. */
const COMPILE_DEBOUNCE_MS = 600

export function compileQueryKey(path: string, text: string) {
  /*
   * 텍스트가 키에 들어간다. 같은 텍스트로 돌아오면 (되돌리기 등) 캐시가 그대로 답한다 —
   * 결정적인 결과에 대해서만 할 수 있는 최적화다.
   */
  return ['analysis', 'compile', path, text] as const
}

export interface CompileSnapshot {
  /** 이 진단들을 만든 텍스트. 행·열 계산은 반드시 이것으로 한다. */
  text: string
  analysis: AnalysisResponse
  diagnostics: RspdlDiagnostic[]
  /** 컴파일 결과 모양을 알아봤는지. `false` 면 "진단 없음" 이 아니라 "모른다". */
  recognized: boolean
}

export interface CompileState {
  /** 마지막으로 성공한 컴파일. 아직 한 번도 못 했으면 `null`. */
  snapshot: CompileSnapshot | null
  /** 스냅샷이 지금 편집 중인 텍스트의 것인지. `false` 면 위치가 낡았다. */
  isCurrent: boolean
  isCompiling: boolean
  error: unknown
  recompile: () => void
}

export function useCompile({
  path,
  text,
  enabled = true,
}: {
  path: string
  text: string
  enabled?: boolean
}): CompileState {
  const debounced = useDebouncedValue(text, COMPILE_DEBOUNCE_MS)
  const queryClient = useQueryClient()
  const shouldCompile = enabled && debounced.trim() !== ''

  const query = useQuery({
    queryKey: compileQueryKey(path, debounced),
    queryFn: ({ signal }) =>
      compileWorkspace({ sources: [{ path, text: debounced }] }, { signal }),
    select: (response) => payload(response),
    enabled: shouldCompile,
    ...deterministicAnalysisOptions,
  })

  /*
   * 디바운스가 다시 걸려 키가 바뀌면 이전 요청은 결과가 나와도 버려진다. cleanup 에서
   * 그 키를 취소해 `AbortSignal` 을 끊는다 — 화면을 떠날 때도 같은 경로로 정리된다.
   * (`cancelQueries` 는 이미 끝난 조회에는 아무 일도 하지 않는다.)
   */
  useEffect(() => {
    return () => {
      void queryClient.cancelQueries({
        queryKey: compileQueryKey(path, debounced),
        exact: true,
      })
    }
  }, [queryClient, path, debounced])

  /*
   * 진단과 그 진단이 가리키는 텍스트를 한 쌍으로 붙잡아 둔다.
   *
   * TanStack Query 는 키가 바뀌는 순간 이전 데이터를 내려놓으므로, 재컴파일 중에는 패널이
   * 통째로 비어 깜빡인다. 그렇다고 이전 진단을 그냥 남기면 **어느 텍스트 기준의 행·열인지**
   * 알 수 없게 된다. 그래서 남기되 텍스트를 함께 남긴다. 서버 상태를 복제하는 것이 아니라,
   * 같이 보여야만 의미가 있는 두 값을 한 번에 붙잡는 것이다 (그래서 zustand 가 아니다).
   */
  const [snapshot, setSnapshot] = useState<CompileSnapshot | null>(null)

  useEffect(() => {
    const analysis = query.data
    if (analysis === undefined) return
    const { diagnostics, recognized } = collectDiagnostics(analysis)
    setSnapshot({ text: debounced, analysis, diagnostics, recognized })
  }, [query.data, debounced])

  const { refetch } = query
  const recompile = useCallback(() => {
    void refetch()
  }, [refetch])

  return {
    snapshot,
    isCurrent: snapshot !== null && snapshot.text === text,
    isCompiling: shouldCompile && (query.isFetching || debounced !== text),
    error: query.error,
    recompile,
  }
}
