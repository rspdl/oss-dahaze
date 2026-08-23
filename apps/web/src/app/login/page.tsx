import type { Metadata } from 'next'
import { Suspense } from 'react'

import { LoginScreen } from '@/features/auth/login-screen'

export const metadata: Metadata = { title: '로그인 · dahaze' }

/**
 * 라우트는 feature 를 조립만 한다. 로직은 `src/features/` 에 있다 (ADR-0006).
 *
 * `Suspense` 가 필요한 이유는 화면이 `?next=` 를 읽기 때문이다. `useSearchParams` 를 쓰는
 * 트리는 프리렌더할 수 없어서, 경계가 없으면 페이지 전체가 그 자리에서 막힌다.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  )
}
