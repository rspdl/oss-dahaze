import { describe, expect, it } from 'vitest'

import type { SemanticProposal } from '@/features/mockup/prototype-contract'
import { utf8Sha256 } from './document-hash'
import { buildEdit } from './planning-edit-contract'

const form = { kind: 'heading' as const, elementId: 'unused', value: '', secondaryValue: '', parentId: '', beforeId: '', slot: 'root' as const, label: '' }

describe('planning edit document hash', () => {
  it('hashes the exact UTF-8 bytes without newline or normalization changes', async () => {
    expect(await utf8Sha256('한글\r\n😀e\u0301')).toBe('225c414e6d5ae26f29f2aa998776ce0e29561adf160faa0753bc3948afc72fd7')
  })
})

describe('typed path edit request', () => {
  it('sends a canonical outcome and an exclusive handler endpoint', () => {
    const proposal: SemanticProposal = { kind: 'connect', sourceScreenKey: 'input.rspdl:booking.lookup', sourceElementId: 'lookup', outcomeId: 'booking.lookup.not_found', targetScreenId: null, handler: { kind: 'message', id: 'missing', content: '예약을 찾지 못했습니다.' }, label: null }
    expect(buildEdit(proposal, 'booking.lookup', form)).toEqual({
      operation: 'connect',
      source_screen_id: 'booking.lookup',
      source_element_id: 'lookup',
      outcome_id: 'booking.lookup.not_found',
      target_screen_id: null,
      handler: { kind: 'message', id: 'missing', content: '예약을 찾지 못했습니다.' },
      label: null,
    })
  })

  it('preserves every nullable identity field when disconnecting a navigation path', () => {
    const proposal: SemanticProposal = { kind: 'disconnect', sourceScreenKey: 'input.rspdl:booking.lookup', sourceElementId: 'lookup', outcomeId: 'booking.lookup.found', targetScreenId: 'booking.done', handler: null, label: '예약 확인' }
    expect(buildEdit(proposal, 'booking.lookup', form)).toEqual({
      operation: 'disconnect',
      source_screen_id: 'booking.lookup',
      source_element_id: 'lookup',
      outcome_id: 'booking.lookup.found',
      target_screen_id: 'booking.done',
      handler: null,
      label: '예약 확인',
    })
  })
})
