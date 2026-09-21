'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button, EmptyState, ErrorState, Skeleton } from '@dahaze/ui'

import { DEFAULT_PROJECT_VIEW, viewHref } from '@/features/navigation/views'
import { errorMessage } from '@/shared/api/errors'
import { TableIcon } from '@/shared/ui/icons'
import type { BoardData } from './use-board-data'

/**
 * 두 보드가 똑같이 지나야 하는 상태들.
 *
 * **"모른다" 와 "없다" 를 구분한다.** 알아보지 못한 wire shape 를 빈 보드로 그리면 사람은
 * 선언한 것이 없다고 읽는다. 둘을 같은 화면으로 처리하면 컴파일러가 바뀐 날 조용히 거짓말을
 * 하게 된다.
 */
export function BoardGate({
  projectId,
  data,
  /** 구조가 인식됐지만 그릴 것이 없을 때 보여줄 안내. */
  emptyTitle,
  emptyDescription,
  isEmpty,
  children,
}: {
  projectId: string
  data: BoardData
  emptyTitle: string
  emptyDescription: string
  isEmpty: boolean
  children: ReactNode
}) {
  const { project, compilation, board } = data

  if (project.isPending || compilation.isPending) return <BoardLoading />

  if (project.error !== null || project.data === undefined) {
    return (
      <ErrorState
        title="프로젝트를 불러오지 못했습니다"
        description={errorMessage(project.error)}
        action={
          <Button variant="outline" asChild>
            <Link href="/projects">프로젝트 목록으로</Link>
          </Button>
        }
      />
    )
  }

  if (compilation.error !== null) {
    return (
      <ErrorState
        title="컴파일 결과를 불러오지 못했습니다"
        description={errorMessage(compilation.error)}
        action={
          <Button variant="outline" onClick={() => void compilation.refetch()}>
            다시 시도
          </Button>
        }
      />
    )
  }

  if (!board.recognized) {
    return (
      <ErrorState
        title="이 컴파일 결과를 읽지 못했습니다"
        description={`서버의 rspdl ${compilation.data?.rspdl_version ?? ''} 이 이 화면이 아는 것과 다른 모양을 돌려주었습니다. 문서 편집 화면에서는 컴파일러 진단을 그대로 확인할 수 있습니다.`}
        action={
          <Button variant="outline" asChild>
            <Link href={viewHref(projectId, DEFAULT_PROJECT_VIEW)}>문서 편집으로</Link>
          </Button>
        }
      />
    )
  }

  if (!board.compiled) {
    return (
      <EmptyState
        icon={<TableIcon />}
        title="아직 문서가 없습니다"
        description="RSPDL 문서를 작성하면 선언한 구조가 이곳에 나타납니다."
        action={
          <Button asChild>
            <Link href={viewHref(projectId, DEFAULT_PROJECT_VIEW)}>문서 편집으로</Link>
          </Button>
        }
      />
    )
  }

  if (isEmpty) {
    return (
      <EmptyState
        icon={<TableIcon />}
        title={emptyTitle}
        description={emptyDescription}
        action={
          <Button variant="outline" asChild>
            <Link href={viewHref(projectId, DEFAULT_PROJECT_VIEW)}>문서 편집으로</Link>
          </Button>
        }
      />
    )
  }

  return <>{children}</>
}

function BoardLoading() {
  return (
    <div className="flex w-full flex-1 flex-col gap-4">
      <div className="border-b pb-5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-3 h-8 w-40" />
        <Skeleton className="mt-3 h-4 w-[min(32rem,100%)]" />
      </div>
      <div className="flex min-h-0 flex-1 gap-4">
        <Skeleton className="min-h-[24rem] flex-1" />
        <Skeleton className="hidden min-h-[24rem] w-[22rem] md:block" />
      </div>
    </div>
  )
}
