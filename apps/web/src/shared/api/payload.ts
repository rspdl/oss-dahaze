/**
 * 생성된 응답에서 본문만 꺼낸다.
 *
 * orval 의 fetch 클라이언트는 응답 타입을 `{ data, status, headers }` 봉투로 생성한다
 * (`includeHttpResponseReturnType` 기본값). 반면 `packages/api-client` 의 mutator 는 파싱한
 * 본문을 그대로 돌려주고, 2xx 가 아니면 `ApiError` 를 던진다 — 상태 코드를 화면까지 들고
 * 갈 이유가 없다는 설계다. **타입과 런타임이 지금 어긋나 있다.**
 *
 * 어느 쪽으로 맞추든 (mutator 가 봉투를 만들든, orval 설정에서 봉투를 끄든) 고칠 곳은
 * `packages/api-client` 한 곳이다. 그때까지 화면 30곳이 각자 다르게 캐스팅하는 것을 막으려고
 * 변환을 여기 하나로 모은다. **두 모양 모두를 받아들이므로 어느 쪽으로 고쳐도 화면은 그대로
 * 동작하고, 고친 뒤에는 이 파일을 지우면 된다.**
 *
 * 타입 쪽은 생성된 봉투를 그대로 믿는다. 2xx 가 아닌 응답은 fetcher 가 이미 던졌으므로
 * 여기까지 오지 않는다 — 그래서 성공 상태의 `data` 만 남긴다.
 */

/** 성공으로 취급하는 상태. 이 목록 밖은 fetcher 에서 `ApiError` 로 끝난다. */
type OkStatus = 200 | 201 | 202 | 204

type Payload<TResponse> = TResponse extends {
  status: OkStatus
  data: infer TData
}
  ? TData
  : never

function isEnvelope(value: unknown): value is { data: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    'headers' in value &&
    'data' in value
  )
}

export function payload<TResponse extends { status: number; data: unknown }>(
  response: TResponse,
): Payload<TResponse> {
  return (isEnvelope(response) ? response.data : response) as Payload<TResponse>
}
