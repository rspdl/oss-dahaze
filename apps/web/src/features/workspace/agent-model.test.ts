import type { AgentItemResponse } from '@dahaze/api-client'
import { describe, expect, it } from 'vitest'

import { changeStats, resultSummary, toAgentRows, toolTitle } from './agent-model'

let seq = 0
function item(kind: AgentItemResponse['kind'], payload: Record<string, unknown>): AgentItemResponse {
  seq += 1
  return {
    id: `item-${seq}`,
    session_id: 's1',
    turn_id: 't1',
    seq,
    kind,
    payload,
    created_at: '2026-09-26T00:00:00Z',
  }
}

describe('toAgentRows', () => {
  it('pairs tool calls with their results by call_id', () => {
    const rows = toAgentRows([
      item('user_message', { text: '결제 모델을 추가해 줘' }),
      item('tool_call', { call_id: 'c1', name: 'edit', arguments: { path: '/주문.rspdl' } }),
      item('tool_result', {
        call_id: 'c1',
        name: 'edit',
        ok: true,
        output: '저장했어요',
        changes: [
          { path_before: '/주문.rspdl', path_after: '/주문.rspdl', text_before: 'a\n', text_after: 'a\nb\n' },
        ],
      }),
      item('assistant_message', { text: '추가했어요.' }),
    ])

    expect(rows.map((row) => row.kind)).toEqual(['user', 'tool', 'assistant'])
    const tool = rows[1]!
    expect(tool.kind === 'tool' && tool.result?.changes[0]?.textAfter).toBe('a\nb\n')
  })

  it('leaves the result empty while the tool runs', () => {
    const rows = toAgentRows([item('tool_call', { call_id: 'c2', name: 'compile', arguments: {} })])
    expect(rows[0]!.kind === 'tool' && rows[0]!.result).toBeNull()
  })

  it('keeps an orphan result as its own card', () => {
    const rows = toAgentRows([item('tool_result', { call_id: 'c3', name: 'ls', ok: false, output: '없어요' })])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.kind === 'tool' && rows[0]!.result?.ok).toBe(false)
  })

  it('does not throw on unknown payload shapes', () => {
    expect(() => toAgentRows([item('tool_result', { changes: 'nope' })])).not.toThrow()
  })
})

describe('changeStats', () => {
  it('counts added and removed lines across files, treating add and delete as empty sides', () => {
    expect(
      changeStats([
        { pathBefore: null, pathAfter: '/새.rspdl', textBefore: null, textAfter: '가\n나\n' },
        { pathBefore: '/옛.rspdl', pathAfter: null, textBefore: '다\n', textAfter: null },
      ]),
    ).toEqual({ added: 2, removed: 1 })
  })
})

describe('toolTitle', () => {
  it('shows the most relevant argument per tool', () => {
    expect(toolTitle('edit', { path: '/주문.rspdl' })).toBe('Edit(/주문.rspdl)')
    expect(toolTitle('add', { parent: '/', name: '결제.rspdl' })).toBe('Add(/결제.rspdl)')
    expect(toolTitle('add', { parent: '/주문', name: '결제.rspdl' })).toBe('Add(/주문/결제.rspdl)')
    expect(toolTitle('mv', { from: '/a.rspdl', to: '/b.rspdl' })).toBe('Mv(/a.rspdl → /b.rspdl)')
    expect(toolTitle('search', { query: '재고' })).toBe('Search(재고)')
    expect(toolTitle('fetch', { id: 'inventory.item', owner_id: '' })).toBe('Fetch(inventory.item)')
    expect(toolTitle('compile', {})).toBe('Compile')
  })
})

describe('resultSummary', () => {
  it('uses the first line of text, counts lists, and skips other objects', () => {
    expect(resultSummary({ ok: true, output: '첫 줄\n둘째 줄', changes: [] })).toBe('첫 줄')
    expect(resultSummary({ ok: true, output: [1, 2, 3], changes: [] })).toBe('3건')
    expect(resultSummary({ ok: false, output: { message: '잠긴 파일이에요' }, changes: [] })).toBe('잠긴 파일이에요')
    expect(resultSummary({ ok: true, output: { files: [] }, changes: [] })).toBeNull()
  })
})
