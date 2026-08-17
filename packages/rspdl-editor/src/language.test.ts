import { StringStream } from '@codemirror/language'
import { describe, expect, it } from 'vitest'

import { rspdlStreamParser } from './language'

/**
 * 강조는 "무엇을 칠하는가" 만큼 "무엇을 안 칠하는가" 가 중요하다. RSPDL 문장은 한국어
 * 산문이고, 산문을 칠하기 시작하면 읽기가 더 어려워진다. 그래서 한글 본문이 `null` 로
 * 남는 것도 함께 못박는다.
 */

interface Token {
  text: string
  style: string | null
}

/** 한 줄을 토큰으로 쪼갠다. `null` 은 칠하지 않는다는 뜻이다. */
function tokenize(line: string): Token[] {
  const stream = new StringStream(line, 4, 4)
  const state = rspdlStreamParser.startState!(4)
  const tokens: Token[] = []

  while (!stream.eol()) {
    const start = stream.pos
    const style = rspdlStreamParser.token(stream, state)
    // 토크나이저가 한 칸도 못 나가면 무한 루프다. 테스트가 멈추는 대신 실패하게 둔다.
    expect(stream.pos).toBeGreaterThan(start)
    tokens.push({ text: line.slice(start, stream.pos), style })
    stream.start = stream.pos
  }

  return tokens
}

/** 특정 스타일이 붙은 조각만 모은다. */
function textsWithStyle(line: string, style: string): string[] {
  return tokenize(line)
    .filter((token) => token.style === style)
    .map((token) => token.text)
}

describe('RSPDL 언어 모드', () => {
  it('`@모듈` 문서 메타데이터를 표시한다', () => {
    expect(textsWithStyle('@모듈 재고(inventory)', 'rspdlAnnotation')).toEqual([
      '@모듈',
    ])
  })

  it('괄호 안 라틴 식별자를 표시하고 괄호는 흐리게 둔다', () => {
    const line = '재고 항목(item)은 다음 필드들로 구성되어 있다.'

    expect(textsWithStyle(line, 'rspdlIdentifier')).toEqual(['item'])
    expect(textsWithStyle(line, 'rspdlPunctuation')).toEqual(['(', ')'])
  })

  it('밑줄이 든 식별자도 하나로 본다', () => {
    expect(
      textsWithStyle(
        '장바구니 작성 화면(create_cart)에서는 장바구니를 생성할 수 있다.',
        'rspdlIdentifier',
      ),
    ).toEqual(['create_cart'])
  })

  it('한 줄에 여러 식별자가 있어도 상태가 새지 않는다', () => {
    expect(
      textsWithStyle(
        '프로젝트(project)는 사용자(user)를 소유자(owner)로 가질 수 있다.',
        'rspdlIdentifier',
      ),
    ).toEqual(['project', 'user', 'owner'])
  })

  it('한글이 든 괄호는 본문이므로 칠하지 않는다', () => {
    const line = '수량(개수)은 정수다.'

    expect(textsWithStyle(line, 'rspdlIdentifier')).toEqual([])
    expect(textsWithStyle(line, 'rspdlPunctuation')).toEqual([])
  })

  it('제약의 경계값을 숫자로 표시한다', () => {
    expect(
      textsWithStyle('재고 항목의 수량은 0 이상이어야 한다.', 'rspdlNumber'),
    ).toEqual(['0'])
  })

  it('`#` 주석은 줄 끝까지 주석이다', () => {
    expect(
      textsWithStyle('    # 금액(amount)은 나중에 정한다', 'rspdlComment'),
    ).toEqual(['# 금액(amount)은 나중에 정한다'])
  })

  it('주석 안의 식별자와 숫자는 따로 칠하지 않는다', () => {
    const line = '# (item) 3'

    expect(textsWithStyle(line, 'rspdlIdentifier')).toEqual([])
    expect(textsWithStyle(line, 'rspdlNumber')).toEqual([])
  })

  it('한글 본문은 칠하지 않는다 — 산문을 칠하면 읽기 어려워진다', () => {
    const styles = tokenize('다음 필드들로 구성되어 있다.').map(
      (token) => token.style,
    )

    expect(styles.every((style) => style === null)).toBe(true)
  })

  it('닫히지 않은 괄호에서도 멈추지 않는다', () => {
    // 문법 오류지만 사용자는 이걸 지나가며 친다. 편집기가 여기서 죽으면 안 된다.
    expect(() => tokenize('재고 항목(item')).not.toThrow()
    expect(textsWithStyle('재고 항목(item', 'rspdlIdentifier')).toEqual([])
  })

  it('줄 주석 토큰을 languageData 로 알린다', () => {
    expect(rspdlStreamParser.languageData?.commentTokens).toEqual({ line: '#' })
  })
})
