import type { RspdlSeverity } from '@dahaze/rspdl-editor'
import { create } from 'zustand'

/**
 * 작업 화면의 생김새.
 *
 * 패널 폭과 진단 필터는 **서버에 없는 상태**다. 사용자가 자기 화면을 어떻게 보고 싶은지는
 * 문서의 일부가 아니고, 다른 사람과 공유되지도 않는다. 그래서 zustand 다 (ADR-0006).
 *
 * 필터가 여기 있다는 점이 중요하다. 진단 자체는 컴파일러가 준 그대로 전부 들고 있고, 필터는
 * **보이는 것만** 줄인다. 서버에 필터를 걸어 일부만 받아오면 "경고를 몇 건 숨기고 있다" 는
 * 사실조차 알 수 없게 된다.
 */
interface WorkbenchState {
  /** 편집기 패널의 비율(%). 나머지가 진단 패널이다. */
  editorSize: number
  /** 심각도별 표시 여부. 전부 끄면 아무 것도 안 보이는데, 그것도 사용자의 선택이다. */
  visibleSeverities: Record<RspdlSeverity, boolean>
  setEditorSize: (size: number) => void
  toggleSeverity: (severity: RspdlSeverity) => void
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  editorSize: 62,
  visibleSeverities: { error: true, warning: true, info: true },
  setEditorSize: (editorSize) => set({ editorSize }),
  toggleSeverity: (severity) =>
    set((state) => ({
      visibleSeverities: {
        ...state.visibleSeverities,
        [severity]: !state.visibleSeverities[severity],
      },
    })),
}))
