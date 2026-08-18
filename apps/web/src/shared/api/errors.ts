import { ApiError } from '@dahaze/api-client'

/**
 * 오류를 화면이 읽을 수 있는 형태로 좁힌다.
 *
 * 여기서 문구를 지어내지 않는다. 서버가 준 detail 이 있으면 그것을 그대로 보여주고, 없으면
 * 상태 코드만 말한다 — 우리가 추측한 원인을 사용자가 사실로 믿으면 엉뚱한 곳을 고치게 된다.
 */

/** 로그인이 없거나 만료됐다. 이 경우에만 로그인 화면으로 유도한다. */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

/** 권한은 있으나 이 자원에 접근할 수 없다. 로그인해도 달라지지 않는다. */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404
}

/** FastAPI 는 오류 본문에 `detail` 을 담는다. 문자열일 때만 신뢰한다. */
function detailOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const detail = (body as { detail?: unknown }).detail
  return typeof detail === 'string' ? detail : null
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return detailOf(error.body) ?? `서버가 ${error.status} 로 응답했습니다`
  }
  if (error instanceof Error && error.message !== '') return error.message
  return '알 수 없는 오류가 발생했습니다'
}
