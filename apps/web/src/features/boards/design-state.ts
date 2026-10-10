import type { LayoutNode } from '@/features/mockup/layout-tree'

export type ScreenPosition = { x: number; y: number }
export type DesignScopeState = {
  /** 화면 key 마다 Column·Row·Box 배치 트리. */
  layouts: Record<string, LayoutNode>
  positions: Record<string, ScreenPosition>
}

export type DesignEditorState = {
  scope: string
  base: DesignScopeState
  working: DesignScopeState
  history: DesignScopeState[]
  /** 되돌린 편집. 새 편집이 생기면 비운다. */
  future: DesignScopeState[]
  metadataRevision: number
  generation: number
  acknowledgedGeneration: number
  status: 'saved' | 'pending' | 'saving' | 'error' | 'conflict'
  error: string | null
}

export function createDesignEditorState(scope: string, persisted: DesignScopeState, metadataRevision = 0): DesignEditorState {
  return {
    scope,
    base: cloneScope(persisted),
    working: cloneScope(persisted),
    history: [],
    future: [],
    metadataRevision,
    generation: 0,
    acknowledgedGeneration: 0,
    status: 'saved',
    error: null,
  }
}

export function editDesign(
  state: DesignEditorState,
  update: (current: DesignScopeState) => DesignScopeState,
): DesignEditorState {
  const next = update(cloneScope(state.working))
  return {
    ...state,
    working: next,
    history: [...state.history.slice(-49), cloneScope(state.working)],
    future: [],
    generation: state.generation + 1,
    status: 'pending',
    error: null,
  }
}

export function undoDesign(state: DesignEditorState): DesignEditorState {
  const previous = state.history.at(-1)
  if (previous === undefined) return state
  return {
    ...state,
    working: cloneScope(previous),
    history: state.history.slice(0, -1),
    future: [cloneScope(state.working), ...state.future],
    generation: state.generation + 1,
    status: 'pending',
    error: null,
  }
}

export function redoDesign(state: DesignEditorState): DesignEditorState {
  const next = state.future[0]
  if (next === undefined) return state
  return {
    ...state,
    working: cloneScope(next),
    history: [...state.history, cloneScope(state.working)],
    future: state.future.slice(1),
    generation: state.generation + 1,
    status: 'pending',
    error: null,
  }
}

export function acknowledgeDesign(state: DesignEditorState, generation: number, saved: DesignScopeState, metadataRevision: number): DesignEditorState {
  const acknowledgedGeneration = Math.max(state.acknowledgedGeneration, generation)
  return {
    ...state,
    base: cloneScope(saved),
    metadataRevision,
    acknowledgedGeneration,
    status: state.generation > acknowledgedGeneration ? 'pending' : 'saved',
    error: null,
  }
}

export function reconcileServerDesign(
  state: DesignEditorState,
  scope: string,
  persisted: DesignScopeState,
  metadataRevision: number,
): { state: DesignEditorState; accepted: boolean } {
  if (state.scope !== scope) return { state: createDesignEditorState(scope, persisted, metadataRevision), accepted: true }
  if (metadataRevision === state.metadataRevision) return { state, accepted: true }
  const dirty = state.generation !== state.acknowledgedGeneration || state.status === 'saving' || state.status === 'error'
  if (!dirty) return { state: createDesignEditorState(scope, persisted, metadataRevision), accepted: true }
  if (sameScope(state.base, persisted)) return { state: { ...state, metadataRevision }, accepted: true }
  return { state: { ...state, status: 'conflict', error: '다른 화면에서 같은 환경의 배치를 변경했습니다.' }, accepted: false }
}

export function designMetadataPatch(
  rawDesign: unknown,
  scope: string,
  design: DesignScopeState,
): Record<string, unknown> {
  const raw = isRecord(rawDesign) ? rawDesign : {}
  const environments = isRecord(raw.environments) ? raw.environments : {}
  const previousScope = isRecord(environments[scope]) ? environments[scope] : {}
  return {
    ...raw,
    environments: {
      ...environments,
      [scope]: { ...previousScope, layouts: design.layouts, positions: design.positions },
    },
  }
}

export function serializeDesignDraft(state: DesignEditorState): string | null {
  if (state.generation <= state.acknowledgedGeneration) return null
  return JSON.stringify({ ...state, status: state.status === 'conflict' ? 'conflict' : 'pending', error: state.status === 'conflict' ? state.error : null })
}

export function restoreDesignDraft(value: string | null, scope: string): DesignEditorState | null {
  if (value === null) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed) || parsed.scope !== scope || !isScope(parsed.base) || !isScope(parsed.working) || !Array.isArray(parsed.history) || !parsed.history.every(isScope)) return null
    if (typeof parsed.generation !== 'number' || typeof parsed.acknowledgedGeneration !== 'number' || parsed.generation <= parsed.acknowledgedGeneration) return null
    const future = Array.isArray(parsed.future) && parsed.future.every(isScope) ? parsed.future : []
    return { ...(parsed as unknown as DesignEditorState), future }
  } catch {
    return null
  }
}

/** 좌표 배치를 쓰던 이전 초안(`elements`)은 복원하지 않는다. */
function isScope(value: unknown): value is DesignScopeState {
  return isRecord(value) && isRecord(value.layouts) && isRecord(value.positions)
}

function cloneScope(scope: DesignScopeState): DesignScopeState {
  return {
    layouts: structuredClone(scope.layouts),
    positions: Object.fromEntries(Object.entries(scope.positions).map(([key, value]) => [key, { ...value }])),
  }
}

function sameScope(left: DesignScopeState, right: DesignScopeState): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
