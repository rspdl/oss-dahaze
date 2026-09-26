/**
 * 프로젝트 하나를 보는 뷰.
 *
 * 이 목록이 왼쪽 메뉴의 원본이고 라우트 조각의 원본이기도 하다. 뷰를 추가할 때 고칠 곳이
 * 하나여야 메뉴와 주소가 어긋나지 않는다.
 *
 * 뷰를 주소에 담는 이유: 새로고침·공유·뒤로가기가 전부 뷰 단위로 보존된다.
 *
 * 지금은 작업공간 하나다. 옛 검토·명세·관리 뷰는 공유 작업 트리로 옮기면서 삭제했다
 * (docs/plans/agent-workspace.md "삭제할 것").
 */
export const PROJECT_VIEWS = [
  {
    id: 'workspace',
    label: '작업공간',
    description: '파일을 고르고 고치며 AI와 대화로 문서를 만든다',
  },
] as const

export type ProjectViewId = (typeof PROJECT_VIEWS)[number]['id']

/** 프로젝트에 들어갔을 때 처음 보는 뷰. `/projects/{id}` 가 여기로 간다. */
export const DEFAULT_PROJECT_VIEW: ProjectViewId = 'workspace'

export function viewHref(projectId: string, view: ProjectViewId): string {
  return `/projects/${projectId}/${view}`
}

export interface ActiveRoute {
  projectId: string | null
  view: ProjectViewId | null
}

/**
 * 경로에서 지금 어디에 있는지 읽는다. 라우터가 이미 아는 사실이므로 상태로 복제하지 않는다.
 *
 * 모르는 뷰 조각(예전 링크, 오타)은 `null` 로 둔다. 아무 뷰나 활성으로 칠하면 사용자가
 * 있지도 않은 곳에 있다고 믿게 된다.
 */
export function activeRoute(pathname: string): ActiveRoute {
  const match = /^\/projects\/([^/]+)(?:\/([^/]+))?/.exec(pathname)
  if (match === null) return { projectId: null, view: null }

  const [, projectId, viewSegment] = match
  const view = PROJECT_VIEWS.find((entry) => entry.id === viewSegment)?.id ?? null

  return { projectId: projectId ?? null, view }
}
