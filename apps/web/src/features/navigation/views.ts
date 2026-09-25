/**
 * 프로젝트 하나를 보는 여러 관점.
 *
 * 이 목록이 왼쪽 메뉴의 원본이고 라우트 조각의 원본이기도 하다. 뷰를 추가할 때 고칠 곳이
 * 하나여야 메뉴와 주소가 어긋나지 않는다.
 *
 * 뷰를 주소에 담는 이유: 새로고침·공유·뒤로가기가 전부 뷰 단위로 보존된다. 탭 상태를
 * 메모리에만 두면 "정책 검토 화면을 보내 줘" 를 링크로 할 수 없다.
 */
export const PROJECT_VIEWS = [
  {
    id: 'planning',
    label: '검토',
    group: 'home',
    description: '지금 판단할 진단·질문·제안·미정 결정과 적용 대기 변경안',
  },
  {
    id: 'documents',
    label: '문서',
    group: 'spec',
    /** 목록에서 이 뷰가 무엇을 하는 곳인지. 좁은 기둥에서는 tooltip 이 된다. */
    description: 'RSPDL 문서를 쓰고 컴파일 진단을 본다',
  },
  {
    id: 'data-models',
    label: '데이터 모델',
    group: 'spec',
    description: '컴파일된 모델과 필드를 한 곳에서 살핀다',
  },
  {
    id: 'policies',
    label: '정책',
    group: 'spec',
    description: '프로젝트 전체의 정책을 표로 가로질러 본다',
  },
  {
    id: 'ia',
    label: '화면 구조',
    group: 'spec',
    description: '선언된 분류와 화면을 트리로 본다',
  },
  {
    id: 'screen-flow',
    label: '화면 흐름',
    group: 'spec',
    description: '선언된 레이아웃을 그리고 화면 사이 경로를 잇는다',
  },
  {
    id: 'versions',
    label: '버전·전달',
    group: 'manage',
    description: '프로젝트 버전을 복원하고 개발 전달본을 만든다',
  },
  {
    id: 'settings',
    label: '설정',
    group: 'manage',
    description: '사용 환경과 샘플 데이터를 관리한다',
  },
] as const

/**
 * 메뉴 묶음. 흐름 순서대로 둔다 — 판단할 것을 보고(검토), 명세를 살피고 고치고(명세),
 * 확정된 것을 넘긴다(관리). 묶음 이름이 없는 `home` 은 맨 위에 혼자 선다.
 */
export const VIEW_GROUPS = [
  { id: 'home', label: null },
  { id: 'spec', label: '명세' },
  { id: 'manage', label: '관리' },
] as const

export type ProjectViewId = (typeof PROJECT_VIEWS)[number]['id']

/**
 * 프로젝트에 들어갔을 때 처음 보는 뷰. `/projects/{id}` 가 여기로 간다.
 *
 * 검토가 기본인 이유: 들어와서 가장 먼저 할 일은 지금 판단이 필요한 것을 보는 일이다. 빈
 * 프로젝트에서도 검토 화면 옆의 AI 대화에서 바로 기획을 시작할 수 있다.
 */
export const DEFAULT_PROJECT_VIEW: ProjectViewId = 'planning'

export function viewHref(projectId: string, view: ProjectViewId): string {
  return `/projects/${projectId}/${view}`
}

export function documentHref(projectId: string, documentId: string): string {
  return `/projects/${projectId}/documents/${documentId}`
}

export interface ActiveRoute {
  projectId: string | null
  view: ProjectViewId | null
  documentId: string | null
}

/**
 * 경로에서 지금 어디에 있는지 읽는다. 라우터가 이미 아는 사실이므로 상태로 복제하지 않는다.
 *
 * 모르는 뷰 조각(예전 링크, 오타)은 `null` 로 둔다. 아무 뷰나 활성으로 칠하면 사용자가
 * 있지도 않은 곳에 있다고 믿게 된다.
 */
export function activeRoute(pathname: string): ActiveRoute {
  const match = /^\/projects\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/.exec(pathname)
  if (match === null) return { projectId: null, view: null, documentId: null }

  const [, projectId, viewSegment, documentId] = match
  const view =
    PROJECT_VIEWS.find((entry) => entry.id === viewSegment)?.id ?? null

  return {
    projectId: projectId ?? null,
    view,
    // 문서 id 는 문서 편집 뷰 아래에서만 뜻이 있다.
    documentId: view === 'documents' ? (documentId ?? null) : null,
  }
}
