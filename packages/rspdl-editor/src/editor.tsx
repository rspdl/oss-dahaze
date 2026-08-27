'use client'

/**
 * RSPDL 편집기.
 *
 * **데이터를 가져오지 않는다.** 텍스트도 진단도 props 로 받는다 (ADR-0006). 편집기가 문서를
 * 스스로 불러오면 스토리북·테스트에서 못 쓰게 되고, 서버 계약이 바뀔 때 같이 깨진다.
 *
 * React 는 값을 소유하고 CodeMirror 는 자기 문서를 소유한다. 둘이 같은 상태를 들고 있으므로
 * 동기화 지점을 하나로 좁혀 두는 것이 이 파일의 대부분이다.
 */

import { useEffect, useRef } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { setDiagnostics } from '@codemirror/lint'
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
  type DecorationSet,
} from '@codemirror/view'

import {
  toCodeMirrorDiagnostics,
  type RspdlDiagnostic,
  type ToCodeMirrorOptions,
} from './diagnostics'
import { rspdl } from './language'
import { spanToRange, type ByteSpan, type TextRange } from './offsets'

export interface RspdlEditorProps {
  /** 편집기에 보일 텍스트. 이 값이 진실이고 CodeMirror 는 그것을 비출 뿐이다. */
  value: string
  /** 사용자가 친 결과. 없으면 사실상 읽기 전용처럼 동작한다. */
  onChange?: (value: string) => void
  /**
   * 컴파일러가 준 진단. **`value` 와 같은 텍스트에서 나온 것이어야 한다** — 위치가 바이트
   * 오프셋이라 다른 텍스트의 진단을 얹으면 엉뚱한 곳에 밑줄이 그어진다.
   */
  diagnostics?: readonly RspdlDiagnostic[]
  /**
   * 바깥의 문제 목록 등에서 선택한 컴파일러 span. 값이 바뀌면 해당 범위를 화면 가운데로
   * 옮기고 하이라이트한다. 하이라이트는 사용자가 문서를 편집하거나 다른 span 이 오거나
   * `null` 이 될 때까지 남는다. 포커스는 옮기지 않는다 — `revealByteSpan` 주석 참고.
   * span 은 UTF-16 인덱스가 아니라 UTF-8 바이트다.
   */
  revealSpan?: ByteSpan | null
  /** 읽기 전용. 리비전 열람처럼 편집이 의미 없는 화면에서 쓴다. */
  readOnly?: boolean
  /** 빈 문서에 보일 안내. */
  placeholder?: string
  /** 스크린 리더가 읽을 이름. 편집 영역이 여러 개인 화면에서 필요하다. */
  ariaLabel?: string
  /** `message_key` 를 사람 말로 바꾸는 함수. 번역표는 이 패키지가 갖지 않는다. */
  renderMessage?: ToCodeMirrorOptions['renderMessage']
  className?: string
}

/**
 * 드러낼 범위를 바꾼다. `null` 이면 지운다. 단위는 이미 변환된 UTF-16 범위다 —
 * 바이트 변환은 `revealByteSpan` 한 곳에서만 한다.
 */
export const setRevealRange = StateEffect.define<TextRange | null>()

const revealMark = Decoration.mark({ class: 'cm-rspdlRevealRange' })

/**
 * "문제 위치로 이동" 이 가리킨 범위를 **지속되는 데코레이션**으로 표시한다.
 *
 * 선택(selection)으로 표시하지 않는 이유: 선택은 사용자가 어디든 클릭하는 순간 사라진다.
 * 문제 지점은 사용자가 그 문장을 고치는 동안 계속 보여야 한다.
 */
