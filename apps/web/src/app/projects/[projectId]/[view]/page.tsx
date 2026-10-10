import { redirect } from 'next/navigation'

import { DEFAULT_PROJECT_VIEW, PROJECT_VIEWS, viewHref } from '@/features/navigation/views'

/**
 * 뷰 조각을 확인만 한다. 화면은 `../layout.tsx` 의 작업공간이 그린다.
 *
 * 모르는 조각(예전 `/workspace` 링크, 오타)은 기본 뷰로 보낸다.
 */
export default async function ProjectViewPage({
  params,
}: {
  params: Promise<{ projectId: string; view: string }>
}) {
  const { projectId, view } = await params
  if (!PROJECT_VIEWS.some((entry) => entry.id === view)) {
    redirect(viewHref(projectId, DEFAULT_PROJECT_VIEW))
  }
  return null
}
