import { describe, expect, it } from 'vitest'

import type { ProjectCompileResponse } from '@dahaze/api-client'
import screenStructure from '../mockup/__screen-structure-fixture.json'
import { collectScreenMockups } from '../mockup/screen-layouts'
import { collectBoard, type CollectedBoard } from './board-ir'
import { buildFlowGraph } from './flow-graph'

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
const mockups = collectScreenMockups(response(screenStructure))
const graph = buildFlowGraph(collected, mockups.screens, 'desktop')

function shortId(id: string): string {
  return id.split(':').pop() ?? id
}

describe('buildFlowGraph', () => {
  it('선언된 화면 전부를 노드로, 경로 전부를 간선으로 세운다', () => {
    expect(graph.nodes).toHaveLength(5)
    expect(graph.edges).toHaveLength(4)
    expect(graph.danglingPaths).toHaveLength(0)
  })

  it('레이아웃을 선언한 화면에는 목업이 붙는다', () => {
    // 이 예제는 화면 다섯 개가 모두 레이아웃을 선언했다.
    expect(graph.nodes.every((node) => node.mockup !== null)).toBe(true)

    const listNode = graph.nodes.find(
      (node) => shortId(node.id) === 'reservation.facility_list',
    )!
    expect(listNode.mockup?.screenName).toBe('시설 목록 화면')
  })

  it('레이아웃이 없는 화면은 목업 없이 노드로만 남는다', () => {
    /* 빈 상자로 그리기 위해서다. 조작 선언에서 모양을 유추하지 않는다 — 유추한 화면은
       기획자가 쓰지 않은 것을 쓴 것처럼 보이게 한다. */
    const bare = buildFlowGraph(collected, [], 'desktop')
    expect(bare.nodes).toHaveLength(5)
    expect(bare.nodes.every((node) => node.mockup === null)).toBe(true)
  })

  it('화살표에 선언된 설명을 싣고, 없으면 출발 요소 이름을 쓴다', () => {
    const labels = graph.edges.map((edge) => edge.label)
    expect(labels).toContain('등록 성공')
    expect(labels).toContain('목록에서 하나 고름')
    // `시설 상세 → 예약 신청` 경로에는 설명이 없다. 빈 칸 대신 출발 요소가 보인다.
    expect(labels).toContain('apply')
  })

  it('경로를 따라 층을 쌓는다', () => {
    const columnOf = (id: string) =>
      graph.nodes.find((node) => shortId(node.id) === id)!.position.x

    // 시설 등록 → 시설 목록 → 시설 상세 → 예약 신청 → 예약 완료
    expect(columnOf('reservation.create_facility')).toBe(0)
    expect(columnOf('reservation.facility_list')).toBeGreaterThan(
      columnOf('reservation.create_facility'),
    )
    expect(columnOf('reservation.reservation_done')).toBeGreaterThan(
      columnOf('reservation.create_reservation'),
    )
  })

  it('모바일 폭에서는 열 간격이 좁아진다', () => {
    const mobile = buildFlowGraph(collected, mockups.screens, 'mobile')
    const secondColumn = (nodes: { position: { x: number } }[]) =>
      Math.min(...nodes.map((node) => node.position.x).filter((x) => x > 0))

    expect(secondColumn(mobile.nodes)).toBeLessThan(secondColumn(graph.nodes))
  })

  it('끝점을 찾지 못한 경로는 그리지 않고 따로 알린다', () => {
    const broken: CollectedBoard = {
      ...collected,
      paths: [
        {
          key: 'a',
          sourceScreenId: 'reservation.facility_list',
          sourceElementId: 'open',
          targetScreenId: 'reservation.사라진화면',
          label: null,
          path: 'screen-structure.rspdl',
          span: null,
        },
      ],
    }
    const built = buildFlowGraph(broken, mockups.screens, 'desktop')
    expect(built.edges).toHaveLength(0)
    expect(built.danglingPaths).toHaveLength(1)
  })

  it('경로가 순환해도 멈추지 않고 모든 화면에 자리를 준다', () => {
    const cyclic: CollectedBoard = {
      ...collected,
      paths: [
        {
          key: 'a',
          sourceScreenId: 'reservation.facility_list',
          sourceElementId: 'open',
          targetScreenId: 'reservation.facility_detail',
          label: null,
          path: 'p',
          span: null,
        },
        {
          key: 'b',
          sourceScreenId: 'reservation.facility_detail',
          sourceElementId: 'back',
          targetScreenId: 'reservation.facility_list',
          label: null,
          path: 'p',
          span: null,
        },
      ],
    }
    const built = buildFlowGraph(cyclic, mockups.screens, 'desktop')
    expect(built.nodes).toHaveLength(5)
    expect(built.edges).toHaveLength(2)
  })

  it('화면이 없으면 빈 그래프다', () => {
    const empty = buildFlowGraph(
      { categories: [], screens: [], paths: [], recognized: true, compiled: true },
      [],
      'desktop',
    )
    expect(empty.nodes).toHaveLength(0)
    expect(empty.edges).toHaveLength(0)
  })
})
