import type { AnalysisResponse } from '@dahaze/api-client'
import type { RspdlDiagnostic, RspdlSeverity } from '@dahaze/rspdl-editor'

/**
 * 컴파일 응답에서 진단만 꺼낸다.
 *
 * `AnalysisResponse.result` 는 RSPDL SDK 가 준 원본이고 dahaze 는 그 모양을 소유하지 않는다
 * (ADR-0003). 그래서 타입이 `Record<string, unknown>` 이고, 여기서 한 번만 좁힌다 — 화면마다
 * 캐스팅을 흩어 두면 IR 모양이 바뀌는 날 서로 다른 곳이 서로 다르게 깨진다.
 *
 * **모르는 모양을 만나면 던지지 않고 비운다.** 컴파일러가 새 필드를 넣었다는 이유로 편집기가
 * 죽으면, 진단을 못 보여주는 것보다 나쁘다. 대신 `recognized` 로 "진단이 없다" 와 "모양을
 * 못 알아봤다" 를 구분해 화면이 솔직하게 말할 수 있게 한다.
 *
 * 진단 자체는 손대지 않는다. 심각도를 조정하거나 메시지를 다시 쓰거나 항목을 걸러내지 않는다
 * (AGENTS.md — 컴파일러가 유일한 해석자다).
 */

export interface CollectedDiagnostics {
  diagnostics: RspdlDiagnostic[]
  /** `result` 가 우리가 아는 모양이었는지. `false` 면 진단 0건이 아니라 "모른다" 는 뜻이다. */
  recognized: boolean
}

const SEVERITIES: readonly RspdlSeverity[] = ['error', 'warning', 'info']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toDiagnostic(value: unknown): RspdlDiagnostic | null {
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

/**
 * 컴파일 결과는 `{ files: [{ path, module, diagnostics }] }` 모양이다.
 * 파일 여러 개를 한 번에 컴파일할 수 있으므로 전부 이어 붙인다.
 */
export function collectDiagnostics(
  response: AnalysisResponse | undefined,
): CollectedDiagnostics {
  if (response === undefined) return { diagnostics: [], recognized: true }

  const files = response.result.files
  if (!Array.isArray(files)) return { diagnostics: [], recognized: false }

  const diagnostics: RspdlDiagnostic[] = []
  for (const file of files) {
    if (!isRecord(file)) continue
    const entries = file.diagnostics
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      const diagnostic = toDiagnostic(entry)
      if (diagnostic !== null) diagnostics.push(diagnostic)
    }
  }

  return { diagnostics, recognized: true }
}

/** 심각도별 개수. 배지에 그대로 넘긴다. */
export function countBySeverity(
  diagnostics: readonly RspdlDiagnostic[],
): Record<RspdlSeverity, number> {
  const counts: Record<RspdlSeverity, number> = { error: 0, warning: 0, info: 0 }
  for (const diagnostic of diagnostics) counts[diagnostic.severity] += 1
  return counts
}

export { SEVERITIES }
