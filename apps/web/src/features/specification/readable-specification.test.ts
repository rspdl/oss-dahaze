import { describe, expect, it } from 'vitest'

import { buildReadableSpecification, findReadableElement, findReadableScreen, sourceExcerpt } from './readable-specification'
import fieldProducerCliFixture from './__field-producer-cli-fixture.json'

const span = { start: 0, end: 4 }

function response(module: Record<string, unknown>, diagnostics: unknown[] = []) {
  return { wire_schema_version: 1, result: { files: [{ path: 'booking.rspdl', module, diagnostics }] } }
}

function moduleFixture(): Record<string, unknown> {
  return {
    id: 'booking',
    name: '예약',
    span,
    enums: [],
    roles: [{ id: 'booking.customer', name: '고객' }],
    actions: [{ id: 'booking.pay', name: '결제' }],
    models: [{
      id: 'booking.reservation',
      name: '예약',
      span,
      fields: [{ id: 'booking.reservation.status', name: '상태', required: true, value_type: { kind: 'string' }, span }],
    }],
    screens: [{
      id: 'booking.payment',
      name: '결제 화면',
      span,
      operations: [{ kind: 'update', model_id: 'booking.reservation', field_ids: ['booking.reservation.status'], span }],
    }],
    screen_layouts: [{
      screen_id: 'booking.payment',
      role_ids: ['booking.customer'],
      permissions: [{
        role_id: 'booking.customer',
        action_id: 'booking.pay',
        model_id: 'booking.reservation',
        field_id: 'booking.reservation.status',
        verification: 'unknown',
        condition: { kind: 'unsupported_policy_predicate', value: 'owner' },
        span,
      }],
      elements: [{ kind: 'section', children: [
        { kind: 'input', id: 'status-input', field_id: 'booking.reservation.status', span },
        { kind: 'button', id: 'submit', name: '결제', action_id: 'booking.pay', span },
      ], span }],
      span,
    }],
    constraints: [{
      id: 'booking.nonempty',
      left: { kind: 'field', value: 'booking.reservation.status' },
      operator: 'not_equal',
      right: { kind: 'constant', value: { representation: { value: '' } } },
      span,
    }],
    conditional_productions: [{ field_producers: [{
        id: 'booking.status_from_input',
        output_field_id: 'booking.reservation.status',
        source: { kind: 'action_input', definition: { input_id: 'booking.pay.status' } },
        condition: { kind: 'enum_variant', definition: { input_id: 'booking.pay.mode', variant_id: 'booking.mode.card' } },
        phase: 'pre_mutation',
        span,
      }] }],
    lookup_results: [],
    derivations: [],
    action_outcomes: [{
      id: 'booking.pay.confirmed',
      local_id: 'confirmed',
      action_id: 'booking.pay',
      kind: 'success',
      provided_data: [{
        model_id: 'booking.reservation',
        field_id: 'booking.reservation.status',
        source: { kind: 'producer', producer_id: 'booking.status_from_input' },
        verification: 'verified',
        prerequisite_field_ids: ['booking.reservation.status'],
        span,
      }],
      span,
    }],
    screen_paths: [{
      id: 'confirmed-path',
      source_screen_id: 'booking.payment',
      source_element_id: 'submit',
      target_screen_id: 'booking.done',
      outcome_id: 'booking.pay.confirmed',
      label: '결제 성공이면',
      span,
    }, {
      source_screen_id: 'booking.payment',
      source_element_id: 'submit',
      outcome_id: 'booking.pay.declined',
      handler: { kind: 'message', id: 'declined', content: '결제를 다시 확인해 주세요.', span },
      span,
    }],
    information_architecture: [],
    screen_categories: [],
  }
}

