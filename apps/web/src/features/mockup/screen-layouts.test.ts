import { describe, expect, it } from 'vitest'

import type { ProjectCompileResponse } from '@dahaze/api-client'
import screenStructure from './__screen-structure-fixture.json'
import valueTypes from './__value-types-fixture.json'
import { collectScreenMockups, findScreenMockup } from './screen-layouts'

/** 실제 rspdl 0.1.2 컴파일 결과를 쓴다. 화면용 adapter 가 상상한 IR 에만 맞지 않게 한다. */
function response(result: unknown): ProjectCompileResponse {
  return {
    rspdl_version: '0.1.2',
    wire_schema_version: 1,
    locale: 'ko-KR',
    result: result as ProjectCompileResponse['result'],
    documents: [],
  }
}

const collected = collectScreenMockups(response(screenStructure))

describe('collectScreenMockups', () => {
  it('선언된 화면 레이아웃을 선언 순서대로 모은다', () => {
    expect(collected.screens.map((screen) => screen.screenId)).toEqual([
      'reservation.create_facility',
      'reservation.facility_list',
      'reservation.facility_detail',
      'reservation.create_reservation',
      'reservation.reservation_done',
    ])
  })

  it('화면 이름을 module.screens 에서 붙인다', () => {
    expect(findScreenMockup(collected, 'reservation.facility_list')?.screenName).toBe(
      '시설 목록 화면',
    )
  })

  it('입력 필드를 모델과 조인해 이름과 필수 여부를 붙인다', () => {
    const screen = findScreenMockup(collected, 'reservation.create_facility')
    const section = screen?.elements[0]
    const form = section?.kind === 'section' ? section.children[0] : undefined

    expect(form?.kind).toBe('form')
    expect(form?.kind === 'form' ? form.inputs : []).toMatchObject([
      { kind: 'input', field: { name: '이름', control: 'text', resolved: true } },
      { kind: 'input', field: { name: '수용 인원', control: 'number', resolved: true } },
    ])
  })

  it('목록의 모델 이름과 열 필드를 선언 순서로 붙인다', () => {
    const screen = findScreenMockup(collected, 'reservation.facility_list')
    const section = screen?.elements[1]
    const list = section?.kind === 'section' ? section.children[0] : undefined

    expect(list).toMatchObject({ kind: 'list', modelName: '시설' })
    expect(list?.kind === 'list' ? list.fields.map((field) => field.name) : []).toEqual([
      '이름',
      '수용 인원',
    ])
  })

  it('버튼의 선언된 이름과 자리표시자의 이름을 그대로 옮긴다', () => {
    const screen = findScreenMockup(collected, 'reservation.facility_detail')
    const section = screen?.elements[1]
    const children = section?.kind === 'section' ? section.children : []

    expect(children[1]).toEqual({ kind: 'placeholder', text: '시설 위치 지도' })
    expect(children[2]).toMatchObject({ kind: 'button', name: '예약 신청', id: 'apply' })
  })

  it('선언하지 않은 유형은 채우지 않고 비워 둔다', () => {
    const withoutKind = collectScreenMockups(
      response({
        files: [
          {
            path: 'a.rspdl',
            module: { screen_layouts: [{ screen_id: 'a.b', elements: [] }] },
            diagnostics: [],
          },
        ],
      }),
    )

    expect(withoutKind.screens[0]?.kind).toBeNull()
    expect(findScreenMockup(collected, 'reservation.facility_list')?.kind).toBe('page')
  })
})

describe('값 타입이 입력칸 모양을 정한다', () => {
  const typed = collectScreenMockups(response(valueTypes))
  const form = typed.screens[0]?.elements[0]
  const inputs = form?.kind === 'form' ? form.inputs : []

  it('타입마다 다른 칸으로 옮기고 모르는 타입은 글상자로 내려앉는다', () => {
    expect(
      inputs.map((input) => (input.kind === 'input' ? input.field.control : input.kind)),
    ).toEqual(['select', 'date', 'time', 'number', 'text'])
  })

  it('enum 의 값을 선언 순서로 붙인다', () => {
    const status = inputs[0]
    // value_type.definition.variants 는 id 로 정렬돼 있다. 선언 순서를 지키는 module.enums 를 쓴다.
    expect(status?.kind === 'input' ? status.field.options : null).toEqual(['대기', '확정'])
  })

  it('선택 필드의 필수 여부를 그대로 옮긴다', () => {
    const memo = inputs[4]
    expect(memo?.kind === 'input' ? memo.field.required : null).toBe(false)
  })
})

describe('모르는 모양을 조용히 지우지 않는다', () => {
  function elements(raw: unknown[]) {
    return (
      collectScreenMockups(
        response({
          files: [
            {
              path: 'a.rspdl',
              module: { screen_layouts: [{ screen_id: 'a.b', elements: raw }] },
              diagnostics: [],
            },
          ],
        }),
      ).screens[0]?.elements ?? []
    )
  }

  it('어휘 밖의 요소를 표시용 자리로 남긴다', () => {
    expect(elements([{ kind: '탭바' }])).toEqual([
      { kind: 'unrecognized', rawKind: '탭바', reason: 'unknown-kind' },
    ])
  })

  it('아는 어휘인데 값이 빠진 요소를 다른 이유로 구분한다', () => {
    expect(elements([{ kind: 'button', id: 'a' }])).toEqual([
      { kind: 'unrecognized', rawKind: 'button', reason: 'missing-data' },
    ])
  })

  it('모델에 없는 필드를 지우지 않고 id 를 남긴다', () => {
    const [input] = elements([{ kind: 'input', field_id: 'a.b.없는필드' }])
    expect(input).toEqual({
      kind: 'input',
      field: {
        id: 'a.b.없는필드',
        name: 'a.b.없는필드',
        required: false,
        control: 'text',
        options: null,
        resolved: false,
      },
    })
  })
})

describe('컴파일 상태를 구분한다', () => {
  it('컴파일하지 않은 프로젝트와 빈 결과를 구분한다', () => {
    expect(collectScreenMockups(response(null)).compiled).toBe(false)
    expect(collectScreenMockups(response({ files: [] }))).toMatchObject({
      compiled: true,
      screens: [],
    })
  })

  it('알 수 없는 wire shape 를 레이아웃 없음으로 오인하지 않는다', () => {
    expect(collectScreenMockups(response({ files: 'not an array' })).recognized).toBe(false)
  })

  it('진단으로 module 이 없는 파일에서 화면을 만들지 않는다', () => {
    expect(
      collectScreenMockups(
        response({ files: [{ path: 'broken.rspdl', module: null, diagnostics: [{}] }] }),
      ),
    ).toMatchObject({ recognized: true, screens: [] })
  })
})
