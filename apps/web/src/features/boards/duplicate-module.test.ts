import { describe, expect, it } from 'vitest'

import type { ProjectCompileResponse } from '@dahaze/api-client'
import duplicateModule from './__duplicate-module-fixture.json'
import { collectScreenMockups } from '../mockup/screen-layouts'
import { collectBoard } from './board-ir'
import { buildFlowGraph } from './flow-graph'
import { buildIaTree } from './ia-tree'

/**
 * 두 문서가 같은 모듈 id 를 선언하면 화면 id 도 글자 그대로 같아진다.
 *
 * 컴파일러는 `RSPDL-LINK-001` 로 중복 모듈을 알리지만 **두 파일의 module IR 을 모두 내보낸다.**
 * 그래서 `result` 를 읽는 보드는 둘 다 본다. `path + id` 로 가르지 않으면 한 문서의 화면이
 * 다른 문서의 화면을 덮어쓰고, 사람은 자기가 쓴 화면이 사라진 것을 보게 된다.
 *
 * 실제 rspdl 0.1.2 컴파일 결과를 쓴다 — 이 상황이 정말 일어나는지부터 컴파일러에게 물었다.
 */
function response(result: unknown): ProjectCompileResponse {
  return {
    rspdl_version: '0.1.2',
    wire_schema_version: 1,
    locale: 'ko-KR',
    result: result as ProjectCompileResponse['result'],
    documents: [],
  }
}

const collected = collectBoard(response(duplicateModule))
const mockups = collectScreenMockups(response(duplicateModule))

describe('같은 모듈 id 를 쓰는 두 문서', () => {
  it('전제: 화면 id 와 분류 id 가 두 문서에서 똑같다', () => {
    expect(collected.screens.map((screen) => screen.id)).toEqual(['t.shared', 't.shared'])
    expect(collected.categories.map((category) => category.id)).toEqual([
      't.common',
      't.common',
    ])
    expect(collected.screens.map((screen) => screen.path)).toEqual(['a.rspdl', 'b.rspdl'])
  })

  describe('화면 구조 보드', () => {
    const tree = buildIaTree(collected)

    it('문서마다 분류와 화면을 따로 세운다', () => {
      expect(tree.nodes.filter((node) => node.kind === 'category')).toHaveLength(2)
      expect(tree.nodes.filter((node) => node.kind === 'screen')).toHaveLength(2)
    })

    it('노드 id 가 겹치지 않는다', () => {
      const ids = tree.nodes.map((node) => node.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('화면을 자기 문서의 분류에만 잇는다', () => {
      for (const edge of tree.edges) {
        const source = tree.nodes.find((node) => node.id === edge.source)!
        const target = tree.nodes.find((node) => node.id === edge.target)!
        const sourcePath = source.category?.path ?? source.screen?.path
        const targetPath = target.category?.path ?? target.screen?.path
        expect(targetPath).toBe(sourcePath)
      }
    })

    it('한 화면이 미분류로 새지 않는다', () => {
      // 두 화면 모두 자기 문서의 분류에 담겨 있다. 키가 겹치면 하나가 밀려난다.
      expect(tree.edges).toHaveLength(2)
    })
  })

  describe('화면 흐름 보드', () => {
    const graph = buildFlowGraph(collected, mockups.screens, 'desktop')

    it('문서마다 노드를 따로 세운다', () => {
      expect(graph.nodes).toHaveLength(2)
      expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(2)
    })

    it('각 노드가 자기 문서의 목업을 든다', () => {
      /* 두 문서의 버튼 이름이 다르다. 목업이 섞이면 같은 이름이 두 번 나온다. */
      const buttonNames = graph.nodes.map((node) => {
        const button = node.mockup?.elements.find((element) => element.kind === 'button')
        return button?.kind === 'button' ? button.name : null
      })
      expect(buttonNames).toEqual(['가에서', '나에서'])
    })

    it('노드가 서로 다른 자리에 선다', () => {
      const positions = graph.nodes.map((node) => `${node.position.x},${node.position.y}`)
      expect(new Set(positions).size).toBe(2)
    })
  })
})
