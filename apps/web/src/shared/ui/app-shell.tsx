'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button, Toaster, cn } from '@dahaze/ui'

import { AppSidebar } from '@/features/navigation/app-sidebar'
import { useSidebarStore } from './sidebar-store'
import { PanelLeftIcon } from './icons'

/**
 * 모든 화면이 공유하는 껍데기.
 *
 * 왼쪽에 내비게이션 기둥, 오른쪽에 얇은 상단 막대와 본문이 있다. `app/layout.tsx` 가 아니라
 * 여기 두는 이유는 기둥이 세션과 지금 경로를 읽어야 하기 때문이다. 레이아웃은 서버
 * 컴포넌트로 두는 편이 낫고, 세션을 아는 것은 클라이언트 쪽 일이다.
 *
 * `Toaster` 도 여기 있다. 저장·삭제 같은 행동의 결과를 알리는 자리라 화면이 있는 곳이면
 * 어디에나 있어야 한다.
 */
export function AppShell({
  children,
  breadcrumb,
  actions,
  /**
   * 본문의 폭 제한을 풀지 여부. 편집기처럼 화면을 꽉 채워야 의미가 사는 화면만 켠다 —
   * 읽는 화면에서 켜면 한 줄이 너무 길어져 눈이 다음 줄을 찾지 못한다.
   */
  fullBleed = false,
}: {
  children: ReactNode
  breadcrumb?: ReactNode
  actions?: ReactNode
  fullBleed?: boolean
}) {
  const setMobileOpen = useSidebarStore((state) => state.setMobileOpen)

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[auto_1fr]">
      <AppSidebar />

      {/* `min-w-0` 이 없으면 편집기처럼 넓은 자식이 그리드 칸을 밀어내 가로 스크롤이 생긴다. */}
      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-20 border-b bg-canvas/85 backdrop-blur">
          <div className="flex h-14 items-center gap-2 px-4 md:px-6">
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label="내비게이션 열기"
              onClick={() => setMobileOpen(true)}
            >
              <PanelLeftIcon />
            </Button>

            {/* 좁은 화면에는 기둥이 접혀 있으니 제품 이름을 상단 막대가 대신 말한다. */}
            <Link
              href="/"
              className="rounded-control text-sm font-semibold tracking-tight md:hidden"
            >
              dahaze
            </Link>

            {breadcrumb ? (
              <nav
                aria-label="위치"
                className="flex min-w-0 items-center gap-1.5 text-sm text-text-muted"
              >
                {breadcrumb}
              </nav>
            ) : null}

            {actions ? (
              <div className="ml-auto flex items-center gap-2">{actions}</div>
            ) : null}
          </div>
        </header>

        {/*
          본문은 가운데 정렬하지 않는다. 왼쪽에 기둥이 있는 화면에서 본문까지 가운데로 밀면
          기둥과 본문 사이에 설명되지 않는 빈 띠가 생긴다. 여백은 오른쪽에 모아 둔다.
        */}
        <main
          className={cn(
            'flex-1 px-4 py-7 md:px-8 md:py-9',
            fullBleed ? 'flex min-h-0 flex-col' : 'w-full max-w-5xl',
          )}
        >
          {children}
        </main>
      </div>

      <Toaster position="bottom-right" />
    </div>
  )
}

/** 상단 막대 breadcrumb 의 구분자. 스크린 리더에는 읽히지 않게 둔다. */
export function Crumb({ href, children }: { href?: string; children: ReactNode }) {
  return (
    <>
      <span aria-hidden className="text-text-subtle">
        /
      </span>
      {href === undefined ? (
        <span className="truncate text-text">{children}</span>
      ) : (
        <Link
          href={href}
          className="truncate rounded-control transition-colors duration-200 ease-out-expo hover:text-text"
        >
          {children}
        </Link>
      )}
    </>
  )
}
