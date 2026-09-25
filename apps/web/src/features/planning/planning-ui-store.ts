import { create } from 'zustand'

import type { PlanningSubject } from './planning-types'

/**
 * AI 대화 패널과 검토 화면이 함께 읽는 화면 상태.
 *
 * 서버에 없는 상태라 zustand 다 (ADR-0006). 인터뷰 메시지와 초안 자체는 서버가 소유하고
 * Query 가 들고 있다. 여기에는 **지금 무엇을 보고 있는지**만 둔다.
 *
 * 패널과 검토 화면이 서로 다른 컴포넌트 트리에 있어서 이 둘을 한곳에 둔다.
 *
 * - `subject` — 화면 흐름에서 고른 요소나 검토 항목. 패널이 이 맥락을 붙여 AI 에게 보낸다.
 * - `selectedDraftId` — 검토 화면에서 고른 초안. 인터뷰와 재작성 요청이 이 초안을 기준으로
 *   삼는다. 검토 화면만 알고 있으면 패널에서 보낸 요청이 다른 초안을 기준으로 삼게 된다.
 *
 * 프로젝트를 바꾸면 둘 다 뜻을 잃는다. 다른 프로젝트의 초안 id 를 기준으로 요청을 보내지
 * 않도록 프로젝트 id 와 함께 들고, 다른 프로젝트에 들어오면 비운다.
 */
interface PlanningUiState {
  projectId: string | null
  /** 넓은 화면에서 AI 대화 패널이 열려 있는지. 대화가 작성의 중심이라 처음에는 연다. */
  panelOpen: boolean
  /**
   * 좁은 화면에서 서랍이 열려 있는지. `panelOpen` 과 따로 두는 이유는 내비게이션 서랍과 같다
   * (`sidebar-store`) — 폰에서는 서랍이 본문을 덮으므로 처음에 닫혀 있어야 한다.
   */
  mobileOpen: boolean
  subject: PlanningSubject | undefined
  selectedDraftId: string | null
  enter: (projectId: string) => void
  setPanelOpen: (open: boolean) => void
  setMobileOpen: (open: boolean) => void
  /** 맥락을 붙이고 패널을 연다. 접힌 채로 맥락만 바꾸면 아무 일도 안 일어난 것처럼 보인다. */
  askAbout: (subject: PlanningSubject) => void
  clearSubject: () => void
  selectDraft: (draftId: string | null) => void
}

export const usePlanningUiStore = create<PlanningUiState>((set) => ({
  projectId: null,
  panelOpen: true,
  mobileOpen: false,
  subject: undefined,
  selectedDraftId: null,
  enter: (projectId) =>
    set((state) =>
      state.projectId === projectId
        ? state
        : { projectId, subject: undefined, selectedDraftId: null },
    ),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setMobileOpen: (mobileOpen) => set({ mobileOpen }),
  askAbout: (subject) => set({ subject, panelOpen: true, mobileOpen: true }),
  clearSubject: () => set({ subject: undefined }),
  selectDraft: (selectedDraftId) => set({ selectedDraftId }),
}))
