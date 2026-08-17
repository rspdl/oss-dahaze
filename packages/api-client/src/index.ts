/**
 * dahaze API 클라이언트.
 *
 * 여기서 내보내는 것 대부분은 생성물이다. 엔드포인트를 추가하려면 FastAPI 라우터를
 * 고치고 `pnpm codegen` 을 돌린다 — 이 패키지에 손으로 요청 함수를 쓰지 않는다.
 * 절차: .agents/skills/generate-api/SKILL.md
 */

export * from './generated/endpoints/analysis/analysis'
export * from './generated/endpoints/health/health'
export * from './generated/model'
export { ApiError, customFetch } from './fetcher'
