import { describe, expect, it } from 'vitest'

import type { ProjectCompileResponse } from '@dahaze/api-client'
import screenStructure from '../mockup/__screen-structure-fixture.json'
import { collectBoard, screenSourceSpan } from './board-ir'

/** 실제 rspdl 0.1.2 컴파일 결과를 쓴다. 보드가 상상한 IR 에만 맞지 않게 한다. */
function response(result: unknown): ProjectCompileResponse {
  return {
    rspdl_version: '0.1.2',
    wire_schema_version: 1,
    locale: 'ko-KR',
    result: result as ProjectCompileResponse['result'],
    documents: [],
  }
}

const collected = collectBoard(response(screenStructure))

describe('collectBoard', () => {
  it('선언된 분류·화면·경로를 모두 읽는다', () => {
    expect(collected.recognized).toBe(true)
    expect(collected.compiled).toBe(true)
    expect(collected.categories).toHaveLength(7)
    expect(collected.screens).toHaveLength(5)
    expect(collected.paths).toHaveLength(4)
  })

  it('분류를 선언 순서(전위 순회) 그대로 둔다', () => {
    // 이름순이었다면 관리·둘러보기·등록… 순이 됐을 것이다. 형제 순서가 곧 메뉴 순서다.
    expect(collected.categories.map((category) => category.name)).toEqual([
      '관리',
      '등록',
      '둘러보기',
      '시설 찾기',
      '예약하기',
      '신청',
      '확인',
    ])
  })

  it('부모 없는 분류는 최상위로, 있는 분류는 부모를 들고 온다', () => {
    const byId = new Map(collected.categories.map((category) => [category.id, category]))
    expect(byId.get('reservation.admin')?.parentId).toBeNull()
    expect(byId.get('reservation.register')?.parentId).toBe('reservation.admin')
    expect(byId.get('reservation.confirm')?.parentId).toBe('reservation.book')
  })

  it('화면에 분류 소속과 레이아웃 유무를 붙인다', () => {
    const byId = new Map(collected.screens.map((screen) => [screen.id, screen]))
    const listScreen = byId.get('reservation.facility_list')
    expect(listScreen?.name).toBe('시설 목록 화면')
    expect(listScreen?.categoryId).toBe('reservation.search')
    expect(listScreen?.hasLayout).toBe(true)
    expect(listScreen?.path).toBe('screen-structure.rspdl')
  })

  it('경로의 설명은 적힌 것만 싣고, 없으면 null 로 남긴다', () => {
    const labels = collected.paths.map((path) => path.label)
    expect(labels).toEqual(['등록 성공', '목록에서 하나 고름', null, '신청 성공'])
  })

  it('경로는 양 끝점과 출발 요소를 그대로 들고 온다', () => {
    const first = collected.paths[0]!
    expect(first.sourceScreenId).toBe('reservation.create_facility')
    expect(first.sourceElementId).toBe('save')
    expect(first.targetScreenId).toBe('reservation.facility_list')
  })

  it('원문 위치는 레이아웃이 있으면 레이아웃을, 없으면 화면 선언을 가리킨다', () => {
    const withLayout = collected.screens.find((screen) => screen.hasLayout)!
    expect(screenSourceSpan(withLayout)).toBe(withLayout.layoutSpan)
    expect(withLayout.layoutSpan).not.toBeNull()

    const without = { ...withLayout, hasLayout: false, layoutSpan: null }
    expect(screenSourceSpan(without)).toBe(without.span)
  })

  it('모르는 wire shape 는 빈 결과가 아니라 "모른다" 로 돌려준다', () => {
    const unknown = collectBoard(response({ modules: [] }))
    expect(unknown.recognized).toBe(false)
    expect(unknown.screens).toHaveLength(0)
  })

  it('컴파일한 적이 없으면 "인식 못 함" 이 아니라 "컴파일 안 됨" 이다', () => {
    const none = collectBoard(response(null))
    expect(none.recognized).toBe(true)
    expect(none.compiled).toBe(false)
  })

  it('응답이 없으면 빈 결과를 돌려주고 던지지 않는다', () => {
    expect(collectBoard(undefined).screens).toHaveLength(0)
  })
})
