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
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
} from '@codemirror/view'

import {
  toCodeMirrorDiagnostics,
  type RspdlDiagnostic,
  type ToCodeMirrorOptions,
} from './diagnostics'
import { rspdl } from './language'

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

  return <div ref={hostRef} className={className} />
}
