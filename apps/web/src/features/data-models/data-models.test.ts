import { describe, expect, it } from 'vitest'

import type { ProjectCompileResponse } from '@dahaze/api-client'
import fixture from '../../shared/rspdl/__policies-fixture.json'
import { collectDataModels } from './data-models'

/** 실제 rspdl 0.1.0 컴파일 결과를 쓴다. 화면용 adapter 가 상상한 IR 에만 맞지 않게 한다. */
function response(result: unknown): ProjectCompileResponse {
  return {
    rspdl_version: '0.1.0',
    wire_schema_version: 1,
    locale: 'ko-KR',
    result: result as ProjectCompileResponse['result'],
    documents: [],
  }
}

describe('collectDataModels', () => {
  it('여러 문서에 선언된 모델과 필드를 원본 이름으로 모은다', () => {
    const collected = collectDataModels(response(fixture))

    expect(collected.models).toHaveLength(3)
    expect(collected.models.map((model) => model.name)).toEqual(
      expect.arrayContaining(['문서', '비용 신청', '주문']),
    )
    expect(collected.models.find((model) => model.name === '비용 신청')?.path).toBe(
      'expense.rspdl',
    )
  })

  it('enum 필드의 허용 값을 module enum 에서 이름으로 붙인다', () => {
    const collected = collectDataModels(response(fixture))
    const status = collected.models
      .find((model) => model.name === '비용 신청')
      ?.fields.find((field) => field.name === '승인 상태')

    expect(status).toMatchObject({ typeKind: 'enum', required: true })
    expect(status?.enumVariants).toEqual(['작성 중', '제출됨', '승인됨'])
  })

  it('컴파일하지 않은 프로젝트와 빈 컴파일 결과를 구분한다', () => {
    expect(collectDataModels(response(null)).compiled).toBe(false)
    expect(collectDataModels(response({ files: [] }))).toMatchObject({
      compiled: true,
      models: [],
    })
  })

  it('알 수 없는 wire shape 를 빈 모델 목록으로 오인하지 않는다', () => {
    expect(collectDataModels(response({ files: 'not an array' })).recognized).toBe(false)
  })

  it('진단으로 module 이 없는 파일에서 모델을 만들지 않는다', () => {
    const collected = collectDataModels(
      response({ files: [{ path: 'broken.rspdl', module: null, diagnostics: [{}] }] }),
    )

    expect(collected).toMatchObject({ recognized: true, models: [] })
  })

  it('컴파일러가 준 관계와 관계 제약을 모델 연결로 모은다', () => {
    const collected = collectDataModels(
      response({
        files: [
          {
            path: 'booking.rspdl',
            diagnostics: [],
            module: {
              id: 'booking',
              name: '예약',
              enums: [],
              models: [
                { id: 'booking.booking', name: '예약', fields: [] },
                { id: 'booking.passenger', name: '승객', fields: [] },
              ],
              relations: [
                {
                  id: 'booking.holder',
                  name: '예약자',
                  parameter_model_ids: ['booking.booking', 'booking.passenger'],
                },
              ],
              relational_constraints: [
                { id: 'rule', constraint: { kind: 'required', relation_id: 'booking.holder' } },
                { id: 'rule-2', constraint: { kind: 'unique', relation_id: 'booking.holder' } },
              ],
            },
          },
        ],
      }),
    )

    expect(collected.relations).toEqual([
      {
        id: 'booking.holder',
        name: '예약자',
        sourceKey: 'booking.rspdl:booking.booking',
        targetKey: 'booking.rspdl:booking.passenger',
        constraints: ['required', 'unique'],
      },
    ])
  })
})
