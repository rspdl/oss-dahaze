/**
 * RSPDL 편집기의 문법 강조.
 *
 * **Lezer 문법을 쓰지 않는다.** 문법의 유일한 해석자는 컴파일러다 (AGENTS.md). 편집기가
 * 두 번째 파서를 가지면 두 해석이 갈라지고, 편집기가 맞다고 칠한 문장을 컴파일러가 거부하는
 * 상황이 생긴다. 여기 있는 것은 파싱이 아니라 **읽기 보조**이므로 줄 단위 `StreamLanguage`
 * 면 충분하다.
 *
 * 그리고 의도적으로 조금만 칠한다. RSPDL 문장은 한국어 산문에 가깝다
 * (`재고 항목의 수량은 0 이상이어야 한다.`). 산문을 품사별로 칠하면 읽기 쉬워지는 게 아니라
 * 어려워진다 — 눈이 색을 따라가느라 문장을 못 읽는다. 그래서 **사람이 아니라 기계가 읽는
 * 부분만** 구분한다.
 *
 * - `@모듈` — 문서 메타데이터. 문서에 하나뿐이고 위치가 고정이라 눈에 띄어야 한다.
 * - `(inventory)` — stable ID. 한글 표시 이름과 붙어 있어 경계가 흐려지기 쉽다.
 * - 숫자 — 제약의 경계값(`0 이상`)이라 오타가 곧 규칙 오류가 된다.
 * - `#` 주석 — 컴파일러가 무시하는 부분이니 흐리게.
 *
 * 그 외 한글 본문은 건드리지 않는다.
 */

import {
  HighlightStyle,
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
  type StreamParser,
  type StringStream,
} from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { tags } from '@lezer/highlight'

/**
 * `(` · 식별자 · `)` 를 세 토큰으로 나눠 내보내기 위한 최소 상태.
 *
 * 통째로 한 토큰으로 내보내도 되지만, 그러면 괄호까지 같은 색이 되어 한글 표시 이름과 stable
 * ID 사이의 경계가 오히려 덜 보인다. 경계를 흐리게, 알맹이를 진하게 하는 편이 낫다.
 */
interface RspdlState {
  /** 방금 여는 괄호를 소비했다. 다음 토큰은 라틴 식별자다. */
  inIdentifier: boolean
  /** 식별자를 소비했다. 다음 토큰은 닫는 괄호다. */
  closingIdentifier: boolean
}

/** 우리가 쓰는 토큰 이름. 기본 이름표에 기대지 않고 `tokenTable` 로 직접 못박는다. */
const ANNOTATION = 'rspdlAnnotation'
const IDENTIFIER = 'rspdlIdentifier'
const PUNCTUATION = 'rspdlPunctuation'
const NUMBER = 'rspdlNumber'
const COMMENT = 'rspdlComment'

/** `(inventory)` 처럼 라틴 식별자만 감싼 괄호인지 미리 본다. 한글 괄호는 본문이므로 놔둔다. */
const PARENTHESISED_IDENTIFIER = /^\([A-Za-z_][A-Za-z0-9_]*\)/

export const rspdlStreamParser: StreamParser<RspdlState> = {
  name: 'rspdl',

  startState(): RspdlState {
    return { inIdentifier: false, closingIdentifier: false }
  },

  token(stream: StringStream, state: RspdlState): string | null {
    if (state.inIdentifier) {
      state.inIdentifier = false
      state.closingIdentifier = true
      stream.eatWhile(/[A-Za-z0-9_]/)
      return IDENTIFIER
    }

    if (state.closingIdentifier) {
      state.closingIdentifier = false
      stream.next()
      return PUNCTUATION
    }

    if (stream.eatSpace()) return null

    // 주석이 먼저다. 주석 안의 `@` 나 숫자까지 칠하면 무시되는 줄이 본문처럼 보인다.
    if (stream.peek() === '#') {
      stream.skipToEnd()
      return COMMENT
    }

    // `@` 는 현재 `@모듈` 에만 허용된다. 문법이 늘어나기 전까지 다른 annotation 은 없다.
    if (stream.peek() === '@') {
      stream.next()
      stream.eatWhile(/\S/)
      return ANNOTATION
    }

    if (stream.peek() === '(') {
      if (stream.match(PARENTHESISED_IDENTIFIER, false)) {
        stream.next()
        state.inIdentifier = true
        return PUNCTUATION
      }
      stream.next()
      return null
    }

    if (stream.match(/^\d+(?:\.\d+)?/)) return NUMBER

    // 남는 건 한글 본문이다. 한 글자씩 흘려보낸다 — 여기서 단어를 잘라내려 들면 그게 곧
    // 두 번째 파서다.
    stream.next()
    return null
  },

  /**
   * 줄이 바뀌면 괄호 상태를 버린다. RSPDL 의 `(id)` 는 줄을 넘지 않으므로, 넘어간 것처럼
   * 보인다면 그건 이미 문법 오류이고 컴파일러가 말해 줄 일이다.
   */
  blankLine(state: RspdlState): void {
    state.inIdentifier = false
    state.closingIdentifier = false
  },

  copyState(state: RspdlState): RspdlState {
    return { ...state }
  },

  languageData: {
    commentTokens: { line: '#' },
  },

  tokenTable: {
    [ANNOTATION]: tags.meta,
    [IDENTIFIER]: tags.labelName,
    [PUNCTUATION]: tags.punctuation,
    [NUMBER]: tags.number,
    [COMMENT]: tags.lineComment,
  },
}

export const rspdlLanguage = StreamLanguage.define(rspdlStreamParser)

/**
 * 강조 색.
 *
 * 값을 직접 쓰지 않고 design-system 의 CSS 변수를 참조한다. 그래야 `.dark` 가 켜질 때
 * 토큰 값만 바뀌고 편집기는 테마를 몰라도 된다 — CodeMirror 테마를 라이트·다크 두 벌
 * 만들면 반드시 한쪽이 뒤처진다.
 *
 * 문법 전용 토큰(`--color-syntax-*`)은 아직 없어서 강조 계열을 재사용한다. 종류를 늘리는
 * 대신 굵기·기울임으로 구분한 것도 같은 이유다.
 */
export const rspdlHighlightStyle = HighlightStyle.define([
  { tag: tags.meta, color: 'var(--color-syntax-meta)', fontWeight: '600' },
  { tag: tags.labelName, color: 'var(--color-syntax-identifier)' },
  { tag: tags.punctuation, color: 'var(--color-text-subtle)' },
  { tag: tags.number, color: 'var(--color-syntax-number)' },
  {
    tag: tags.lineComment,
    color: 'var(--color-syntax-comment)',
    fontStyle: 'italic',
  },
])

/** 언어 모드 + 강조. 편집기 확장으로 이것 하나만 넣으면 된다. */
export function rspdl(): LanguageSupport {
  return new LanguageSupport(rspdlLanguage, [
    syntaxHighlighting(rspdlHighlightStyle),
  ] satisfies Extension[])
}
