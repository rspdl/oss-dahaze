/**
 * orval 이 생성한 모든 요청이 지나는 단 하나의 지점.
 *
 * base URL, 자격증명, 오류 변환을 여기서만 정한다. 손으로 쓴 fetch 래퍼를 따로 두지
 * 않는 이유이기도 하다 — 규칙이 두 군데 있으면 반드시 갈라진다.
 */

/**
 * API 주소. OAuth 로그인처럼 fetch 가 아니라 전체 페이지 이동이 필요한 경우가 있어
 * 내보낸다. 앱이 같은 환경변수를 따로 읽으면 값이 갈라졌을 때 로그인만 조용히
 * 다른 서버로 간다.
 */
export const apiBaseUrl =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) ||
  'http://localhost:8400'

const BASE_URL = apiBaseUrl

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${status}`)
    this.name = 'ApiError'
  }
}

export const customFetch = async <T>(
  url: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`${BASE_URL}${url}`, {
    ...init,
    // app.dahaze.xyz → api.dahaze.xyz 로 상위 도메인 세션 쿠키를 보낸다 (ADR-0004).
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  const text = await response.text()
  const body = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new ApiError(response.status, body)
  }

  return body as T
}

export default customFetch
