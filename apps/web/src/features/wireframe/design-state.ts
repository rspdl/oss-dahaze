import type { LayoutNode } from '@/features/mockup/layout-tree'
import type { UiTheme } from '@/features/mockup/ui-theme'

/**
 * 와이어프레임 편집 상태: 저장된 배치(`base`), 고치는 중인 배치(`working`), 되돌리기 기록.
 *
 * 배치는 작업 트리의 `<문서>.wireframe.json` 파일에 있다(`wireframe-file.ts`). 여기서는 파일을
 * 모르고, 화면 key(`path:id`)마다 보드 위치와 Column·Row·Box 트리를 든다. 편집할 때마다
 * `generation` 이 오르고, 저장이 끝나면 그 세대까지 `acknowledgedGeneration` 으로 올린다.
 *
 * 서버 쪽 파일이 바뀌면(다른 사람·AI·MCP) `serverStamp` 가 달라진다. 저장 안 한 편집이 없으면
 * 그대로 받아들이고, 있으면 고치기 전 상태와 같은 경우만 받아들인다. 다르면 `conflict` 로 멈추고
 * 편집 내용은 남긴다.
 */

export type ScreenPosition = { x: number; y: number }
export type DesignState = {
  /** 화면 key 마다 Column·Row·Box 배치 트리. */
  layouts: Record<string, LayoutNode>
  positions: Record<string, ScreenPosition>
  /** 문서 경로마다 목업을 그릴 UI 프레임워크. 없으면 회색 와이어프레임. */
  themes?: Record<string, UiTheme>
}

export type DesignEditorState = {
  /** 편집 대상. 지금은 프로젝트 id 다. 초안을 다른 프로젝트에 복원하지 않으려고 둔다. */
  scope: string
  base: DesignState
  working: DesignState
  history: DesignState[]
  /** 되돌린 편집. 새 편집이 생기면 비운다. */
  future: DesignState[]
  /** `base` 를 읽은 서버 파일들의 버전 표식. 파일 경로와 수정 시각으로 만든다. */
  serverStamp: string
  generation: number
  acknowledgedGeneration: number
  status: 'saved' | 'pending' | 'saving' | 'error' | 'conflict'
  error: string | null
}

export const EMPTY_DESIGN: DesignState = { layouts: {}, positions: {}, themes: {} }

export function createDesignEditorState(scope: string, persisted: DesignState, serverStamp = ''): DesignEditorState {
  return {
    scope,
    base: cloneDesign(persisted),
    working: cloneDesign(persisted),
    history: [],
    future: [],
    serverStamp,
    generation: 0,
    acknowledgedGeneration: 0,
    status: 'saved',
    error: null,
  }
}

export function isDirty(state: DesignEditorState): boolean {
  return state.generation > state.acknowledgedGeneration
}

export function editDesign(
  state: DesignEditorState,
  update: (current: DesignState) => DesignState,
): DesignEditorState {
  const next = update(cloneDesign(state.working))
  return {
    ...state,
    working: next,
    history: [...state.history.slice(-49), cloneDesign(state.working)],
    future: [],
    generation: state.generation + 1,
    status: state.status === 'conflict' ? 'conflict' : 'pending',
    error: state.status === 'conflict' ? state.error : null,
  }
}

export function undoDesign(state: DesignEditorState): DesignEditorState {
  const previous = state.history.at(-1)
  if (previous === undefined) return state
  return {
    ...state,
    working: cloneDesign(previous),
    history: state.history.slice(0, -1),
    future: [cloneDesign(state.working), ...state.future],
    generation: state.generation + 1,
    status: state.status === 'conflict' ? 'conflict' : 'pending',
  }
}

export function redoDesign(state: DesignEditorState): DesignEditorState {
  const next = state.future[0]
  if (next === undefined) return state
  return {
    ...state,
    working: cloneDesign(next),
    history: [...state.history, cloneDesign(state.working)],
    future: state.future.slice(1),
    generation: state.generation + 1,
    status: state.status === 'conflict' ? 'conflict' : 'pending',
  }
}

/** `generation` 세대의 `saved` 를 저장했다. 저장하는 사이 더 고쳤으면 다시 `pending` 이다. */
export function acknowledgeDesign(state: DesignEditorState, generation: number, saved: DesignState, serverStamp: string): DesignEditorState {
  const acknowledgedGeneration = Math.max(state.acknowledgedGeneration, generation)
  return {
    ...state,
    base: cloneDesign(saved),
    serverStamp,
    acknowledgedGeneration,
    status: state.generation > acknowledgedGeneration ? 'pending' : 'saved',
    error: null,
  }
}

/** 서버 파일을 다시 읽었다. 편집을 지키면서 받아들일 수 있는지 판단한다. */
export function reconcileServerDesign(
  state: DesignEditorState,
  persisted: DesignState,
  serverStamp: string,
): { state: DesignEditorState; accepted: boolean } {
  if (serverStamp === state.serverStamp) return { state, accepted: true }
  /* 자기 저장이 돌아온 경우가 대부분이다. 내용이 같으면 되돌리기 기록을 지킨다. */
  if (sameDesign(state.base, persisted)) return { state: { ...state, serverStamp }, accepted: true }
  const dirty = isDirty(state) || state.status === 'saving' || state.status === 'error'
  if (!dirty) return { state: createDesignEditorState(state.scope, persisted, serverStamp), accepted: true }
  return { state: { ...state, status: 'conflict', error: '다른 곳에서 같은 화면 배치 파일을 바꿨어요.' }, accepted: false }
}

export function serializeDesignDraft(state: DesignEditorState): string | null {
  if (!isDirty(state)) return null
  return JSON.stringify({ ...state, status: state.status === 'conflict' ? 'conflict' : 'pending', error: state.status === 'conflict' ? state.error : null })
}

export function restoreDesignDraft(value: string | null, scope: string): DesignEditorState | null {
  if (value === null) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || parsed.scope !== scope || !isDesign(parsed.base) || !isDesign(parsed.working) || !Array.isArray(parsed.history) || !parsed.history.every(isDesign)) return null
    if (typeof parsed.serverStamp !== 'string') return null
    if (typeof parsed.generation !== 'number' || typeof parsed.acknowledgedGeneration !== 'number' || parsed.generation <= parsed.acknowledgedGeneration) return null
    const future = Array.isArray(parsed.future) && parsed.future.every(isDesign) ? parsed.future : []
    return { ...(parsed as unknown as DesignEditorState), future }
  } catch {
    return null
  }
}

function isDesign(value: unknown): value is DesignState {
  return isRecord(value) && isRecord(value.layouts) && isRecord(value.positions)
}

export function cloneDesign(design: DesignState): DesignState {
  return {
    layouts: structuredClone(design.layouts),
    positions: Object.fromEntries(Object.entries(design.positions).map(([key, value]) => [key, { ...value }])),
    themes: { ...design.themes },
  }
}

export function sameDesign(left: DesignState, right: DesignState): boolean {
  const normal = (design: DesignState) => ({ layouts: design.layouts, positions: design.positions, themes: design.themes ?? {} })
  return stableJson(normal(left)) === stableJson(normal(right))
}

/** 키 순서와 상관없이 같은 값이면 같은 문자열. 파일에서 읽은 객체와 편집한 객체의 키 순서가 다르다. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, inner: unknown) =>
    isRecord(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : inner,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
