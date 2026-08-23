'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { ErrorState, Skeleton } from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { useSession } from './use-session'

/**
 * 로그인이 필요한 화면을 감싼다.
 *
 * 로그아웃 상태면 `/login` 으로 보낸다. 로그인 자리를 이 자리에 그리지 않는 이유는 문이
 * 하나여야 하기 때문이다 — 폼이 두 군데 있으면 한쪽만 고쳐지는 날이 오고, 그때부터 어느
 * 화면에서 들어왔느냐에 따라 로그인 경험이 달라진다.
 *
 * 지금 경로를 `?next=` 로 넘겨 로그인이 끝나면 여기로 돌아오게 한다. 그것이 없으면
 * 사용자는 "왜 첫 화면으로 튕겼지" 를 겪는다.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession()
  const pathname = usePathname()
  const router = useRouter()

  /*
   * 세션 확인은 클라이언트에서만 가능하다 (쿠키가 API 도메인에 있다). 그래서 서버
   * 리다이렉트가 아니라 401 을 받은 뒤의 이동이다.
   */
  useEffect(() => {
    if (session.isSignedOut) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`)
    }
  }, [session.isSignedOut, pathname, router])

  if (session.error !== null) {
    return (
      <ErrorState
        title="로그인 상태를 확인하지 못했습니다"
        description={errorMessage(session.error)}
      />
    )
  }

  /* 확인 중이거나 이미 로그인 화면으로 나가는 중. 둘 다 본문을 그릴 때가 아니다. */
  if (session.isPending || session.isSignedOut) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  return <>{children}</>
}
