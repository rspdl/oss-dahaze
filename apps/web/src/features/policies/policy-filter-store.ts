import { create } from 'zustand'

import type { PolicyAxis } from '@/shared/rspdl/policies'

/**
 * 정책 검토의 필터와 묶기.
 *
 * 서버에 없는 상태다 (ADR-0006). 내가 지금 금지 정책만 보고 있는지는 문서의 일부가 아니고
 * 다른 사람과 공유되지도 않는다. CLAUDE.md 가 필터를 zustand 사례로 못박아 두었다.
 *
 * **거르는 것은 보이는 것뿐이다.** 정책은 컴파일 결과에서 전부 받아 두고 화면에서만 줄인다.
 * 서버에 필터를 걸어 일부만 받아오면 "몇 건을 숨기고 있다" 는 사실조차 알 수 없게 된다 —
 * 진단 필터를 이렇게 둔 것과 같은 이유다 (`workbench-store`).
 *
 * 프로젝트가 바뀌면 선택을 비운다. 역할 id 는 모듈 접두사를 달고 있어 프로젝트를 넘으면
 * 아무 줄과도 맞지 않는데, 그대로 두면 "정책이 하나도 없다" 로 보인다. 사라진 이유가
 * 화면에 없으면 그건 버그로 읽힌다.
 */
interface PolicyFilterState {
  /** 어느 프로젝트의 선택인지. 이게 바뀌면 선택을 버린다. */
  projectId: string | null
  /** 축마다 고른 값. 빈 배열은 "이 축으로는 거르지 않는다". */
  selection: Partial<Record<PolicyAxis, string[]>>
  /** 매트릭스를 묶을 축. `null` 이면 한 덩어리로 편다. */
  groupBy: PolicyAxis | null

  /** 화면이 열릴 때 부른다. 프로젝트가 달라졌으면 선택을 비운다. */
  enter: (projectId: string) => void
  toggle: (axis: PolicyAxis, value: string) => void
  clearAxis: (axis: PolicyAxis) => void
  clearAll: () => void
  setGroupBy: (axis: PolicyAxis | null) => void
}

export const usePolicyFilterStore = create<PolicyFilterState>((set) => ({
  projectId: null,
  selection: {},
  groupBy: null,

  enter: (projectId) =>
    set((state) =>
      state.projectId === projectId
        ? state
        : { projectId, selection: {}, groupBy: state.groupBy },
    ),

  toggle: (axis, value) =>
    set((state) => {
      const current = state.selection[axis] ?? []
      const next = current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value]
      return {
        selection: { ...state.selection, [axis]: next },
      }
    }),

  clearAxis: (axis) =>
    set((state) => ({ selection: { ...state.selection, [axis]: [] } })),

  clearAll: () => set({ selection: {} }),

  setGroupBy: (groupBy) => set({ groupBy }),
}))

/** 지금 켜져 있는 필터의 개수. 0 이면 아무 것도 거르지 않는 상태다. */
export function activeFilterCount(
  selection: Partial<Record<PolicyAxis, string[]>>,
): number {
  return Object.values(selection).reduce(
    (sum, values) => sum + (values?.length ?? 0),
    0,
  )
}
