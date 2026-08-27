import { create } from 'zustand'

/**
 * 작업 화면의 생김새.
 *
 * 패널 폭과 AI 패널 접힘은 **서버에 없는 상태**다. 사용자가 자기 화면을 어떻게 보고 싶은지는
 * 문서의 일부가 아니고, 다른 사람과 공유되지도 않는다. 그래서 zustand 다 (ADR-0006).
 *
 * 진단은 여기 없다. 컴파일러가 준 진단은 전부 그대로 보여 준다 — 심각도 필터를 두면
 * "경고를 몇 건 숨기고 있다" 는 사실 자체가 화면에서 사라진다.
 */
interface WorkbenchState {
  /** 편집기 패널의 비율(%). 나머지가 AI 패널이다. */
  editorSize: number
  /** AI 패널을 접었는지. 접어도 다시 펼 수 있는 자리는 화면에 남는다. */
  isAiPanelCollapsed: boolean
  setEditorSize: (size: number) => void
  setAiPanelCollapsed: (collapsed: boolean) => void
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  editorSize: 62,
  isAiPanelCollapsed: false,
  setEditorSize: (editorSize) => set({ editorSize }),
  setAiPanelCollapsed: (isAiPanelCollapsed) => set({ isAiPanelCollapsed }),
}))
