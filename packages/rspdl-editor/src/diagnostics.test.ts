import { describe, expect, it } from 'vitest'

import {
  highestSeverity,
  toCodeMirrorDiagnostics,
  type RspdlDiagnostic,
} from './diagnostics'

/**
 * 이 파일이 지키는 것은 하나다: **진단 위치가 한국어에서도 맞는가.**
 *
 * ASCII 소스만으로 테스트하면 `spanToRange` 를 통째로 지워도 전부 통과한다. 바이트와
 * UTF-16 인덱스가 같아지기 때문이다. 그래서 기준 사례를 한국어로 둔다 — 그것이 RSPDL 의
 * 기본 상황이기도 하다 (ADR-0006).
 */

/** 실제 rspdl 0.1.0 이 낸 진단의 소스. 문자 48개 / UTF-8 90바이트. */
const KOREAN_SOURCE =
  '@모듈 재고(inventory)\n\n재고 항목(item)은 다음 필드들로 구성되어 있다\n'

function diagnostic(overrides: Partial<RspdlDiagnostic> = {}): RspdlDiagnostic {
  return {
    rule_id: 'RSPDL-KO-SYN-004',
    severity: 'error',
    message_key: 'ko.syntax.sentence_not_terminated',
    span: { start: 27, end: 89 },
    ...overrides,
  }
}

