import { describe, expect, it } from 'vitest'

import { diffLines, summarizeDiff, toHunks } from './diff-lines'

/** 줄 번호까지 함께 보려고 압축한다 — 번호가 틀리면 사람이 편집기에서 위치를 찾지 못한다. */
function shape(text: string, other: string) {
  return diffLines(text, other).map(
    (line) => `${line.beforeLine ?? '-'}/${line.afterLine ?? '-'} ${line.kind} ${line.text}`,
  )
}

describe('diffLines', () => {
  it('완전히 같은 입력에는 변경이 없다', () => {
    const lines = diffLines('가.\n나.\n다.', '가.\n나.\n다.')

    expect(lines.every((line) => line.kind === 'context')).toBe(true)
    expect(summarizeDiff(lines)).toEqual({ added: 0, removed: 0, changed: false })
  })

  it('순수 추가는 원본 줄 번호를 비운다', () => {
    expect(shape('가.\n나.', '가.\n다.\n라.\n나.')).toEqual([
      '1/1 context 가.',
      '-/2 added 다.',
      '-/3 added 라.',
      '2/4 context 나.',
    ])
    expect(summarizeDiff(diffLines('가.\n나.', '가.\n다.\n라.\n나.'))).toEqual({
      added: 2,
      removed: 0,
      changed: true,
    })
  })

  it('순수 삭제는 수정안 줄 번호를 비운다', () => {
    expect(shape('가.\n나.\n다.', '가.\n다.')).toEqual([
      '1/1 context 가.',
      '2/- removed 나.',
      '3/2 context 다.',
    ])
  })

  it('한 줄 교체는 삭제를 먼저, 추가를 나중에 보인다', () => {
    expect(shape('가.\n나.\n다.', '가.\n나 바뀜.\n다.')).toEqual([
      '1/1 context 가.',
      '2/- removed 나.',
      '-/2 added 나 바뀜.',
      '3/3 context 다.',
    ])
  })

  it('여러 변경 지점은 context 로 나뉜 여러 hunk 가 된다', () => {
    const before = Array.from({ length: 20 }, (_, index) => `줄 ${index + 1}.`).join('\n')
    const after = before
      .split('\n')
      .map((line, index) => (index === 3 || index === 17 ? `${line} 수정` : line))
      .join('\n')

    const [first, second, ...rest] = toHunks(diffLines(before, after), 2)

    expect(rest).toHaveLength(0)
    // 첫 hunk 앞에는 변경 없는 줄 하나(1번 줄)만 생략된다.
    expect(first?.skippedBefore).toBe(1)
    expect(first?.lines.map((line) => line.kind)).toEqual([
      'context',
      'context',
      'removed',
      'added',
      'context',
      'context',
    ])
    expect(second?.skippedBefore).toBeGreaterThan(0)
    expect(second?.lines.at(-1)?.beforeLine).toBe(20)
  })

  it('한글 멀티바이트 텍스트도 줄 단위로만 비교한다', () => {
    expect(shape('예약을 취소한다.', '예약을 즉시 취소한다.')).toEqual([
      '1/- removed 예약을 취소한다.',
      '-/1 added 예약을 즉시 취소한다.',
    ])
  })

  it('빈 원본은 수정안 전체가 추가다', () => {
    const lines = diffLines('', '가.\n나.')

    expect(lines.map((line) => line.kind)).toEqual(['added', 'added'])
    expect(lines.map((line) => line.afterLine)).toEqual([1, 2])
    expect(summarizeDiff(diffLines('가.\n나.', ''))).toEqual({
      added: 0,
      removed: 2,
      changed: true,
    })
    expect(summarizeDiff(diffLines('', ''))).toEqual({ added: 0, removed: 0, changed: false })
  })

  it('후행 개행만 다른 텍스트는 같은 문서로 본다', () => {
    expect(summarizeDiff(diffLines('가.\n나.\n', '가.\n나.'))).toEqual({
      added: 0,
      removed: 0,
      changed: false,
    })
    // 반면 실제로 늘어난 빈 줄은 추가로 보인다.
    expect(shape('가.\n나.\n', '가.\n나.\n\n')).toEqual([
      '1/1 context 가.',
      '2/2 context 나.',
      '-/3 added ',
    ])
  })
})

describe('아주 큰 입력', () => {
  /*
   * 한도를 넘는 입력에서 정확한 줄 대응 대신 통째 교체로 떨어지는지 본다. 여기서 확인할 것은
   * diff 의 모양보다 **끝난다는 사실** 이다 — 한도가 없으면 이 테스트가 수십 초를 먹거나
   * 메모리를 다 쓴다.
   */
  it('표 한도를 넘으면 바뀐 구간을 통째 교체로 보이고 제때 끝난다', () => {
    const before = Array.from({ length: 2200 }, (_, index) => `원본 ${index}.`).join('\n')
    const after = Array.from({ length: 2200 }, (_, index) => `수정 ${index}.`).join('\n')

    const lines = diffLines(before, after)
    const summary = summarizeDiff(lines)

    expect(summary).toEqual({ added: 2200, removed: 2200, changed: true })
    // 삭제가 전부 앞에 오고 추가가 뒤따른다.
    expect(lines[0]?.kind).toBe('removed')
    expect(lines[2199]?.kind).toBe('removed')
    expect(lines[2200]?.kind).toBe('added')
    // 줄 번호는 통째 교체에서도 각자 1부터 이어진다.
    expect(lines[0]?.beforeLine).toBe(1)
    expect(lines[2200]?.afterLine).toBe(1)
  })

  it('한도 안에서는 앞뒤 공통 줄을 그대로 알아본다', () => {
    const middle = Array.from({ length: 40 }, (_, index) => `본문 ${index}.`)
    const before = ['머리.', ...middle, '꼬리.'].join('\n')
    const after = ['머리.', ...middle, '새 줄.', '꼬리.'].join('\n')

    expect(summarizeDiff(diffLines(before, after))).toEqual({
      added: 1,
      removed: 0,
      changed: true,
    })
  })
})

describe('toHunks', () => {
  it('변경이 없으면 hunk 도 없다', () => {
    expect(toHunks(diffLines('가.\n나.', '가.\n나.'))).toEqual([])
  })

  it('context 안에 들어오는 짧은 간격은 접지 않는다', () => {
    const before = '1.\n2.\n3.\n4.\n5.'
    const after = '1x.\n2.\n3.\n4.\n5x.'

    const [only, ...rest] = toHunks(diffLines(before, after), 2)

    expect(rest).toHaveLength(0)
    expect(only?.skippedBefore).toBe(0)
  })
})
