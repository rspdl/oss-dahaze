import { describe, expect, it } from 'vitest'

import { collectBoard } from '../wireframe/board-ir'
import { buildAppShell } from './app-shell'

/** rspdl 0.1.4 결과 모양을 줄인 것. 정보구조 두 단계, 분류 없는 화면 하나, 팝업 하나. */
const board = collectBoard({
  result: {
    files: [{
      path: '/a.rspdl',
      module: {
        information_architecture: [
          { id: 'm.customer', name: '고객 예약' },
          { id: 'm.discovery', name: '항공편 탐색', parent_id: 'm.customer' },
          { id: 'm.result', name: '예약 결과', parent_id: 'm.customer' },
          { id: 'm.ops', name: '운영 업무' },
        ],
        screen_categories: [
          { screen_id: 'm.results', category_id: 'm.discovery' },
          { screen_id: 'm.search', category_id: 'm.discovery' },
          { screen_id: 'm.done', category_id: 'm.result' },
          { screen_id: 'm.notice', category_id: 'm.customer' },
          { screen_id: 'm.dashboard', category_id: 'm.ops' },
        ],
        roles: [{ id: 'm.guest', name: '고객' }],
        screen_layouts: [
          { screen_id: 'm.search', kind: 'page', role_ids: ['m.guest'], elements: [] },
          { screen_id: 'm.notice', kind: 'popup', role_ids: [], elements: [] },
        ],
        screens: [
          { id: 'm.dashboard', name: '대시보드' },
          { id: 'm.done', name: '완료 화면' },
          { id: 'm.loose', name: '분류 없는 화면' },
          { id: 'm.notice', name: '안내 팝업' },
          { id: 'm.results', name: '결과 화면' },
          { id: 'm.search', name: '검색 화면' },
        ],
      },
      diagnostics: [],
    }],
  },
})

describe('buildAppShell', () => {
  it('builds the menu of the top category in authored order', () => {
    const shell = buildAppShell(board, '/a.rspdl:m.search')!
    expect(shell.appName).toBe('고객 예약')
    expect(shell.groups.map((group) => group.name)).toEqual(['항공편 탐색', '예약 결과'])
    // 분류 안의 순서는 문서에 적은 순서다. 컴파일러가 id 순으로 주는 화면 목록 순서가 아니다.
    expect(shell.groups[0]!.items.map((item) => item.name)).toEqual(['결과 화면', '검색 화면'])
    expect(shell.groups[0]!.items.find((item) => item.current)?.name).toBe('검색 화면')
    expect(shell.items.map((item) => item.name)).toEqual(['안내 팝업'])
    expect(shell.breadcrumb).toEqual(['고객 예약', '항공편 탐색', '검색 화면'])
    expect(shell.route).toBe('/customer/discovery/search')
    expect(shell.roleNames).toEqual(['고객'])
  })

  it('does not show another top category in the menu', () => {
    const shell = buildAppShell(board, '/a.rspdl:m.dashboard')!
    expect(shell.appName).toBe('운영 업무')
    expect(shell.items.map((item) => item.name)).toEqual(['대시보드'])
    expect(shell.groups).toEqual([])
  })

  it('keeps the screen kind so a popup can float over the app', () => {
    expect(buildAppShell(board, '/a.rspdl:m.notice')?.kind).toBe('popup')
  })

  it('draws no frame for a screen outside the information architecture', () => {
    expect(buildAppShell(board, '/a.rspdl:m.loose')).toBeNull()
  })
})
