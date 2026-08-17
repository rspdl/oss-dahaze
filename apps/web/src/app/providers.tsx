'use client'

import { createQueryClient } from '@dahaze/api-client'
import { QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

/**
 * 클라이언트 전역 provider.
 *
 * QueryClient 는 `useState` 초기화 함수로 만든다. 모듈 최상위에서 만들면 서버에서
 * **모든 요청이 같은 인스턴스를 공유**하게 되어, 한 사용자의 캐시가 다른 사용자에게
 * 보일 수 있다. 렌더마다 새로 만드는 것도 안 된다 — 캐시가 매번 버려진다.
 *
 * 기본값은 `@dahaze/api-client` 가 소유한다 (ADR-0006). 여기서 다시 정하지 않는다.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
