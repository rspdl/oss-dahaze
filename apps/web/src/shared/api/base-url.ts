/**
 * API 의 오리진.
 *
 * 평소에는 이 값을 알 필요가 없다. 모든 요청은 `@dahaze/api-client` 의 생성된 함수를 거치고,
 * base URL 은 그 안의 fetcher 가 붙인다.
 *
 * **딱 한 곳만 예외다: OAuth 로그인.** `GET /api/auth/{provider}/login` 은 GitHub 로 302 하는
 * 엔드포인트라 fetch 로 부르면 안 된다 — 브라우저가 통째로 그 주소로 이동해야 세션 쿠키를
 * 받아올 수 있다. 그래서 여기서는 요청을 보내는 것이 아니라 `window.location` 에 넣을 절대
 * 주소를 만든다.
 *
 * 이 상수가 fetcher 의 것과 갈라지면 로그인만 조용히 다른 서버로 간다. `api-client` 가 자기
 * base URL 을 내보내 주는 것이 옳고, 그 전까지는 같은 환경변수·같은 기본값을 쓴다.
 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8400'

/** 생성된 URL 빌더가 준 경로(`/api/...`)를 브라우저가 이동할 절대 주소로 만든다. */
export function absoluteApiUrl(path: string): string {
  return `${API_BASE_URL}${path}`
}
