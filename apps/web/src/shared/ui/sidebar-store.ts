import { create } from 'zustand'

/**
 * 왼쪽 내비게이션의 상태.
 *
 * 서버에 없는 상태라 zustand 다 (ADR-0006). 내가 내비게이션을 접어 뒀는지는 문서의 일부가
 * 아니고 다른 사람과 공유되지도 않는다.
 *
 * 두 상태를 따로 두는 이유는 둘이 다른 물건이기 때문이다. `collapsed` 는 넓은 화면에서
 * 아이콘만 남길지의 **취향**이고, `mobileOpen` 은 좁은 화면에서 서랍이 열려 있는지의
 * **순간 상태**다. 하나로 합치면 폰에서 서랍을 닫았다가 데스크톱으로 창을 넓혔을 때
 * 내비게이션이 사라진 채로 남는다.
 *
 * 접힘 상태를 저장하지 않는 것은 의도다. localStorage 에서 읽으면 서버가 그린 첫 화면과
 * 브라우저가 아는 값이 달라 하이드레이션이 어긋나고, 그 대가로 얻는 것은 새로고침 한 번
 * 아낀 클릭뿐이다.
 */
interface SidebarState {
  /** 넓은 화면에서 아이콘만 남긴 상태인지. */
  collapsed: boolean
  /** 좁은 화면에서 서랍이 열려 있는지. */
  mobileOpen: boolean
  toggleCollapsed: () => void
  setMobileOpen: (open: boolean) => void
}

export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: false,
  mobileOpen: false,
  toggleCollapsed: () => set((state) => ({ collapsed: !state.collapsed })),
  setMobileOpen: (mobileOpen) => set({ mobileOpen }),
}))
