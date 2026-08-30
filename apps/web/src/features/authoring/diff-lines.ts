/**
 * AI 수정안과 편집 중인 내용의 줄 단위 차이.
 *
 * **여기서 RSPDL 을 해석하지 않는다.** 문법과 의미는 컴파일러가 소유한다. 이 모듈은 사용자가
 * 친 텍스트와 LLM 이 돌려준 텍스트를 문자열로만 비교한다 — 문장 단위로 자르거나 블록을
 * 알아보려 들면, 그 순간 dahaze 가 두 번째 해석자가 된다.
 *
 * 적용을 누르면 편집 중인 내용이 통째로 덮이므로, 무엇이 바뀌는지 사람이 먼저 보아야 한다.
 */

export type DiffLineKind = 'added' | 'removed' | 'context'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  /** 원본에서의 1-based 줄 번호. 추가된 줄이면 null. */
  beforeLine: number | null
  /** 수정안에서의 1-based 줄 번호. 삭제된 줄이면 null. */
  afterLine: number | null
}

/** 변경 없는 줄이 이만큼 연달아 나오면 접는다. */
export interface DiffHunk {
  lines: DiffLine[]
  /** 이 hunk 앞에서 생략한 변경 없는 줄 수. 0이면 생략하지 않았다. */
  skippedBefore: number
}

/**
 * 마지막 개행은 줄이 아니다. `"a\nb\n"` 과 `"a\nb"` 는 사람에게 같은 문서인데, 여기서
 * 구분하면 저장 방식이 다른 두 텍스트가 매번 "빈 줄 하나 삭제" 로 보인다.
 */
function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * LCS 표에 허용하는 최대 칸 수. `Int32Array` 기준 약 16MB 다.
 *
 * 실제 RSPDL 문서는 이 근처에 오지 않는다. 이 한도는 정상 동작을 위한 값이 아니라, 비정상적인
 * 입력이 브라우저를 멈추게 두지 않기 위한 것이다.
 */
const MAX_TABLE_CELLS = 4_000_000

export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)

  /*
   * LCS 는 O(n·m) 이라 수백 줄 문서 전체에 돌리면 표가 수십만 칸이 된다. 실제 수정안은
   * 앞뒤 대부분이 그대로이므로, 공통 prefix/suffix 를 먼저 떼어내 DP 를 바뀐 구간에만 쓴다.
   */
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const midA = a.slice(prefix, a.length - suffix)
  const midB = b.slice(prefix, b.length - suffix)

  const lines: DiffLine[] = []
  let beforeLine = 0
  let afterLine = 0

  const pushContext = (text: string) => {
    beforeLine += 1
    afterLine += 1
    lines.push({ kind: 'context', text, beforeLine, afterLine })
  }

  for (const text of a.slice(0, prefix)) pushContext(text)

  const n = midA.length
  const m = midB.length

  /*
   * DP 표는 n·m 칸이다. 앞뒤를 떼어내도 문서 전체가 새로 쓰인 수정안에서는 두 구간이 거의
   * 그대로 남는다. 만 줄짜리 문서끼리면 표가 1억 칸(400MB)이 되어 편집 중인 탭이 멈추고,
   * 사람은 수정안을 보기는커녕 쓰던 문서를 잃는다.
   *
   * 한도를 넘으면 정확한 줄 대응을 포기하고 바뀐 구간을 통째로 교체로 보인다. 덜 친절하지만
   * 거짓말은 아니다 — 그 구간이 전부 바뀌는 것은 사실이고, 적용 결과도 달라지지 않는다.
   */
  if (n * m > MAX_TABLE_CELLS) {
    for (const text of midA) {
      beforeLine += 1
      lines.push({ kind: 'removed', text, beforeLine, afterLine: null })
    }
    for (const text of midB) {
      afterLine += 1
      lines.push({ kind: 'added', text, beforeLine: null, afterLine })
    }
    for (const text of a.slice(a.length - suffix)) pushContext(text)
    return lines
  }

  /*
   * lcs(i, j) = midA[i..] 와 midB[j..] 의 LCS 길이. 뒤에서부터 채운다. 한 줄짜리 평면 배열을
   * 쓰는 건 표가 바뀐 구간 크기의 제곱만큼 커지기 때문이다.
   */
  const width = m + 1
  const table = new Int32Array((n + 1) * width)
  const lcs = (i: number, j: number) => table[i * width + j] ?? 0

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        midA[i] === midB[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1))
    }
  }

  let i = 0
  let j = 0
  while (i < n || j < m) {
    const left = midA[i]
    const right = midB[j]

    if (left !== undefined && right !== undefined && left === right) {
      pushContext(left)
      i += 1
      j += 1
      continue
    }
    // 한 줄이 교체된 경우 삭제를 먼저 보인다 — 사람은 "무엇이 무엇으로" 순서로 읽는다.
    if (left !== undefined && (right === undefined || lcs(i + 1, j) >= lcs(i, j + 1))) {
      beforeLine += 1
      lines.push({ kind: 'removed', text: left, beforeLine, afterLine: null })
      i += 1
    } else if (right !== undefined) {
      afterLine += 1
      lines.push({ kind: 'added', text: right, beforeLine: null, afterLine })
      j += 1
    } else {
      break
    }
  }

  for (const text of a.slice(a.length - suffix)) pushContext(text)

  return lines
}

/** 변경 지점 주위 context 줄만 남기고 나머지는 hunk 로 접는다. contextLines 기본 2. */
export function toHunks(lines: readonly DiffLine[], contextLines = 2): DiffHunk[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  let changed = false

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.kind === 'context') continue
    changed = true
    const from = Math.max(0, index - contextLines)
    const to = Math.min(lines.length - 1, index + contextLines)
    for (let k = from; k <= to; k += 1) keep[k] = true
  }

  // 변경이 없으면 접을 것도 보여줄 것도 없다. 화면은 "같습니다" 한 줄만 내보낸다.
  if (!changed) return []

  const hunks: DiffHunk[] = []
  let index = 0
  let previousEnd = 0

  while (index < lines.length) {
    if (keep[index] !== true) {
      index += 1
      continue
    }
    const start = index
    while (index < lines.length && keep[index] === true) index += 1
    hunks.push({ lines: lines.slice(start, index), skippedBefore: start - previousEnd })
    previousEnd = index
  }

  return hunks
}

export function summarizeDiff(lines: readonly DiffLine[]): {
  added: number
  removed: number
  changed: boolean
} {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === 'added') added += 1
    else if (line.kind === 'removed') removed += 1
  }
  return { added, removed, changed: added > 0 || removed > 0 }
}
