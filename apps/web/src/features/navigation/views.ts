/**
 * 프로젝트 하나를 보는 뷰.
 *
 * 이 목록이 메인 영역 위쪽 뷰 선택 바의 원본이고 라우트 조각의 원본이기도 하다. 뷰를 추가할 때
 * 고칠 곳이 하나여야 선택 바와 주소가 어긋나지 않는다.
 *
 * 뷰를 주소에 담는 이유: 새로고침·공유·뒤로가기가 전부 뷰 단위로 보존된다.
 *
 * 소스는 전부 작업 트리의 문서다. 뷰는 같은 작업 트리를 다르게 보여줄 뿐이고, 왼쪽 파일 트리와
 * 오른쪽 AI 대화는 뷰를 바꿔도 그대로 남는다. 그래서 모든 뷰가 `app/projects/[projectId]/layout.tsx`
 * 하나를 공유한다 (docs/plans/agent-workspace.md "화면").
 */
export const PROJECT_VIEWS = [
  {
    id: 'documents',
    label: '문서',
    description: '파일을 열어 고치고, commit 과 도구 호출의 diff 를 본다',
  },
  {
    id: 'ia',
    label: 'IA',
    description: '작업 트리를 컴파일한 정보구조와 화면 흐름을 계층으로 본다',
  },
  {
    id: 'wireframe',
    label: '와이어프레임',
    description: '화면을 회색 목업으로 그리고 경로로 잇는다. 화면 안 배치를 고친다',
  },
] as const

export type ProjectViewId = (typeof PROJECT_VIEWS)[number]['id']

/** 프로젝트에 들어갔을 때 처음 보는 뷰. `/projects/{id}` 가 여기로 간다. */
export const DEFAULT_PROJECT_VIEW: ProjectViewId = 'documents'

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
