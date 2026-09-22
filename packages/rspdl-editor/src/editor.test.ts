import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'

import {
  clearRevealHighlight,
  revealByteSpan,
  revealRangeField,
  setRevealRange,
} from './editor'
import type { TextRange } from './offsets'

/** DecorationSet 을 눈으로 볼 수 있는 범위 목록으로. jsdom 없이 필드만 검증하기 위해서다. */
function highlightedRanges(state: EditorState): TextRange[] {
  const ranges: TextRange[] = []
  state.field(revealRangeField).between(0, state.doc.length, (from, to) => {
    ranges.push({ from, to })
  })
  return ranges
}

function stateWith(doc: string, range: TextRange | null): EditorState {
  const initial = EditorState.create({ doc, extensions: [revealRangeField] })
  return initial.update({ effects: setRevealRange.of(range) }).state
}

describe('revealByteSpan', () => {
  it('UTF-8 바이트 span 을 현재 문서의 UTF-16 선택 범위로 바꾼다', () => {
    const source = '정책 이름\n예약을 취소한다.\n다음 정책'
    const selected = '예약을 취소한다.'
    const start = new TextEncoder().encode('정책 이름\n').length
    const end = start + new TextEncoder().encode(selected).length
    const dispatch = vi.fn()
    const focus = vi.fn()
    const view = {
      state: EditorState.create({ doc: source }),
      dispatch,
      focus,
    } as unknown as EditorView

    revealByteSpan(view, { start, end })

    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: {
          anchor: source.indexOf(selected),
          head: source.indexOf(selected) + selected.length,
        },
        effects: expect.anything(),
      }),
    )
    // 포커스를 빼앗지 않는 것이 계약이다. 사용자는 대개 AI 패널에서 버튼을 누르고 온다.
    expect(focus).not.toHaveBeenCalled()
  })

  it('범위를 벗어난 span 은 문서 끝의 빈 선택으로 안전하게 자른다', () => {
    const source = '짧은 문서'
    const dispatch = vi.fn()
    const view = {
      state: EditorState.create({ doc: source }),
      dispatch,
      focus: vi.fn(),
    } as unknown as EditorView

    revealByteSpan(view, { start: 999, end: 1000 })

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: source.length, head: source.length },
      }),
    )
  })

  it('하이라이트 effect 를 문자 range 로 함께 실어 보낸다', () => {
    const source = '정책 이름\n예약을 취소한다.'
    const selected = '예약을 취소한다.'
    const start = new TextEncoder().encode('정책 이름\n').length
    const end = start + new TextEncoder().encode(selected).length
    let state = EditorState.create({ doc: source, extensions: [revealRangeField] })
    const view = {
      get state() {
        return state
      },
      dispatch: (spec: Parameters<EditorState['update']>[0]) => {
        state = state.update(spec).state
      },
      focus: vi.fn(),
    } as unknown as EditorView

    revealByteSpan(view, { start, end })

    expect(highlightedRanges(state)).toEqual([
      { from: source.indexOf(selected), to: source.length },
    ])
  })
})

describe('revealRangeField', () => {
  it('문서를 편집하면 하이라이트를 버린다', () => {
    const state = stateWith('예약을 취소한다.', { from: 0, to: 3 })
    expect(highlightedRanges(state)).toHaveLength(1)

    const edited = state.update({ changes: { from: 0, insert: '새 ' } }).state

    // 위치를 map 하지 않는다. 한 글자만 쳐도 컴파일 당시 span 은 더 이상 그 문제가 아니다.
    expect(highlightedRanges(edited)).toEqual([])
  })

  it('새 range 는 이전 하이라이트를 교체한다', () => {
    const state = stateWith('예약을 취소한다.', { from: 0, to: 3 })
    const next = state.update({ effects: setRevealRange.of({ from: 4, to: 8 }) }).state

    expect(highlightedRanges(next)).toEqual([{ from: 4, to: 8 }])
  })

  it('null 이 오면 하이라이트를 걷는다', () => {
    const state = stateWith('예약을 취소한다.', { from: 0, to: 3 })
    let cleared = state
    const view = {
      dispatch: (spec: Parameters<EditorState['update']>[0]) => {
        cleared = cleared.update(spec).state
      },
    } as unknown as EditorView

    clearRevealHighlight(view)

    expect(highlightedRanges(cleared)).toEqual([])
  })

  it('문서 밖 range 는 문서 끝으로 자르고, 빈 범위는 표시하지 않는다', () => {
    const doc = '짧은 문서'
    expect(highlightedRanges(stateWith(doc, { from: 2, to: 999 }))).toEqual([
      { from: 2, to: doc.length },
    ])
    expect(highlightedRanges(stateWith(doc, { from: 999, to: 1000 }))).toEqual([])
    expect(highlightedRanges(stateWith(doc, { from: 2, to: 2 }))).toEqual([])
  })
})
