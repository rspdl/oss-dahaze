import type { ReactNode } from 'react'

import { WorkspaceScreen } from '@/features/workspace/workspace-screen'

/**
 * 프로젝트 안의 모든 뷰가 공유하는 작업공간.
 *
 * 뷰마다 페이지를 따로 두지 않고 레이아웃에 두는 이유: 뷰를 바꿔도 파일 트리·AI 대화·이벤트
 * 스트림 연결이 다시 마운트되지 않아야 한다. 레이아웃은 형제 라우트 사이를 오갈 때 유지된다.
 * 지금 어느 뷰인지는 작업공간이 경로에서 읽는다 (`features/navigation/views.ts`).
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return (
    <>
      <WorkspaceScreen projectId={projectId} />
      {children}
    </>
  )
}
