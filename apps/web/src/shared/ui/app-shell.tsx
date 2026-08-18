'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { Toaster } from '@dahaze/ui'

import { AccountMenu } from '@/features/auth/account-menu'
import { RuntimeVersionBadge } from '@/features/analysis/runtime-version-badge'

/**
 * 모든 화면이 공유하는 껍데기.
 *
 * `app/layout.tsx` 가 아니라 여기 두는 이유는 헤더가 세션을 읽어야 하기 때문이다. 레이아웃은
 * 서버 컴포넌트로 두는 편이 낫고, 세션을 아는 것은 클라이언트 쪽 일이다.
 *
 * `Toaster` 도 여기 있다. 저장·삭제 같은 행동의 결과를 알리는 자리라 화면이 있는 곳이면
 * 어디에나 있어야 한다.
 */
export function AppShell({
  children,
  breadcrumb,
}: {
  children: ReactNode
  breadcrumb?: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
          <Link
            href="/"
            className="rounded-control text-sm font-semibold tracking-tight"
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
          <div className="ml-auto flex items-center gap-3">
            <RuntimeVersionBadge />
            <AccountMenu />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>

      <Toaster position="bottom-right" />
    </div>
  )
}

/** 헤더 breadcrumb 의 구분자. 스크린 리더에는 읽히지 않게 둔다. */
export function Crumb({ href, children }: { href?: string; children: ReactNode }) {
  return (
    <>
      <span aria-hidden className="text-text-subtle">
        /
      </span>
      {href === undefined ? (
        <span className="truncate text-text">{children}</span>
      ) : (
        <Link href={href} className="truncate rounded-control hover:text-text">
          {children}
        </Link>
      )}
    </>
  )
}
