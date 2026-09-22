'use client'

import { useMemo } from 'react'
import {
  useCompileProject,
  useGetProject,
  type CompiledDocumentRef,
  type ProjectCompileResponse,
  type ProjectResponse,
} from '@dahaze/api-client'

import { collectScreenMockups, type CollectedMockups } from '@/features/mockup/screen-layouts'
import { collectBoard, type CollectedBoard } from './board-ir'

/**
 * 두 보드가 공유하는 자료.
 *
 * 둘 다 프로젝트 전체 컴파일 하나를 읽는다. 같은 응답에서 구조(`collectBoard`)와
 * 화면 안(`collectScreenMockups`)을 각각 좁히고, `path` 로 문서를 잇는다 — IR 에 문서 id 가
 * 없는 것이 ADR-0003 의 결정이고 `path` 가 그 유일한 고리다.
 */
export interface BoardData {
  project: ReturnType<typeof useGetProject<ProjectResponse>>
  compilation: ReturnType<typeof useCompileProject<ProjectCompileResponse>>
  board: CollectedBoard
  mockups: CollectedMockups
  documentsByPath: Map<string, CompiledDocumentRef>
}

export function useBoardData(projectId: string): BoardData {
  const project = useGetProject<ProjectResponse>(projectId, {})
  const compilation = useCompileProject<ProjectCompileResponse>(projectId, {
    query: { staleTime: 10_000 },
  })

  const board = useMemo(() => collectBoard(compilation.data), [compilation.data])
  const mockups = useMemo(() => collectScreenMockups(compilation.data), [compilation.data])
  const documentsByPath = useMemo(
    () =>
      new Map(
        (compilation.data?.documents ?? []).map((document) => [document.path, document]),
      ),
    [compilation.data?.documents],
  )

  return { project, compilation, board, mockups, documentsByPath }
}
