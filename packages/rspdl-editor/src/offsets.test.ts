import { describe, expect, it } from 'vitest'

import { byteOffsetToIndex, spanToLineColumn, spanToRange } from './offsets'

/**
 * 이 변환이 틀리면 모든 진단이 엉뚱한 곳에 표시된다. 그리고 영어 예제만으로 테스트하면
 * 통과한다 — 오차가 멀티바이트 문자에서만 생기기 때문이다. 한글을 기본 사례로 둔다.
 */

describe('byteOffsetToIndex', () => {
  it('ASCII 는 바이트와 인덱스가 같다', () => {
    const text = 'module inventory'
    expect(byteOffsetToIndex(text, 7)).toBe(7)
  })

  it('한글은 문자당 3바이트다', () => {
    const text = '재고 항목'
    //           재(3) 고(3) ' '(1) 항(3) 목(3)
    expect(byteOffsetToIndex(text, 0)).toBe(0)
    expect(byteOffsetToIndex(text, 3)).toBe(1)
    expect(byteOffsetToIndex(text, 6)).toBe(2)
    expect(byteOffsetToIndex(text, 7)).toBe(3)
    expect(byteOffsetToIndex(text, 13)).toBe(5)
  })

  it('이모지는 UTF-8 4바이트 / UTF-16 2유닛이다', () => {
    const text = 'a🎉b'
    expect(byteOffsetToIndex(text, 1)).toBe(1)
    // 이모지 뒤 = 바이트 5, 문자열 인덱스 3 (서로게이트 페어)
    expect(byteOffsetToIndex(text, 5)).toBe(3)
  })

  it('문자 중간을 가리키면 그 문자의 시작으로 내린다', () => {
    const text = '재고'
    // 바이트 1·2 는 '재' 의 중간이다. 잘린 문자를 만들지 않는다.
    expect(byteOffsetToIndex(text, 1)).toBe(0)
    expect(byteOffsetToIndex(text, 2)).toBe(0)
  })

  it('범위를 벗어나면 던지지 않고 잘라낸다', () => {
    const text = '재고'
    expect(byteOffsetToIndex(text, -5)).toBe(0)
    expect(byteOffsetToIndex(text, 9999)).toBe(text.length)
  })

  it('빈 문자열도 안전하다', () => {
    expect(byteOffsetToIndex('', 0)).toBe(0)
    expect(byteOffsetToIndex('', 10)).toBe(0)
  })
})

describe('spanToRange', () => {
  /**
   * 실제 rspdl 0.1.0 이 낸 진단이다. 아래 소스는 문장이 마침표 없이 끝나 거부되고,
   * `RSPDL-KO-SYN-004` 가 span 27..89 로 돌아온다 (문자 48개 / 바이트 90개).
   *
   * 문자 오프셋으로 자르면 'em)은 다음 …' 이 나오고, 바이트로 잘라야 문장 전체가 나온다.
   */
  const SOURCE =
    '@모듈 재고(inventory)\n\n재고 항목(item)은 다음 필드들로 구성되어 있다\n'

  it('컴파일러가 실제로 낸 span 이 의도한 문장을 가리킨다', () => {
    expect(SOURCE.length).toBe(48)
    expect(new TextEncoder().encode(SOURCE).length).toBe(90)

    const { from, to } = spanToRange(SOURCE, { start: 27, end: 89 })

    expect(SOURCE.slice(from, to)).toBe(
      '재고 항목(item)은 다음 필드들로 구성되어 있다',
    )
  })

  it('문자 오프셋을 그대로 쓰면 어긋난다 — 이 테스트가 지키는 것이 그것이다', () => {
    // 변환하지 않았을 때 무엇이 나오는지 못박아 둔다.
    expect(SOURCE.slice(27, 89)).toBe('em)은 다음 필드들로 구성되어 있다\n')
  })

  it('뒤집힌 범위는 빈 범위로 접는다', () => {
    const { from, to } = spanToRange('재고 항목', { start: 9, end: 3 })
    expect(to).toBe(from)
  })
})

describe('spanToLineColumn', () => {
  const SOURCE = '@모듈 재고(inventory)\n\n재고 항목(item)은\n'

  it('행과 열을 1부터 센다', () => {
    expect(spanToLineColumn(SOURCE, { start: 0, end: 0 })).toEqual({
      line: 1,
      column: 1,
    })
  })

  it('한글이 앞선 줄에서도 열이 맞는다', () => {
    // 3행 시작 = '@모듈 재고(inventory)\n\n' 이후. 바이트로 27.
    const { line, column } = spanToLineColumn(SOURCE, { start: 27, end: 27 })
    expect(line).toBe(3)
    expect(column).toBe(1)
  })

  it('열은 코드 포인트로 센다 — 이모지가 두 칸이 되지 않는다', () => {
    const text = 'a🎉b'
    // 'b' 는 바이트 5. 사람이 보기에 3번째 글자다.
    expect(spanToLineColumn(text, { start: 5, end: 6 }).column).toBe(3)
  })
})
