import { describe, expect, it } from 'vitest'

import type { CompileResult } from '@/features/mockup/screen-layouts'
import duplicateModule from './__duplicate-module-fixture.json'
import { collectScreenMockups } from '../mockup/screen-layouts'
import { collectBoard } from './board-ir'
import { buildFlowGraph } from './flow-graph'

/**
 * 두 문서가 같은 모듈 id 를 선언하면 화면 id 도 글자 그대로 같아진다.
 *
 * 컴파일러는 `RSPDL-LINK-001` 로 중복 모듈을 알리지만 **두 파일의 module IR 을 모두 내보낸다.**
 * 그래서 `result` 를 읽는 보드는 둘 다 본다. `path + id` 로 가르지 않으면 한 문서의 화면이
 * 다른 문서의 화면을 덮어쓰고, 사람은 자기가 쓴 화면이 사라진 것을 보게 된다.
 *
 * 실제 rspdl 0.1.2 컴파일 결과를 쓴다 — 이 상황이 정말 일어나는지부터 컴파일러에게 물었다.
 */
function response(result: unknown): CompileResult {
  return { result }
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

  describe('화면 흐름 보드', () => {
    const graph = buildFlowGraph(collected, mockups.screens)

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
