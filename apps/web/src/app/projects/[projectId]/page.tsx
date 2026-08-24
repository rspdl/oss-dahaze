import { redirect } from 'next/navigation'

import { DEFAULT_PROJECT_VIEW, viewHref } from '@/features/navigation/views'

/**
 * 프로젝트 자체에는 화면이 없다. 프로젝트는 **범위**이고, 보는 것은 언제나 그 안의 뷰다.
 *
 * 여기서 고르지 않고 기본 뷰로 넘기는 이유: 이 주소는 사람이 치는 곳이 아니라 예전 링크와
 * 프로젝트 생성 직후가 도착하는 곳이다. 뷰를 고르라는 화면을 하나 더 끼우면 매번 같은
 * 선택을 반복하게 된다.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  redirect(viewHref(projectId, DEFAULT_PROJECT_VIEW))
}
