import { describe, expect, it } from 'vitest'

import type { ElementSelection } from '@/features/mockup/prototype-contract'
import type { ReadablePath } from '@/features/specification/readable-specification'
import { disconnectProposal } from './path-editor-contract'

describe('disconnect path identity', () => {
  it('copies outcome, handler content, label, and explicit null target without reinterpretation', () => {
    const selection: ElementSelection = { screenKey: 'input.rspdl:booking.lookup', elementId: 'lookup', elementKind: 'button' }
    const path = {
      outcomeId: 'booking.lookup.not_found',
      targetScreen: null,
      handler: { kind: 'popup', id: 'missing_reservation', content: '예약이 없습니다.' },
      label: '조회 실패',
    } as ReadablePath
    expect(disconnectProposal(selection, path)).toEqual({
      kind: 'disconnect',
      sourceScreenKey: 'input.rspdl:booking.lookup',
      sourceElementId: 'lookup',
      outcomeId: 'booking.lookup.not_found',
      targetScreenId: null,
      handler: { kind: 'popup', id: 'missing_reservation', content: '예약이 없습니다.' },
      label: '조회 실패',
    })
  })
})
