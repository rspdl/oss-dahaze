'use client'

import {
  compileWorkspace,
  deterministicAnalysisOptions,
  type AnalysisResponse,
} from '@dahaze/api-client'
import type { RspdlDiagnostic } from '@dahaze/rspdl-editor'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'

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
 *    UTF-8 바이트 오프셋이라, 다른 텍스트에 얹으면 행·열이 조용히 어긋난다 (ADR-0006).
 *    그래서 컴파일에 넣은 텍스트를 **캐시 값 안에** 함께 담는다. 두 값이 절대 갈라지지 않고,
 *    재컴파일 중에 이전 결과를 계속 보여줘도 그것이 어느 텍스트의 진단인지 늘 알 수 있다.
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

/** 캐시에 담기는 값. 텍스트와 결과가 한 몸이다. */
interface CompiledPair {
  text: string
  analysis: AnalysisResponse
}

export interface CompileSnapshot extends CompiledPair {
  diagnostics: RspdlDiagnostic[]
  /** 컴파일 결과 모양을 알아봤는지. `false` 면 "진단 없음" 이 아니라 "모른다". */
  recognized: boolean
}

/*
 * `select` 를 모듈 바깥에 둔다. 렌더마다 새 함수를 넘기면 TanStack Query 가 결과를 재사용하지
 * 못하고 진단 배열이 매번 새로 만들어져, 편집기가 불필요하게 진단을 다시 그린다.
 */
function toSnapshot(pair: CompiledPair): CompileSnapshot {
  const { diagnostics, recognized } = collectDiagnostics(pair.analysis)
  return { ...pair, diagnostics, recognized }
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
    queryFn: async ({ signal }): Promise<CompiledPair> => {
      const response = await compileWorkspace(
        { sources: [{ path, text: debounced }] },
        { signal },
      )
      return { text: debounced, analysis: response }
    },
    select: toSnapshot,
    /*
     * 키가 바뀌는 순간 패널이 비어 깜빡이는 것을 막는다. 이전 결과를 그대로 보여주되,
     * 그 값이 자기 텍스트를 들고 있으므로 행·열은 여전히 정확하다.
     */
    placeholderData: (previous) => previous,
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

  const { refetch } = query
  const recompile = useCallback(() => {
    void refetch()
  }, [refetch])

  const snapshot = query.data ?? null

  return {
    snapshot,
    isCurrent: snapshot !== null && snapshot.text === text,
    isCompiling: shouldCompile && (query.isFetching || debounced !== text),
    error: query.error,
    recompile,
  }
}
