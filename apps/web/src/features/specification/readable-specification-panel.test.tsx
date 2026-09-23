import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import screenFixture from '../mockup/__screen-structure-fixture.json'
import { buildReadableSpecification } from './readable-specification'
import { ReadableSpecificationPanel } from './readable-specification-panel'

function workflowResult() {
  const workflow = {
    id: 'booking.complete',
    name: '예약 처리',
    start_screen_id: 'booking.payment',
    initial_data: [{ model_id: 'booking.reservation', field_id: 'booking.reservation.contact', span: { start: 4, end: 8 } }],
    acquisitions: [{ source_screen_id: 'booking.payment', source_element_id: 'submit', data: [{ model_id: 'booking.reservation', field_id: 'booking.reservation.contact', span: { start: 8, end: 12 } }], span: { start: 4, end: 12 } }],
    completions: [{ screen_id: 'booking.done', required_data: [{ model_id: 'booking.reservation', field_id: 'booking.reservation.contact', span: { start: 12, end: 16 } }], span: { start: 12, end: 16 } }],
    span: { start: 0, end: 16 },
  }
  return { files: [{
    path: 'booking.rspdl',
    diagnostics: [],
    module: {
      models: [{ id: 'booking.reservation', name: '예약', fields: [{ id: 'booking.reservation.contact', name: '연락처', required: true, value_type: { kind: 'string' }, span: { start: 4, end: 8 } }], span: { start: 0, end: 8 } }],
      screens: [
        { id: 'booking.payment', name: '결제 화면', operations: [], span: { start: 0, end: 4 } },
        { id: 'booking.done', name: '예약 완료 화면', operations: [], span: { start: 12, end: 16 } },
        { id: 'shipping.start', name: '배송 시작 화면', operations: [], span: { start: 16, end: 20 } },
        { id: 'shipping.done', name: '배송 완료 화면', operations: [], span: { start: 20, end: 24 } },
      ],
      screen_layouts: [{ screen_id: 'booking.payment', elements: [{ kind: 'button', id: 'submit', name: '예약하기', span: { start: 4, end: 8 } }] }],
      workflows: [workflow, { ...workflow, id: 'shipping.complete', name: '배송 처리', start_screen_id: 'shipping.start', initial_data: [], acquisitions: [], completions: [{ screen_id: 'shipping.done', required_data: [], span: { start: 20, end: 24 } }], span: { start: 16, end: 24 } }],
    },
  }] }
}

describe('ReadableSpecificationPanel', () => {
  it('renders a selected button from compiler IR without treating a path label as a condition', () => {
    const specification = buildReadableSpecification(
      { wire_schema_version: 1, result: screenFixture },
      { documents: [{ path: 'screen-structure.rspdl', text: 'x'.repeat(4000) }] },
    )
    const markup = renderToStaticMarkup(<ReadableSpecificationPanel
      specification={specification}
      screenKey="screen-structure.rspdl:reservation.create_facility"
      elementId="save"
    />)

    expect(markup).toContain('시설 등록 화면')
    expect(markup).toContain('생성')
    expect(markup).toContain('등록')
    expect(markup).toContain('검증 가능한 조건')
    expect(markup).toContain('표시 설명')
    expect(markup).toContain('실행 조건으로 해석하지 않음')
  })

  it('keeps compiler findings separate from human and AI context', () => {
    const result = { files: [{ path: 'a.rspdl', module: null, diagnostics: [{ rule_id: 'RSPDL-X', severity: 'warning', message_key: 'compiler.fact', message: '컴파일러 사실', span: { start: 0, end: 1 } }] }] }
    const specification = buildReadableSpecification(
      { wire_schema_version: 1, result },
      { planningState: { decisions: [{ id: 'd', status: 'deferred', title: '사람의 보류' }], proposals: [{ id: 'u', kind: 'unsupported', title: 'AI의 미지원 제안' }] } },
    )
    const markup = renderToStaticMarkup(<ReadableSpecificationPanel specification={specification} />)

    expect(markup).toContain('컴파일러 사실')
    expect(markup).toContain('사람의 보류')
    expect(markup).toContain('AI의 미지원 제안')
    expect(markup).toContain('컴파일러 판정이 아닌 기획 맥락')
  })

  it('shows every workflow in the project view and only screen relationships in a selected-screen view', () => {
    const specification = buildReadableSpecification(
      { wire_schema_version: 1, result: workflowResult() },
      { documents: [{ path: 'booking.rspdl', text: '0123456789abcdefghijklmn' }] },
    )
    const projectMarkup = renderToStaticMarkup(<ReadableSpecificationPanel specification={specification} />)
    const paymentMarkup = renderToStaticMarkup(<ReadableSpecificationPanel specification={specification} screenKey="booking.rspdl:booking.payment" />)
    const doneMarkup = renderToStaticMarkup(<ReadableSpecificationPanel specification={specification} screenKey="booking.done" />)

    expect(projectMarkup).toContain('예약 처리')
    expect(projectMarkup).toContain('배송 처리')
    expect(projectMarkup).toContain('외부 시작 전제')
    expect(projectMarkup).toContain('조회나 화면 입력으로 획득되었음을 뜻하지 않습니다')
    expect(projectMarkup).toContain('booking.reservation.contact')
    expect(projectMarkup).toContain('원문 · booking.rspdl · 바이트 0–16')
    expect(projectMarkup).toContain('0123456789abcdef')

    expect(paymentMarkup).toContain('예약 처리')
    expect(paymentMarkup).toContain('이 화면에서 시작')
    expect(paymentMarkup).toContain('이 화면의 데이터 획득')
    expect(paymentMarkup).toContain('예약하기')
    expect(paymentMarkup).not.toContain('배송 처리')

    expect(doneMarkup).toContain('예약 처리')
    expect(doneMarkup).toContain('이 화면에서 완료')
    expect(doneMarkup).toContain('필수 데이터')
    expect(doneMarkup).not.toContain('외부 시작 전제')
    expect(doneMarkup).not.toContain('배송 처리')
  })

  it('labels unsupported workflow shapes without manufacturing compiler diagnostics', () => {
    const result = workflowResult()
    const moduleIr = result.files[0]!.module
    moduleIr.workflows = { future: true } as never
    const specification = buildReadableSpecification({ wire_schema_version: 1, result })
    const markup = renderToStaticMarkup(<ReadableSpecificationPanel specification={specification} />)

    expect(markup).toContain('현재 화면이 알지 못하는 컴파일 결과 모양입니다')
    expect(specification.diagnostics).toEqual([])
    expect(markup).not.toContain('검증되었습니다')
  })

  it('shows unresolved workflow references literally with an explicit warning', () => {
    const result = workflowResult()
    result.files[0]!.module.workflows = [{
      id: 'booking.external',
      name: '외부 연결',
      start_screen_id: 'external.start',
      initial_data: [],
      acquisitions: [{ source_screen_id: 'booking.payment', source_element_id: 'missing-button', data: [], span: { start: 0, end: 4 } }],
      completions: [{ screen_id: 'external.done', required_data: [], span: { start: 0, end: 4 } }],
      span: { start: 0, end: 4 },
    }]
    const specification = buildReadableSpecification({ wire_schema_version: 1, result })
    const markup = renderToStaticMarkup(<ReadableSpecificationPanel specification={specification} />)

    expect(markup).toContain('external.start (이름 확인 불가)')
    expect(markup).toContain('external.done (이름 확인 불가)')
    expect(markup).toContain('요소 선언을 찾지 못해 원문 참조를 표시합니다: missing-button')
    expect(specification.diagnostics).toEqual([])
  })
})
