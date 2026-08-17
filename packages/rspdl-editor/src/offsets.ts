/**
 * RSPDL 진단 span 을 JavaScript 문자열 위치로 옮긴다.
 *
 * **컴파일러의 `span` 은 UTF-8 바이트 오프셋이고 `end` 는 배타적이다.** JavaScript 문자열과
 * CodeMirror 는 UTF-16 코드 유닛으로 센다. 한글은 UTF-8 로 3바이트, UTF-16 으로 1유닛이므로
 * 변환하지 않으면 밑줄이 전부 엉뚱한 곳에 그어진다. RSPDL 은 한국어 우선 언어라 이건
 * 예외가 아니라 기본 상황이다 (ADR-0006).
 *
 * 확인된 예:
 *   소스 "@모듈 재고(inventory)\n\n재고 항목(item)은 …" 은 문자 48개 / 바이트 90개고,
 *   진단 span 27..89 는 바이트로 잘라야 의도한 문장이 나온다.
 */

/** 컴파일러가 준 진단 범위. 단위는 UTF-8 바이트. */
export interface ByteSpan {
  start: number
  end: number
}

/** CodeMirror 가 쓰는 범위. 단위는 UTF-16 코드 유닛. */
export interface TextRange {
  from: number
  to: number
}

/** 코드 포인트 하나의 UTF-8 바이트 수. */
function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}

/**
 * UTF-8 바이트 오프셋 → JS 문자열 인덱스.
 *
 * 범위를 벗어난 오프셋은 **던지지 않고** 가장 가까운 경계로 잘라낸다. 진단 하나가
 * 이상하다고 편집기 전체가 죽는 것은, 그 진단을 못 보여주는 것보다 나쁘다.
 *
 * 문자 중간(멀티바이트 문자의 두 번째 바이트 등)을 가리키면 그 문자의 **시작**으로 내린다.
 * 잘린 문자를 만들지 않기 위해서다.
 */
export function byteOffsetToIndex(text: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0

  let bytes = 0
  let index = 0

  while (index < text.length) {
    const codePoint = text.codePointAt(index)
    if (codePoint === undefined) break

    const width = codePoint > 0xffff ? 2 : 1
    const nextBytes = bytes + utf8Length(codePoint)

    // 이 문자를 넘어가면 목표를 지난 것이다. 문자 중간이면 여기서 멈춰 시작으로 내린다.
    if (nextBytes > byteOffset) return index

    bytes = nextBytes
    index += width
  }

  return text.length
}

/** 진단 span → CodeMirror 범위. */
export function spanToRange(text: string, span: ByteSpan): TextRange {
  const from = byteOffsetToIndex(text, span.start)
  const to = byteOffsetToIndex(text, span.end)
  // 컴파일러가 뒤집힌 범위를 줄 리는 없지만, 오면 빈 범위로 접는다.
  return { from, to: Math.max(from, to) }
}

/**
 * 진단 위치를 사람이 읽는 좌표로. 목록·패널에서 "3행 12열" 로 보여줄 때 쓴다.
 *
 * 행과 열은 **1부터** 센다. 편집기 UI 관습이고, 0부터 세면 사용자가 한 칸씩 어긋나게 읽는다.
 * 열은 코드 포인트 단위다 — 서로게이트 페어 하나를 두 칸으로 세면 이모지가 든 줄에서 어긋난다.
 */
export function spanToLineColumn(
  text: string,
  span: ByteSpan,
): { line: number; column: number } {
  const index = byteOffsetToIndex(text, span.start)
  const before = text.slice(0, index)
  const newlineCount = before.split('\n').length
  const lineStart = before.lastIndexOf('\n') + 1
  const column = [...text.slice(lineStart, index)].length + 1
  return { line: newlineCount, column }
}
