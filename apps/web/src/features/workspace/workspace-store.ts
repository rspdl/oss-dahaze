import { create } from 'zustand'

/**
 * 작업공간 화면 상태. 서버에 없는 것만 둔다 (ADR-0006).
 *
 * 파일 원문, 트리, 변경 목록, 대화 항목은 TanStack Query 가 소유한다. 여기에는 **무엇을 보고
 * 있는지**와 **아직 저장하지 않은 입력**만 있다.
 *
 * 프로젝트를 바꾸면 전부 뜻을 잃는다. 다른 프로젝트의 경로를 열려고 하지 않도록 프로젝트 id 와
 * 함께 들고, 다른 프로젝트에 들어오면 비운다.
 */

/**
 * 가운데 영역에 보이는 것. AI 가 파일을 바꿔도 자동으로 전환하지 않는다 — 사용자가 고른 것만
 * 보인다 (docs/plans/agent-workspace.md "화면").
 */
export type CenterView =
  | { kind: 'empty' }
  | { kind: 'file'; path: string }
  | { kind: 'commit'; commitId: string }
  | { kind: 'call'; sessionId: string; callId: string }

interface WorkspaceState {
  projectId: string | null
  center: CenterView
  /** 경로별 저장하지 않은 원문. 저장하거나 버리면 지운다. */
  drafts: Record<string, string>
  /** 펼친 폴더 경로. */
  expanded: Record<string, true>
  /** 오른쪽 대화에서 보고 있는 세션. null 이면 가장 최근 세션을 보여준다. */
  sessionId: string | null
  /** commit 에서 뺀 경로. 기본은 전부 포함이라 뺀 것만 기록한다. */
  excluded: Record<string, true>
  /** AI 가 턴 도중 흘려보내는 답변 조각. 턴 id 별. 최종 답변 항목이 기록되면 지운다. */
  streaming: Record<string, string>

  enter: (projectId: string) => void
  openFile: (path: string) => void
  openCommit: (commitId: string) => void
  openCall: (sessionId: string, callId: string) => void
  closeCenter: () => void
  setDraft: (path: string, text: string) => void
  dropDraft: (path: string) => void
  /** 파일이 옮겨지면 초안과 열린 경로를 따라 옮긴다. */
  renamePath: (from: string, to: string) => void
  toggleFolder: (path: string) => void
  expandTo: (path: string) => void
  selectSession: (sessionId: string | null) => void
  toggleExcluded: (path: string) => void
  resetExcluded: () => void
  appendDelta: (turnId: string, delta: string) => void
  clearStreaming: (turnId: string) => void
}

function ancestors(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  const result: string[] = []
  for (let index = 1; index < parts.length; index += 1) {
    result.push(`/${parts.slice(0, index).join('/')}`)
  }
  return result
}

function movePath(path: string, from: string, to: string): string {
  if (path === from) return to
  if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`
  return path
}

const EMPTY = {
  center: { kind: 'empty' } as CenterView,
  drafts: {},
  expanded: {},
  sessionId: null,
  excluded: {},
  streaming: {},
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  projectId: null,
  ...EMPTY,

  enter: (projectId) =>
    set((state) => (state.projectId === projectId ? state : { projectId, ...EMPTY })),

  openFile: (path) =>
    set((state) => {
      const expanded = { ...state.expanded }
      for (const folder of ancestors(path)) expanded[folder] = true
      return { center: { kind: 'file', path }, expanded }
    }),
  openCommit: (commitId) => set({ center: { kind: 'commit', commitId } }),
  openCall: (sessionId, callId) => set({ center: { kind: 'call', sessionId, callId } }),
  closeCenter: () => set({ center: { kind: 'empty' } }),

  setDraft: (path, text) => set((state) => ({ drafts: { ...state.drafts, [path]: text } })),
  dropDraft: (path) =>
    set((state) => {
      if (!(path in state.drafts)) return state
      const drafts = { ...state.drafts }
      delete drafts[path]
      return { drafts }
    }),
  renamePath: (from, to) =>
    set((state) => {
      const drafts: Record<string, string> = {}
      for (const [path, text] of Object.entries(state.drafts)) drafts[movePath(path, from, to)] = text
      const center =
        state.center.kind === 'file'
          ? { kind: 'file' as const, path: movePath(state.center.path, from, to) }
          : state.center
      return { drafts, center }
    }),

  toggleFolder: (path) =>
    set((state) => {
      const expanded = { ...state.expanded }
      if (expanded[path]) delete expanded[path]
      else expanded[path] = true
      return { expanded }
    }),
  expandTo: (path) =>
    set((state) => {
      const expanded = { ...state.expanded }
      for (const folder of [...ancestors(path), path]) expanded[folder] = true
      return { expanded }
    }),

  selectSession: (sessionId) => set({ sessionId }),

  toggleExcluded: (path) =>
    set((state) => {
      const excluded = { ...state.excluded }
      if (excluded[path]) delete excluded[path]
      else excluded[path] = true
      return { excluded }
    }),
  resetExcluded: () => set({ excluded: {} }),

  appendDelta: (turnId, delta) =>
    set((state) => ({
      streaming: { ...state.streaming, [turnId]: (state.streaming[turnId] ?? '') + delta },
    })),
  clearStreaming: (turnId) =>
    set((state) => {
      if (!(turnId in state.streaming)) return state
      const streaming = { ...state.streaming }
      delete streaming[turnId]
      return { streaming }
    }),
}))
