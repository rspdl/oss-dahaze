import { QueryClient } from '@tanstack/react-query'

import { ApiError } from './fetcher'

/**
 * QueryClient 기본값을 이 패키지가 소유한다 (ADR-0006).
 *
 * 앱마다 다시 정하면 갈라지고, 갈라진 쪽은 아무도 눈치채지 못한다. 두 번째 앱이 생겨도
 * 여기 하나만 고치면 된다.
 */

/** 컴파일 결과가 신선하다고 보는 시간. */
const COMPILE_STALE_TIME_MS = 5 * 60 * 1000

/** 그 밖의 조회. 문서 목록처럼 다른 사람이 바꿀 수 있는 것들. */
const DEFAULT_STALE_TIME_MS = 30 * 1000

const MAX_RETRIES = 2

/**
 * 4xx 는 재시도하지 않는다.
 *
 * 401 을 세 번 더 던져 봐야 결과는 같고 로그인 화면만 늦게 뜬다. 404·403 도 마찬가지다.
 * 재시도가 의미 있는 것은 네트워크 오류와 5xx 뿐이다.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false
  }
  return failureCount < MAX_RETRIES
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: DEFAULT_STALE_TIME_MS,
        // 탭을 옮길 때마다 다시 부르지 않는다. 컴파일은 서버에서 실제 계산이 도는 작업이다.
        refetchOnWindowFocus: false,
      },
      mutations: {
        // mutation 은 재시도하지 않는다. 문서 저장이 조용히 두 번 일어나면 리비전이 두 개
        // 남고, 사용자는 자기가 한 번만 저장했다고 기억한다.
        retry: false,
      },
    },
  })
}

/**
 * 컴파일·검사 결과처럼 **결정적이고 서버가 캐시하는** 응답에 얹는 옵션.
 *
 * 같은 소스에 대한 컴파일 결과는 rspdl 버전이 같은 한 변하지 않는다 (ADR-0003).
 */
export const deterministicAnalysisOptions = {
  staleTime: COMPILE_STALE_TIME_MS,
  gcTime: COMPILE_STALE_TIME_MS * 2,
} as const