describe('toCodeMirrorDiagnostics', () => {
  it('한국어 소스에서 진단이 의도한 문장 위에 놓인다', () => {
    const [mapped] = toCodeMirrorDiagnostics(KOREAN_SOURCE, [diagnostic()])

    expect(mapped).toBeDefined()
    expect(KOREAN_SOURCE.slice(mapped!.from, mapped!.to)).toBe(
      '재고 항목(item)은 다음 필드들로 구성되어 있다',
    )
  })

  it('span 을 그대로 쓰면 어긋난다 — 변환이 사라지면 이 테스트가 잡는다', () => {
    const [mapped] = toCodeMirrorDiagnostics(KOREAN_SOURCE, [diagnostic()])

    // 변환하지 않았을 때 나오는 값. 여기에 걸리면 어딘가에서 바이트 오프셋을 문자열
    // 인덱스로 그대로 쓰고 있다는 뜻이다.
    expect(mapped!.from).not.toBe(27)
    expect(mapped!.to).not.toBe(89)
    expect(KOREAN_SOURCE.slice(27, 89)).not.toBe(
      KOREAN_SOURCE.slice(mapped!.from, mapped!.to),
    )
  })

  it('한 줄짜리 한국어 문장에서도 정확한 낱말을 덮는다', () => {
    const source = '재고 항목의 수량은 0 이상이어야 한다.'
    // '수량' 은 UTF-8 로 앞에 '재고 항목의 ' = 3+3+1+3+3+3+1 = 17 바이트.
    const [mapped] = toCodeMirrorDiagnostics(source, [
      diagnostic({ span: { start: 17, end: 23 } }),
    ])

    expect(source.slice(mapped!.from, mapped!.to)).toBe('수량')
  })

  it('심각도와 규칙 ID 를 그대로 옮긴다 — 컴파일러 결과를 재해석하지 않는다', () => {
    const mapped = toCodeMirrorDiagnostics(KOREAN_SOURCE, [
      diagnostic({ severity: 'warning', rule_id: 'RSPDL-DATA-007' }),
    ])

    expect(mapped[0]!.severity).toBe('warning')
    expect(mapped[0]!.source).toBe('RSPDL-DATA-007')
  })

  it('렌더된 문구가 있으면 그것을, 없으면 message_key 를 보여준다', () => {
    const withMessage = toCodeMirrorDiagnostics(KOREAN_SOURCE, [
      diagnostic({ message: '문장이 마침표로 끝나지 않았습니다.' }),
    ])
    const withoutMessage = toCodeMirrorDiagnostics(KOREAN_SOURCE, [diagnostic()])

    expect(withMessage[0]!.message).toBe('문장이 마침표로 끝나지 않았습니다.')
    expect(withoutMessage[0]!.message).toBe('ko.syntax.sentence_not_terminated')
  })

  it('renderMessage 로 번역을 바깥에 맡긴다', () => {
    const mapped = toCodeMirrorDiagnostics(KOREAN_SOURCE, [diagnostic()], {
      renderMessage: (d) => `[${d.rule_id}] 번역됨`,
    })

    expect(mapped[0]!.message).toBe('[RSPDL-KO-SYN-004] 번역됨')
  })

  it('폭이 0인 진단도 한 글자를 덮어 화면에 보인다', () => {
    // 바이트 12 = '@모듈 재고' 다음. 폭이 0이면 밑줄이 그려지지 않아 사라진다.
    const [mapped] = toCodeMirrorDiagnostics(KOREAN_SOURCE, [
      diagnostic({ span: { start: 12, end: 12 } }),
    ])

    expect(mapped!.to).toBeGreaterThan(mapped!.from)
    // 한글 한 글자는 UTF-16 으로 1유닛이다. 두 유닛을 덮으면 옆 글자까지 먹은 것이다.
    expect(mapped!.to - mapped!.from).toBe(1)
  })

  it('문서 끝의 폭 0 진단은 앞 글자를 덮는다', () => {
    const source = '재고 항목'
    const [mapped] = toCodeMirrorDiagnostics(source, [
      diagnostic({ span: { start: 13, end: 13 } }),
    ])

    expect(source.slice(mapped!.from, mapped!.to)).toBe('목')
  })

  it('이모지를 반으로 자르지 않는다', () => {
    const source = 'a🎉b'
    // 바이트 1 = 이모지 시작. 폭 0이면 서로게이트 페어 전체를 덮어야 한다.
    const [mapped] = toCodeMirrorDiagnostics(source, [
      diagnostic({ span: { start: 1, end: 1 } }),
    ])

    expect(source.slice(mapped!.from, mapped!.to)).toBe('🎉')
  })

  it('빈 문서에서도 던지지 않는다', () => {
    expect(() =>
      toCodeMirrorDiagnostics('', [diagnostic({ span: { start: 0, end: 0 } })]),
    ).not.toThrow()
  })

  it('범위를 벗어난 span 이 와도 편집기를 죽이지 않는다', () => {
    const [mapped] = toCodeMirrorDiagnostics(KOREAN_SOURCE, [
      diagnostic({ span: { start: 9999, end: 99999 } }),
    ])

    expect(mapped!.from).toBeLessThanOrEqual(KOREAN_SOURCE.length)
    expect(mapped!.to).toBeLessThanOrEqual(KOREAN_SOURCE.length)
  })

  it('오름차순으로 정렬해 넘긴다 — RangeSet 이 순서를 요구한다', () => {
    const mapped = toCodeMirrorDiagnostics(KOREAN_SOURCE, [
      diagnostic({ span: { start: 27, end: 89 } }),
      diagnostic({ span: { start: 0, end: 12 } }),
    ])

    // 19 = '@모듈 재고(inventory)\n\n' 다음. 바이트 27 을 문자 인덱스로 옮긴 값이다.
    expect(mapped.map((d) => d.from)).toEqual([0, 19])
  })

  it('진단이 없으면 빈 배열이다', () => {
    expect(toCodeMirrorDiagnostics(KOREAN_SOURCE, [])).toEqual([])
  })
})

describe('highestSeverity', () => {
  it('error 가 있으면 error 다', () => {
    expect(
      highestSeverity([
        diagnostic({ severity: 'info' }),
        diagnostic({ severity: 'error' }),
        diagnostic({ severity: 'warning' }),
      ]),
    ).toBe('error')
  })

  it('error 가 없으면 warning 이다', () => {
    expect(
      highestSeverity([
        diagnostic({ severity: 'info' }),
        diagnostic({ severity: 'warning' }),
      ]),
    ).toBe('warning')
  })

  it('비어 있으면 null 이다', () => {
    expect(highestSeverity([])).toBeNull()
  })
})
