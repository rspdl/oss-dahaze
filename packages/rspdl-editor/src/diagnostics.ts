/**
 * 컴파일러 진단을 CodeMirror 진단으로 옮긴다.
 *
 * **이 파일의 존재 이유는 한 줄이다: `span` 은 UTF-8 바이트고 CodeMirror 는 UTF-16 이다.**
 * 변환 없이 넘기면 영어 예제에서는 멀쩡히 동작하고 한국어 문서에서만 전부 어긋난다
 * (ADR-0006). RSPDL 은 한국어 우선 언어이므로 그건 예외가 아니라 기본 동작이다.
 * 그래서 위치는 반드시 `spanToRange` 를 지난다.
 *
 * 진단의 내용은 손대지 않는다. 컴파일러가 유일한 해석자이고 dahaze 는 그 결과를 표시할 뿐이다
 * (AGENTS.md). 심각도를 올리거나 내리지 않고, 메시지를 다시 쓰지 않고, 항목을 걸러내지 않는다.
 */

import type { Diagnostic as CodeMirrorDiagnostic } from '@codemirror/lint'

import { spanToRange, type ByteSpan } from './offsets'

/** RSPDL SDK 가 쓰는 심각도. 세 가지가 전부다. */
export type RspdlSeverity = 'error' | 'warning' | 'info'

/**
 * RSPDL SDK 진단의 모양.
 *
 * `rspdl` wire contract 를 그대로 따른다 — 필드 이름이 snake_case 인 것도 그래서다.
 * 이 패키지가 `@dahaze/api-client` 를 import 하지 않으므로(ADR-0006) 구조로만 맞춘다.
 *
 * `message_key` 와 `arguments` 는 Locale 중립이다. 사람이 읽을 문장으로 바꾸는 일은
 * 이 패키지가 하지 않는다 — 번역표를 여기 두면 컴파일러 버전이 오를 때마다 편집기가
 * 함께 늙는다. 렌더된 문구가 있으면 `message` 로 받고, 없으면 `renderMessage` 로 받는다.
 */
export interface RspdlDiagnostic {
  rule_id: string
  severity: RspdlSeverity
  message_key: string
  arguments?: Record<string, string>
  span: ByteSpan
  /** 서버가 이미 사람 말로 바꿔 준 문구. 있으면 이것을 그대로 보여준다. */
  message?: string
}

export interface ToCodeMirrorOptions {
  /**
   * `message_key` 를 사람이 읽을 문장으로 바꾼다. 주지 않으면 `message` → `message_key`
   * 순으로 그대로 보여준다. 키가 그대로 보이는 편이, 편집기가 지어낸 문장을 보여주는 것보다
   * 낫다 — 표현되지 않은 의도를 추측하지 않는다.
   */
  renderMessage?: (diagnostic: RspdlDiagnostic) => string
}

function defaultMessage(diagnostic: RspdlDiagnostic): string {
  return diagnostic.message ?? diagnostic.message_key
}

/**
 * 폭이 0인 범위를 한 글자만큼 넓힌다.
 *
 * CodeMirror 는 `from === to` 인 진단도 받지만 밑줄이 그려지지 않아 화면상 사라진다.
 * "파일 끝에서 마침표가 빠졌다" 같은 진단이 정확히 이 모양으로 온다 — 가장 알려주고 싶은
 * 진단이 가장 안 보이게 되는 셈이다.
 *
 * 코드 포인트 단위로 넓힌다. 서로게이트 페어를 반으로 자르면 CodeMirror 가 범위를 되밀거나
 * 깨진 글자를 그린다.
 */
function widenEmptyRange(
  text: string,
  range: { from: number; to: number },
): { from: number; to: number } {
  if (range.to > range.from) return range

  const next = text.codePointAt(range.from)
  if (next !== undefined && next !== 0x0a) {
    return { from: range.from, to: range.from + (next > 0xffff ? 2 : 1) }
  }

  // 문서 끝이거나 줄바꿈 바로 앞이면 뒤로 못 늘린다. 앞 글자를 대신 덮는다.
  if (range.from > 0) {
    const previousUnit = text.charCodeAt(range.from - 1)
    const isLowSurrogate =
      range.from >= 2 && previousUnit >= 0xdc00 && previousUnit <= 0xdfff
    return { from: range.from - (isLowSurrogate ? 2 : 1), to: range.to }
  }

  // 빈 문서. 넓힐 곳이 없으니 그대로 둔다 — 패널에는 여전히 뜬다.
  return range
}

/**
 * 진단 목록을 CodeMirror 용으로 변환한다.
 *
 * `text` 는 **진단을 만든 그 텍스트**여야 한다. 사용자가 그 사이에 편집했다면 위치는 이미
 * 낡은 것이고, 그건 호출하는 쪽이 다시 컴파일해서 해결할 문제다. 여기서 추정해 보정하면
 * 틀린 위치를 그럴듯하게 만들어 낼 뿐이다.
 */
export function toCodeMirrorDiagnostics(
  text: string,
  diagnostics: readonly RspdlDiagnostic[],
  options: ToCodeMirrorOptions = {},
): CodeMirrorDiagnostic[] {
  const render = options.renderMessage ?? defaultMessage

  const mapped = diagnostics.map((diagnostic) => {
    // ★ 여기가 전부다. `diagnostic.span` 을 그대로 쓰면 한국어에서 조용히 어긋난다.
    const range = widenEmptyRange(text, spanToRange(text, diagnostic.span))

    return {
      from: range.from,
      to: range.to,
      severity: diagnostic.severity,
      // 규칙 ID 를 그대로 노출한다. 사용자가 문서를 검색할 때 쓰는 열쇠고,
      // 우리가 다시 지어낼 수 있는 값이 아니다.
      source: diagnostic.rule_id,
      message: render(diagnostic),
    } satisfies CodeMirrorDiagnostic
  })

  // CodeMirror 의 진단은 `RangeSet` 으로 들어가고 그건 오름차순을 요구한다. 컴파일러 출력이
  // 이미 정렬돼 있더라도 여기서 보장한다 — 순서 하나 때문에 편집기가 던지면 진단이 통째로
  // 사라진다. 정렬은 표시 순서만 바꾸고 내용은 건드리지 않는다.
  return mapped.sort((a, b) => a.from - b.from || a.to - b.to)
}

/** 진단 목록에서 가장 높은 심각도. 없으면 `null`. */
export function highestSeverity(
  diagnostics: readonly RspdlDiagnostic[],
): RspdlSeverity | null {
  let found: RspdlSeverity | null = null
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error') return 'error'
    if (diagnostic.severity === 'warning') found = 'warning'
    else if (found === null) found = diagnostic.severity
  }
  return found
}
