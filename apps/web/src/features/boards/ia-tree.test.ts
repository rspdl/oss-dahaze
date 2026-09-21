import { describe, expect, it } from 'vitest'

import type { ProjectCompileResponse } from '@dahaze/api-client'
import screenStructure from '../mockup/__screen-structure-fixture.json'
import { collectBoard, type CollectedBoard } from './board-ir'
import { buildIaTree, UNCATEGORIZED_ID } from './ia-tree'

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
const tree = buildIaTree(collected)

/** 노드 id 는 `path:id` 다. 읽기 좋게 뒤쪽만 꺼낸다. */
function shortId(id: string): string {
  return id.split(':').pop() ?? id
}

describe('buildIaTree', () => {
  it('분류 7개와 화면 5개를 모두 노드로 세운다', () => {
    expect(tree.nodes).toHaveLength(12)
    expect(tree.nodes.filter((node) => node.kind === 'category')).toHaveLength(7)
    expect(tree.nodes.filter((node) => node.kind === 'screen')).toHaveLength(5)
  })

  it('부모-자식을 선언 순서대로 잇는다', () => {
    const children = (parent: string) =>
      tree.edges
        .filter((edge) => shortId(edge.source) === parent)
        .map((edge) => shortId(edge.target))

    expect(children('reservation.admin')).toEqual(['reservation.register'])
    expect(children('reservation.browse')).toEqual(['reservation.search'])
    // 예약하기 아래는 신청 다음 확인이다. 이름순이면 순서가 뒤집힌다.
    expect(children('reservation.book')).toEqual(['reservation.apply', 'reservation.confirm'])
    expect(children('reservation.search')).toEqual([
      'reservation.facility_list',
      'reservation.facility_detail',
    ])
  })

  it('깊이가 왼쪽에서 오른쪽으로 자란다', () => {
    const depthOf = (id: string) =>
      tree.nodes.find((node) => shortId(node.id) === id)?.depth

    expect(depthOf('reservation.admin')).toBe(0)
    expect(depthOf('reservation.register')).toBe(1)
    expect(depthOf('reservation.create_facility')).toBe(2)
  })

  it('가로 자리는 깊이만으로 정해지고 형제는 세로로 쌓인다', () => {
    const admin = tree.nodes.find((node) => shortId(node.id) === 'reservation.admin')!
    const register = tree.nodes.find((node) => shortId(node.id) === 'reservation.register')!
    expect(register.position.x).toBeGreaterThan(admin.position.x)

    const apply = tree.nodes.find((node) => shortId(node.id) === 'reservation.apply')!
    const confirm = tree.nodes.find((node) => shortId(node.id) === 'reservation.confirm')!
    expect(confirm.position.y).toBeGreaterThan(apply.position.y)
    expect(confirm.position.x).toBe(apply.position.x)
  })

  it('분류에 담기지 않은 화면을 숨기지 않고 미분류로 모은다', () => {
    /* 컴파일러도 이 사실을 `info` 로 알릴 뿐 오류로 만들지 않는다. 보드가 더 엄격하거나
       더 조용해서는 안 된다. */
    const orphaned: CollectedBoard = {
      ...collected,
      screens: collected.screens.map((screen) => ({
        ...screen,
        categoryId: null,
        categorySpan: null,
      })),
    }
    const built = buildIaTree(orphaned)
    const bucket = built.nodes.find((node) => node.id === UNCATEGORIZED_ID)

    expect(bucket?.synthetic).toBe(true)
    expect(bucket?.name).toBe('미분류')
    expect(
      built.edges.filter((edge) => edge.source === UNCATEGORIZED_ID),
    ).toHaveLength(5)
  })

  it('화면도 분류도 없으면 빈 트리다', () => {
    const empty = buildIaTree({
      categories: [],
      screens: [],
      paths: [],
      recognized: true,
      compiled: true,
    })
    expect(empty.nodes).toHaveLength(0)
    expect(empty.edges).toHaveLength(0)
  })

  it('부모를 찾지 못한 분류는 버리지 않고 최상위로 올린다', () => {
    const broken: CollectedBoard = {
      ...collected,
      categories: [
        {
          key: 'a.rspdl:x.lost',
          id: 'x.lost',
          name: '길 잃은 분류',
          parentId: 'x.nowhere',
          path: 'a.rspdl',
          span: null,
        },
      ],
      screens: [],
    }
    const built = buildIaTree(broken)
    expect(built.nodes.map((node) => node.name)).toEqual(['길 잃은 분류'])
    expect(built.nodes[0]!.depth).toBe(0)
  })
})
