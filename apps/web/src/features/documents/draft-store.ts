import { create } from 'zustand'

/**
 * 편집 중인 초안 텍스트.
 *
 * **저장하기 전까지 서버는 이 텍스트를 모른다.** 그래서 이것은 서버 상태가 아니고 zustand 가
 * 소유한다 (ADR-0006). 반대로 저장된 문서 본문은 TanStack Query 의 것이고, 여기로 복사하지
 * 않는다 — 같은 텍스트가 두 곳에 있으면 어느 쪽이 사용자가 친 것인지 알 수 없게 된다.
 *
 * 그래서 이 스토어에는 **"고쳐 쓴 문서" 만** 들어온다. 항목이 없다는 것은 "빈 문서" 가 아니라
 * "아직 손대지 않았다" 는 뜻이고, 그때 화면은 서버 본문을 그대로 보여준다.
 *
 * 문서 id 로 나눠 담는 이유는 탭을 옮겨 다니며 여러 문서를 고칠 수 있어야 하기 때문이다.
 * 저장에 성공하면 해당 항목을 지운다 — 그 시점부터 진실은 다시 서버에 있다.
 */
interface DraftState {
  drafts: Record<string, string>
  setDraft: (documentId: string, text: string) => void
  clearDraft: (documentId: string) => void
}

export const useDraftStore = create<DraftState>((set) => ({
  drafts: {},
  setDraft: (documentId, text) =>
    set((state) => ({ drafts: { ...state.drafts, [documentId]: text } })),
  clearDraft: (documentId) =>
    set((state) => {
      if (!(documentId in state.drafts)) return state
      const next = { ...state.drafts }
      delete next[documentId]
      return { drafts: next }
    }),
}))

/** 이 문서에 저장되지 않은 편집이 있는가. 없으면 `undefined`. */
export function useDraft(documentId: string): string | undefined {
  return useDraftStore((state) => state.drafts[documentId])
}