describe('buildReadableSpecification', () => {
  it('keeps conditional permission evidence separate from data constraints', () => {
    const specification = buildReadableSpecification(response(moduleFixture()))
    const screen = findReadableScreen(specification, 'booking.payment')
    const field = specification.models[0]?.fields[0]

    expect(screen?.permissions[0]?.verification).toBe('unknown')
    expect(screen?.permissions[0]?.rawCondition).toContain('unsupported_policy_predicate')
    expect(field?.constraints).toEqual([expect.objectContaining({ left: '상태', operator: '≠', right: '' })])
    expect(field?.constraints[0]?.id).toBe('booking.nonempty')
  })

  it('shows named operations, fields, producer provenance, and typed outcome provenance', () => {
    const specification = buildReadableSpecification(response(moduleFixture()))
    const screen = findReadableScreen(specification, 'booking.rspdl:booking.payment')
    const button = findReadableElement(screen, 'submit')
    const field = specification.models[0]?.fields[0]

    expect(screen?.roles[0]?.name).toBe('고객')
    expect(screen?.operations[0]).toMatchObject({ kind: 'update', model: { name: '예약' }, fields: [{ name: '상태' }] })
    expect(button?.action?.name).toBe('결제')
    expect(button?.outcomes[0]).toMatchObject({ localId: 'confirmed', kind: 'success', providedData: [{ field: { name: '상태' }, verification: 'verified', prerequisiteFields: [{ name: '상태' }] }] })
    expect(button?.paths[0]).toMatchObject({ id: 'confirmed-path', label: '결제 성공이면', outcomeId: 'booking.pay.confirmed' })
    expect(button?.paths[1]).toMatchObject({ targetScreen: null, handler: { kind: 'message', id: 'declined', content: '결제를 다시 확인해 주세요.' } })
    expect(field?.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'booking.status_from_input', kind: 'action_input', sourceLabel: 'booking.pay.status' }),
      expect.objectContaining({ id: 'booking.pay.confirmed:booking.reservation.status', kind: 'outcome_producer', verification: 'verified' }),
    ]))
    expect(field?.provenance[0]?.rawCondition).toContain('enum_variant')
  })

  it('distinguishes uncompiled, unsupported, absent, and unrecognized facts', () => {
    expect(buildReadableSpecification(undefined).state).toBe('uncompiled')
    expect(buildReadableSpecification({ wire_schema_version: 1, result: null }).state).toBe('uncompiled')
    expect(buildReadableSpecification({ wire_schema_version: 1, result: { files: 'new-shape' } } as never).state).toBe('unsupported')
    expect(buildReadableSpecification({ wire_schema_version: 99, result: { files: [] } }).state).toBe('unsupported')

    const empty = buildReadableSpecification(response({ id: 'empty', name: '빈 모듈', models: [], screens: [], screen_layouts: [], action_outcomes: [] }))
    expect(empty.modelsState).toBe('absent')
    expect(empty.screensState).toBe('absent')
    expect(empty.outcomesState).toBe('absent')

    const raw = moduleFixture()
    ;(raw.screen_layouts as Record<string, unknown>[])[0]!.elements = [{ kind: 'future_widget', id: 'future', span }]
    const specification = buildReadableSpecification(response(raw))
    expect(findReadableElement(findReadableScreen(specification, 'booking.payment'), 'future')?.recognized).toBe(false)
  })

  it('copies immutable snapshot identity and source text instead of retaining mutable documents', () => {
    const document = { path: 'booking.rspdl', title: '예약', text: 'source before' }
    const specification = buildReadableSpecification(response(moduleFixture()), {
      documents: [document],
      identity: { snapshotVersion: 7, projectRevision: 12, sourceHash: 'fixed-hash', rspdlVersion: '0.8.0', wireSchemaVersion: 3 },
    })
    document.text = '현재 mutable 원문'

    expect(specification.identity).toEqual(expect.objectContaining({ snapshotVersion: 7, sourceHash: 'fixed-hash' }))
    expect(specification.documents[0]?.text).toBe('source before')
    expect(sourceExcerpt(specification.models[0]!.source)).toBe('sour')
  })

  it('reads field producers from the real CLI conditional production shape', () => {
    const specification = buildReadableSpecification(response(fieldProducerCliFixture))
    const notice = specification.models.find((model) => model.id === 'production.notice')

    expect(notice?.fields.find((field) => field.id.endsWith('.request_title'))?.provenance[0]).toMatchObject({
      id: 'production.request_title_binding',
      kind: 'input_field',
      sourceLabel: 'production.assign.target_request.제목',
    })
    expect(notice?.fields.find((field) => field.id.endsWith('.retry_count'))?.provenance[0]).toMatchObject({
      id: 'production.retry_binding',
      kind: 'constant',
      sourceLabel: '0',
    })
  })
})
