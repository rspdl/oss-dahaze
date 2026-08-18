'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { EmptyState, ErrorState, Skeleton } from '@dahaze/ui'

import { errorMessage } from '@/shared/api/errors'
import { SignInButtons } from './sign-in-buttons'
import { useSession } from './use-session'

/**
 * 로그인이 필요한 화면을 감싼다.
 *
 * 리다이렉트하지 않고 그 자리에서 로그인 자리를 보여준다. 주소를 바꿔 버리면 로그인 뒤에
 * 원래 보려던 화면으로 돌려보낼 근거가 사라지고, 사용자는 "왜 첫 화면으로 튕겼지" 를 겪는다.
 * 대신 지금 경로를 `redirect_to` 로 넘겨 로그인이 끝나면 여기로 돌아오게 한다.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession()
  const pathname = usePathname()

  if (session.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (session.error !== null) {
    return (
      <ErrorState
        title="로그인 상태를 확인하지 못했습니다"
        description={errorMessage(session.error)}
      />
    )
  }

  if (session.isSignedOut) {
    return (
      <EmptyState
        title="로그인이 필요합니다"
        description="이 화면은 프로젝트에 속한 사람만 볼 수 있습니다."
        action={<SignInButtons redirectTo={pathname} />}
      />
    )
  }

  return <>{children}</>
}
