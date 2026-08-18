/**
 * dahaze API 클라이언트.
 *
 * 여기서 내보내는 것은 전부 생성물이다. 엔드포인트를 추가하려면 FastAPI 라우터를 고치고
 * `pnpm codegen` 을 돌린다 — 이 패키지에 손으로 요청 함수를 쓰지 않는다.
 * 절차: .agents/skills/generate-api/SKILL.md
 *
 * 태그별 모듈을 여기서 하나씩 열거하지 않는다. 그렇게 하면 FastAPI 에 새 태그가 생길 때마다
 * 조용히 빠진다. `scripts/write-barrel.mjs` 가 codegen 단계에서 barrel 을 만든다.
 */

export * from './generated/endpoints'
export * from './generated/model'
export { ApiError, apiBaseUrl, customFetch } from './fetcher'
export {
  createQueryClient,
  deterministicAnalysisOptions,
  shouldRetry,
} from './query-client'
