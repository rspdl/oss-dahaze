import { describe, expect, it } from 'vitest'

import type { ReadableSpecification } from '@/features/specification/readable-specification'
import { prototypeOutcomesByScreen } from './prototype-outcomes'

describe('prototype typed outcomes', () => {
  it('keeps canonical outcome ids and declared navigation or same-screen handlers', () => {
    const specification = {
      screens: [{
        key: 'input.rspdl:booking.lookup',
        source: { path: 'input.rspdl' },
        elements: [{
          id: 'lookup',
          outcomes: [
            { id: 'booking.lookup.found', localId: 'found', kind: 'success' },
            { id: 'booking.lookup.not_found', localId: 'not_found', kind: 'failure' },
            { id: 'booking.lookup.cached', localId: 'cached', kind: 'success' },
            { id: 'booking.lookup.help', localId: 'help', kind: 'failure' },
            { id: 'booking.lookup.waiting', localId: 'waiting', kind: 'success' },
          ],
          paths: [
            { outcomeId: 'booking.lookup.found', label: '예약 확인', targetScreen: { id: 'booking.done', name: '예약 완료 화면' }, handler: null },
            { outcomeId: 'booking.lookup.not_found', label: null, targetScreen: null, handler: { kind: 'message', id: 'missing', content: '예약을 찾지 못했습니다.' } },
            { outcomeId: 'booking.lookup.cached', label: null, targetScreen: null, handler: { kind: 'state', id: 'cached_result', content: null } },
            { outcomeId: 'booking.lookup.help', label: null, targetScreen: null, handler: { kind: 'popup', id: 'lookup_help', content: '조회 도움말' } },
            { outcomeId: 'booking.lookup.waiting', label: null, targetScreen: null, handler: { kind: 'loading', id: 'lookup_wait', content: null } },
          ],
          children: [],
        }],
      }],
    } as unknown as ReadableSpecification

    const outcomes = prototypeOutcomesByScreen(specification)['input.rspdl:booking.lookup']?.lookup
    expect(outcomes?.[0]).toEqual({ id: 'booking.lookup.found', label: '성공 · found · 예약 확인 · 이동 · 예약 완료 화면', targetScreenKey: 'input.rspdl:booking.done', handler: null })
    expect(outcomes?.[1]).toEqual({ id: 'booking.lookup.not_found', label: '실패 · not_found · 메시지 · missing', targetScreenKey: null, handler: { kind: 'message', id: 'missing', content: '예약을 찾지 못했습니다.' } })
    expect(outcomes?.slice(2).map((outcome) => outcome.handler)).toEqual([
      { kind: 'state', id: 'cached_result' },
      { kind: 'popup', id: 'lookup_help', content: '조회 도움말' },
      { kind: 'loading', id: 'lookup_wait' },
    ])
  })
})
