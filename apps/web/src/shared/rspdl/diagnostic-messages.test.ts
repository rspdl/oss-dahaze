import { describe, expect, it } from 'vitest'

import type { RspdlDiagnostic } from '@dahaze/rspdl-editor'
import { renderDiagnosticMessage, renderDiagnosticTitle } from './diagnostic-messages'

function diagnostic(overrides: Partial<RspdlDiagnostic>): RspdlDiagnostic {
  return {
    rule_id: 'RSPDL-TEST-001',
    severity: 'error',
    message_key: 'ko.syntax.period_required',
    span: { start: 10, end: 20 },
    ...overrides,
  }
}

describe('renderDiagnosticMessage', () => {
  it('상세 설명보다 먼저 읽을 수 있는 짧은 문제 제목을 제공한다', () => {
    expect(
      renderDiagnosticTitle(
        diagnostic({ message_key: 'semantic.action_data_mutation.conflict' }),
      ),
    ).toBe('한 행동의 결과가 서로 충돌합니다')
    expect(renderDiagnosticTitle(diagnostic({ message_key: 'ko.syntax.period_required' }))).toBe(
      '문장 형식을 확인해 주세요',
    )
  })

  it('문법 오류를 사람이 읽을 수 있는 고정 문구로 렌더링한다', () => {
    expect(renderDiagnosticMessage(diagnostic({}))).toBe(
      '완전한 문장은 마침표로 끝나야 합니다.',
    )
    expect(
      renderDiagnosticMessage(
        diagnostic({
          message_key: 'ko.syntax.reference_marker_missing',
          arguments: { reference: '예약', expected: '은 또는 는' },
        }),
      ),
    ).toBe('예약에서 은 또는 는 marker를 찾을 수 없습니다.')
  })

  it.each([
    [
      'semantic.lifecycle.field_producer_missing',
      { field_id: 'ordering.order.status' },
      '필드 ordering.order.status을 만드는 화면 입력 또는 계산이 없습니다.',
    ],
    [
      'semantic.lifecycle.model_creator_missing',
      { model_id: 'ordering.order' },
      '데이터 모델 ordering.order을 생성하는 화면 또는 행동 결과가 없습니다.',
    ],
  ])('lifecycle 누락 %s을 컴파일러 인자로 설명한다', (messageKey, arguments_, expected) => {
    expect(
      renderDiagnosticMessage(diagnostic({ message_key: messageKey, arguments: arguments_ })),
    ).toBe(expected)
  })

  it.each([
    [
      'semantic.action_data_mutation.conflict',
      { action_id: 'ordering.cancel_order', model_id: 'ordering.order', mutations: 'update,delete' },
      '행동 ordering.cancel_order은 데이터 모델 ordering.order에 서로 양립할 수 없는 결과 update,delete를 동시에 선언할 수 없습니다.',
    ],
    [
      'semantic.action_data_mutation.duplicate',
      { action_id: 'ordering.change_order', model_id: 'ordering.order', mutation: 'update' },
      '행동 ordering.change_order의 데이터 모델 ordering.order에 대한 update 결과가 중복 선언되었습니다.',
    ],
  ])('행동 결과 문제 %s을 구체적으로 설명한다', (messageKey, arguments_, expected) => {
    expect(
      renderDiagnosticMessage(diagnostic({ message_key: messageKey, arguments: arguments_ })),
    ).toBe(expected)
  })

  it('관계 양립성 충돌에 문제가 된 관계들을 표시한다', () => {
    expect(
      renderDiagnosticMessage(
        diagnostic({
          message_key: 'semantic.relation.compatibility_conflict',
          arguments: { relation_ids: 'ordering.owner,ordering.guest' },
        }),
      ),
    ).toBe(
      '같은 관계 그룹 ordering.owner,ordering.guest을 배타적이면서 공존 가능하다고 선언할 수 없습니다.',
    )
  })

  it.each([
    [
      'semantic.derivation.multiple_producers',
      { field_id: 'booking.total' },
      '계산 필드 booking.total은 화면 입력과 계산 결과를 동시에 생산자로 가질 수 없습니다.',
    ],
    [
      'semantic.recalculation.exactly_one_required',
      { field_id: 'booking.total', actual: '0' },
      '계산 필드 booking.total은 재계산 시점을 정확히 하나 선언해야 합니다. 현재 0개입니다.',
    ],
    [
      'semantic.recalculation.source_mismatch',
      { expected_field_id: 'booking.fare', actual_field_id: 'booking.tax' },
      '재계산 원본 필드가 다릅니다. 기대 booking.fare, 실제 booking.tax.',
    ],
    [
      'semantic.recalculation.derivation_missing',
      { field_id: 'booking.total' },
      '필드 booking.total의 재계산 조건에 대응하는 계산식이 없습니다.',
    ],
  ])('계산 및 재계산 문제 %s을 설명한다', (messageKey, arguments_, expected) => {
    expect(
      renderDiagnosticMessage(diagnostic({ message_key: messageKey, arguments: arguments_ })),
    ).toBe(expected)
  })

  it('알려진 키의 필수 인자가 없으면 누락 사실을 숨기지 않는다', () => {
    expect(
      renderDiagnosticMessage(
        diagnostic({ message_key: 'semantic.lifecycle.field_producer_missing' }),
      ),
    ).toContain('<?>')
  })

  it('알 수 없는 키는 컴파일러가 준 message를 우선 표시한다', () => {
    expect(
      renderDiagnosticMessage(
        diagnostic({
          message_key: 'semantic.future.new_rule',
          arguments: { id: 'one' },
          message: '컴파일러가 렌더링한 문구',
        }),
      ),
    ).toBe('컴파일러가 렌더링한 문구')
  })

  it('message도 없는 알 수 없는 키는 인자를 정렬해 솔직하게 표시한다', () => {
    expect(
      renderDiagnosticMessage(
        diagnostic({
          message_key: 'semantic.future.new_rule',
          arguments: { zebra: 'last', alpha: 'first' },
        }),
      ),
    ).toBe('semantic.future.new_rule (alpha=first, zebra=last)')
  })

  it('표시 과정에서 원본 진단을 변경하지 않는다', () => {
    const source = diagnostic({
      rule_id: 'RSPDL-DATA-004',
      severity: 'warning',
      message_key: 'semantic.derivation.duplicate_target',
      arguments: { field_id: 'booking.total' },
      span: { start: 4, end: 12 },
    })
    const snapshot = structuredClone(source)

    renderDiagnosticMessage(source)

    expect(source).toEqual(snapshot)
  })
})
