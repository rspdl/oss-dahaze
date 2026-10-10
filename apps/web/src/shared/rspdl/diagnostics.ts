import type { RspdlDiagnostic, RspdlSeverity } from '@dahaze/rspdl-editor'

/**
 * 컴파일러 진단 원본을 편집기가 받는 모양으로 좁힌다.
 *
 * 작업 트리 컴파일(`GET /tree/compile`)의 `diagnostic` 은 RSPDL SDK 가 준 원본이고 dahaze 는
 * 그 모양을 소유하지 않는다 (ADR-0003). 그래서 타입이 `Record<string, unknown>` 이고, 여기서
 * 한 번만 좁힌다 — 화면마다 캐스팅을 흩어 두면 모양이 바뀌는 날 서로 다른 곳이 서로 다르게 깨진다.
 *
 * **모르는 모양을 만나면 던지지 않고 null 을 돌려준다.** 컴파일러가 새 필드를 넣었다는 이유로
 * 편집기가 죽으면, 진단을 못 보여주는 것보다 나쁘다.
 *
 * 진단 자체는 손대지 않는다. 심각도를 조정하거나 메시지를 다시 쓰거나 항목을 걸러내지 않는다
 * (AGENTS.md — 컴파일러가 유일한 해석자다).
 */

const SEVERITIES: readonly RspdlSeverity[] = ['error', 'warning', 'info']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseDiagnostic(value: unknown): RspdlDiagnostic | null {
  if (!isRecord(value)) return null

  const { rule_id: ruleId, severity, message_key: messageKey, span } = value
  if (typeof ruleId !== 'string') return null
  if (typeof messageKey !== 'string') return null
  if (!SEVERITIES.includes(severity as RspdlSeverity)) return null
  if (!isRecord(span)) return null
  if (typeof span.start !== 'number' || typeof span.end !== 'number') return null

  const args = value.arguments
  const message = value.message

  return {
    rule_id: ruleId,
    severity: severity as RspdlSeverity,
    message_key: messageKey,
    span: { start: span.start, end: span.end },
    ...(isRecord(args) ? { arguments: args as Record<string, string> } : {}),
    ...(typeof message === 'string' ? { message } : {}),
  }
}