export const revealRangeField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(value, tr) {
    /*
     * 문서가 바뀌면 하이라이트를 지운다. 진단과 같은 원칙이다 — span 은 컴파일 당시 텍스트의
     * 바이트 오프셋이라, 한 글자만 쳐도 이 범위가 가리키는 곳은 더 이상 그 문제가 아니다.
     * 어긋난 강조는 없느니만 못하다. 그래서 위치를 map 하지 않고 버린다.
     */
    let next = tr.docChanged ? Decoration.none : value
    for (const effect of tr.effects) {
      if (!effect.is(setRevealRange)) continue
      const range = effect.value
      // 새 범위가 오면 이전 것을 갈아 끼운다. 두 곳이 동시에 빛나면 어디를 보라는 건지 알 수 없다.
      next = toRevealDecorations(tr.state.doc.length, range)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

/**
 * 범위 → 데코레이션. 문서 밖으로 나간 범위는 잘라내고, 남은 것이 빈 범위면 표시하지 않는다.
 * `Decoration.mark` 는 빈 범위를 거부한다 — 어차피 칠할 글자가 없으니 스크롤만 하고 만다.
 */
function toRevealDecorations(docLength: number, range: TextRange | null): DecorationSet {
  if (range === null) return Decoration.none
  const from = Math.max(0, Math.min(range.from, docLength))
  const to = Math.max(from, Math.min(range.to, docLength))
  if (from === to) return Decoration.none
  return Decoration.set([revealMark.range(from, to)])
}

/**
 * 외부에서 고른 컴파일러 span 을 현재 CodeMirror 문서에 드러낸다.
 *
 * props 의 `value` 대신 view 의 문서를 읽어야 controlled 값 동기화와 같은 트랜잭션 순서를
 * 따른다. 이 함수는 DOM 없이 트랜잭션을 검증할 수 있도록 분리해 둔다.
 *
 * 선택은 그대로 남긴다. 지속 표시는 데코레이션이 맡지만, 캐럿까지 그 자리에 두면 사용자가
 * 나중에 편집기를 클릭했을 때 바로 그 문장에서 이어 칠 수 있다.
 *
 * 다만 **포커스는 빼앗지 않는다.** 이 함수를 부르는 사람은 대개 오른쪽 AI 패널의 버튼을 누른
 * 참이고, 거기서 커서를 낚아채면 하던 흐름이 끊긴다. 보여 주는 것과 조작 권한을 넘겨받는
 * 것은 다른 일이다 — 편집하고 싶으면 사용자가 편집기를 누른다.
 */
export function revealByteSpan(view: EditorView, span: ByteSpan): void {
  const range = spanToRange(view.state.doc.toString(), span)
  view.dispatch({
    selection: { anchor: range.from, head: range.to },
    effects: [
      setRevealRange.of(range),
      EditorView.scrollIntoView(range.from, { y: 'center' }),
    ],
  })
}

/** 드러낸 범위를 지운다. 바깥에서 선택이 풀렸을 때 쓴다. */
export function clearRevealHighlight(view: EditorView): void {
  view.dispatch({ effects: setRevealRange.of(null) })
}

/**
 * 색은 전부 design-system 토큰을 참조한다.
 *
 * 라이트·다크로 테마를 두 벌 만들지 않는다. `.dark` 가 켜지면 토큰 값이 바뀌고 편집기는
 * 그대로 따라온다 — 두 벌을 만들면 한쪽만 고치는 날이 반드시 온다.
 */
const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    height: '100%',
    // RSPDL 소스는 한글과 라틴 문자가 섞인다. 한글 글리프가 있는 등폭 글꼴이 앞에 있는
    // `--font-mono` 를 그대로 쓴다.
    fontFamily: 'var(--font-mono)',
    fontSize: '0.875rem',
  },
  '&.cm-focused': {
    // 전역 `:focus-visible` 윤곽선은 CodeMirror 내부 요소에 걸려 이중으로 보인다.
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.7',
  },
  '.cm-content': {
    caretColor: 'var(--color-accent)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-subtle)',
    borderRight: '1px solid var(--color-border)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--color-surface-raised)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--color-surface-raised)',
    color: 'var(--color-text-muted)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-accent)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor: 'var(--color-accent-subtle)',
    },
  /*
   * 진단 밑줄. **색만으로 구분하지 않는다** — 물결선의 색이 error 와 warning 을 나누는
   * 유일한 신호가 되면 색각 이상 사용자에게는 같은 표시다. 굵기를 함께 달리하고,
   * 진짜 구분은 목록 쪽 `DiagnosticBadge` 의 아이콘·글자가 맡는다.
   */
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--color-diagnostic-error)',
    textDecorationThickness: '2px',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--color-diagnostic-warning)',
    textDecorationThickness: '1px',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-info': {
    backgroundImage: 'none',
    textDecoration: 'underline dotted var(--color-diagnostic-info)',
    textDecorationThickness: '1px',
    textUnderlineOffset: '3px',
  },
  /*
   * "문제 위치로 이동" 이 가리킨 범위. 진단 밑줄과 겹쳐 그려지므로 밑줄을 덮지 않는
   * 배경과 왼쪽 테두리로만 표시한다. 배경은 `-subtle` 토큰이라 글자 대비를 해치지 않는다.
   */
  '.cm-rspdlRevealRange': {
    backgroundColor: 'var(--color-accent-subtle)',
    boxShadow: 'inset 2px 0 0 0 var(--color-accent)',
    borderRadius: 'var(--radius-control)',
    // 한 번 번쩍인 뒤 은은하게 남는다. 스크롤이 끝난 자리가 어디였는지 눈이 따라가야 한다.
    animation: 'cm-rspdlRevealPulse 900ms ease-out 1',
  },
  /*
   * 펄스는 글자 뒤가 아니라 **범위 바깥으로 퍼지는 링**으로 준다. 배경색을 진한 accent 로
   * 번쩍이면 그 순간 글자를 읽을 수 없다 — 보여 주려고 켠 표시가 내용을 가리면 안 된다.
   */
  '@keyframes cm-rspdlRevealPulse': {
    '0%': {
      boxShadow:
        'inset 2px 0 0 0 var(--color-accent), 0 0 0 4px var(--color-accent-subtle)',
    },
    '100%': {
      boxShadow: 'inset 2px 0 0 0 var(--color-accent), 0 0 0 0 transparent',
    },
  },
  /*
   * 움직임을 줄여 달라고 한 사용자에게는 펄스를 주지 않는다. 표시 자체는 배경과 테두리로
   * 남으므로 정보를 잃지 않는다.
   */
  '@media (prefers-reduced-motion: reduce)': {
    '.cm-rspdlRevealRange': {
      animation: 'none',
    },
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--color-surface-raised)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-control)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-sans)',
  },
  '.cm-diagnostic': {
    padding: '0.375rem 0.5rem',
  },
  '.cm-diagnosticSource': {
    color: 'var(--color-text-muted)',
    fontSize: '0.75rem',
  },
})

