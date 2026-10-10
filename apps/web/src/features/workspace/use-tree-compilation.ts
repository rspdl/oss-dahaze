'use client'

import { useMemo, useState } from 'react'
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import {
  compileWorkspace,
  deterministicAnalysisOptions,
  getReadTreeFileQueryOptions,
  useListTree,
  type AnalysisResponse,
  type TreeEntryResponse,
  type TreeFileResponse,
} from '@dahaze/api-client'

import { isRspdlPath } from '@/features/wireframe/wireframe-file'

export interface TreeCompilation {
  tree: ReturnType<typeof useListTree<TreeEntryResponse[]>>
  /** 작업 트리의 모든 파일 경로. 문서와 배치 파일이 섞여 있다. */
  paths: string[]
  /** 모든 파일을 읽었으면 그 내용. 하나라도 덜 읽었으면 `null`. */
  files: TreeFileResponse[] | null
  readError: unknown
  compile: ReturnType<typeof useCompile>
}

/**
 * 작업 트리를 읽어 `.rspdl` 문서만 `compile_workspace` 로 컴파일한다. IA 뷰와 와이어프레임 뷰가 같이 쓴다.
 *
 * `compile_tree` 와 `search` 는 IR 을 주지 않아서 파일을 읽어 그대로 넘긴다
 * (docs/plans/agent-workspace.md "화면"). 읽기는 에디터와 같은 쿼리 키라 이미 연 파일은 다시 받지
 * 않고, 이벤트 스트림의 무효화도 그대로 받는다. 배치 파일(`.wireframe.json`)도 함께 읽지만
 * 컴파일러에는 넘기지 않는다.
 */
export function useTreeCompilation(projectId: string): TreeCompilation {
  const tree = useListTree<TreeEntryResponse[]>(projectId)
  const paths = useMemo(
    () => (tree.data ?? []).filter((entry) => entry.kind === 'file').map((entry) => entry.path),
    [tree.data],
  )

  const reads = useQueries({
    queries: paths.map((path) => getReadTreeFileQueryOptions(projectId, { path })),
  })
  const readError = reads.find((read) => read.isError)?.error ?? null
  const allRead = reads.every((read) => read.isSuccess)
  /* `useQueries` 는 렌더마다 새 배열을 준다. 내용이 같으면 같은 배열을 쓰도록 수정 시각으로 묶는다. */
  const stampKey = allRead ? reads.map((read) => `${read.data.path}@${read.data.updated_at}`).join('|') : null
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stampKey 가 reads 의 내용을 대표한다
  const complete = useMemo(() => (allRead ? reads.map((read) => read.data!) : null), [stampKey])
  /*
    파일이 하나 늘면(새 문서, 처음 저장한 배치 파일) 그 파일을 읽는 동안 전부가 "덜 읽음"이 된다.
    그때 `null` 을 주면 뷰가 로딩으로 바뀌며 편집 중인 화면이 닫힌다. 마지막으로 다 읽은 내용을 준다.
  */
  const [lastComplete, setLastComplete] = useState<TreeFileResponse[] | null>(null)
  if (complete !== null && complete !== lastComplete) setLastComplete(complete)
  const files = complete ?? lastComplete

  const compile = useCompile(projectId, files)
  return { tree, paths, files, readError, compile }
}

function useCompile(projectId: string, files: TreeFileResponse[] | null) {
  const documents = useMemo(() => (files ?? []).filter((file) => isRspdlPath(file.path)), [files])
  /* 원문 대신 경로와 수정 시각으로 키를 만든다. 원문을 키에 넣으면 캐시 키가 문서 전체만큼 커진다. */
  const stamp = documents.map((file) => `${file.path}@${file.updated_at}`)
  /*
    컴파일한 원문을 응답과 함께 캐시에 둔다. span 을 줄 번호로 바꿀 때는 **컴파일한 그 원문**이
    필요하다 — 이전 결과를 보여주는 동안(`keepPreviousData`) 새 원문으로 바꾸면 줄이 어긋난다.
  */
  return useQuery({
    queryKey: ['workspace-ia-compile', projectId, stamp],
    queryFn: async ({ signal }): Promise<{ response: AnalysisResponse; texts: Map<string, string> }> => {
      const sources = documents.map((file) => ({ path: file.path, text: file.text }))
      const response = await compileWorkspace({ sources }, { signal })
      return {
        response,
        texts: new Map(sources.map((source) => [source.path, source.text] as const)),
      }
    },
    enabled: documents.length > 0,
    placeholderData: keepPreviousData,
    ...deterministicAnalysisOptions,
  })
}
