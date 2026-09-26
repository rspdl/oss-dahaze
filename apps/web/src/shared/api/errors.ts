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

/**
 * FastAPI 는 오류 본문에 `detail` 을 담는다. 문자열이면 그대로, 화면이 구분해야 하는 오류
 * (`{code, message, …}`)면 그 `message` 를 쓴다.
 */
function detailOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const detail = (body as { detail?: unknown }).detail
  if (typeof detail === 'string') return detail
  const coded = codedDetail(detail)
  return coded === null ? null : coded.message
}

/** 409 처럼 화면이 종류를 구분해야 하는 오류의 `detail`. */
export interface CodedDetail {
  code: string
  message: string
  [key: string]: unknown
}

function codedDetail(detail: unknown): CodedDetail | null {
  if (typeof detail !== 'object' || detail === null) return null
  const { code, message } = detail as { code?: unknown; message?: unknown }
  if (typeof code !== 'string' || typeof message !== 'string') return null
  return detail as CodedDetail
}

/**
 * 서버가 `code` 를 붙여 준 오류면 그 detail 을, 아니면 null. 작업 트리는 잠긴 파일
 * (`locked`)과 비어 있지 않은 폴더(`folder_not_empty`)를 이렇게 구분해 준다.
 */
export function errorDetail(error: unknown): CodedDetail | null {
  if (!(error instanceof ApiError)) return null
  if (typeof error.body !== 'object' || error.body === null) return null
  return codedDetail((error.body as { detail?: unknown }).detail)
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return detailOf(error.body) ?? `서버가 ${error.status} 로 응답했습니다`
  }
  if (error instanceof Error && error.message !== '') return error.message
  return '알 수 없는 오류가 발생했습니다'
}