export function RspdlEditor({
  value,
  onChange,
  diagnostics,
  revealSpan,
  readOnly = false,
  placeholder,
  ariaLabel,
  renderMessage,
  className,
}: RspdlEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const readOnlyCompartment = useRef(new Compartment())

  /*
   * 콜백을 ref 에 담아 두는 이유: props 가 바뀔 때마다 EditorView 를 다시 만들면 커서와
   * 실행 취소 이력이 매 입력마다 날아간다. 확장은 마운트 때 한 번만 만들고, 최신 콜백은
   * 여기서 읽는다.
   */
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      rspdl(),
      revealRangeField,
      editorTheme,
      readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        onChangeRef.current?.(update.state.doc.toString())
      }),
    ]

    if (placeholder !== undefined) extensions.push(placeholderExtension(placeholder))
    if (ariaLabel !== undefined) {
      extensions.push(EditorView.contentAttributes.of({ 'aria-label': ariaLabel }))
    }

    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: value, extensions }),
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 의존성이 비어 있는 것은 실수가 아니다. 마운트에 한 번만 EditorView 를 만들고,
    // 이후 변화는 아래 effect 들이 dispatch 로 반영한다. props 를 여기 넣으면 입력할 때마다
    // 편집기가 통째로 다시 만들어져 커서와 실행 취소 이력이 사라진다.
  }, [])

  // 바깥에서 값이 바뀌었을 때만 문서를 갈아 끼운다. 사용자가 방금 친 글자로 인해 돌아온
  // 값까지 다시 넣으면 커서가 매 타자마다 끝으로 튄다.
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    })
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        EditorState.readOnly.of(readOnly),
      ),
    })
  }, [readOnly])

  /*
   * 진단은 **편집기가 들고 있는 텍스트** 기준으로 변환한다. props 의 `value` 를 쓰면 위의
   * 문서 교체 effect 보다 이 effect 가 먼저 도는 렌더에서 한 프레임 어긋난다.
   */
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    const text = view.state.doc.toString()
    view.dispatch(
      setDiagnostics(
        view.state,
        toCodeMirrorDiagnostics(text, diagnostics ?? [], { renderMessage }),
      ),
    )
  }, [diagnostics, renderMessage, value])

  /*
   * 문서 교체 effect 뒤에 둔다. `value` 와 `revealSpan` 이 한 렌더에서 함께 바뀌어도 앞의
   * effect 가 새 문서를 먼저 넣는다. `value` 는 의존성에 넣지 않는다. 사용자가 문제 위치로
   * 이동한 뒤 타자를 칠 때마다 같은 범위를 다시 선택하면 편집할 수 없기 때문이다.
   */
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    // 바깥에서 선택이 풀리면(`null`) 하이라이트도 함께 걷는다. 남겨 두면 이미 닫힌 문제를
    // 계속 가리키게 된다.
    if (revealSpan == null) {
      clearRevealHighlight(view)
      return
    }
    revealByteSpan(view, revealSpan)
  }, [revealSpan])

  return <div ref={hostRef} className={className} />
}
