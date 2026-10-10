import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { composeCode } from './compose-code'
import { createDesignNode, createSection, defaultLayout, idFactory, insertNode, parseLayoutNode, setAppearance, type GroupNode } from './layout-tree'
import { reactCode } from './react-code'
import type { ScreenMockup } from './screen-layouts'
import { ScreenMockupFrame } from './screen-mockup'

const field = (id: string, name: string, control: 'text' | 'number' | 'select', options: string[] | null = null) => ({ id: `m.flight.${id}`, name, required: true, control, options, resolved: true })

const screen: ScreenMockup = {
  key: 'a.rspdl:m.results', screenId: 'm.results', screenName: '결과', path: 'a.rspdl', kind: 'page',
  elements: [
    { kind: 'list', id: 'flights', modelId: 'm.flight', modelName: '항공편', fields: [field('number', '편명', 'text'), field('fare', '운임', 'number'), field('cabin', '좌석', 'select', ['일반', '비즈니스'])] },
    { kind: 'button', id: 'back', name: '돌아가기', actionId: null },
  ],
}

describe('목록·버튼의 UI 모양', () => {
  it('같은 목록을 표·카드·한 줄 목록으로 그린다', () => {
    const cards = setAppearance(defaultLayout(screen), 'element:id:flights', 'cards')
    const html = renderToStaticMarkup(<ScreenMockupFrame screen={screen} layout={cards} />)
    expect(html).not.toContain('<table')
    expect(html).toContain('grid-template-columns:repeat(auto-fill, minmax(200px, 1fr))')
    // 첫 글자 필드가 카드 제목, 선택 필드는 배지, 나머지는 이름: 값 줄이다.
    expect(html).toContain('편명 1')
    expect(html).toContain('<dt class="shrink-0 text-text-subtle">운임</dt>')
    expect(html).toContain('일반')

    const list = renderToStaticMarkup(<ScreenMockupFrame screen={screen} layout={setAppearance(defaultLayout(screen), 'element:id:flights', 'list')} />)
    expect(list).toContain('divide-y')
    expect(renderToStaticMarkup(<ScreenMockupFrame screen={screen} />)).toContain('<table')
  })

  it('모양은 저장했다 다시 읽어도 남는다', () => {
    const root = setAppearance(defaultLayout(screen), 'element:id:back', 'link')
    const parsed = parseLayoutNode(JSON.parse(JSON.stringify(root))) as GroupNode
    expect(parsed.children[1]).toMatchObject({ ref: 'id:back', appearance: 'link' })
    expect(parseLayoutNode({ type: 'element', ref: 'id:x', kind: 'list', appearance: 'carousel' })).not.toHaveProperty('appearance')
  })

  it('영역 밖에 놓인 요소도 고른 모양은 잃지 않는다', () => {
    const sectioned: ScreenMockup = { ...screen, elements: [{ kind: 'section', id: 'body', children: screen.elements }] }
    // AI 가 구역 안 목록을 루트 바로 아래 프레임에 넣은 모양이다.
    const saved: GroupNode = { type: 'group', id: 'root', style: { width: 'fill', height: 'fill', fill: 'none', border: false, radius: 0 }, layout: { direction: 'column', gap: 0, paddingX: 0, paddingY: 0, main: 'start', cross: 'start' }, children: [
      { type: 'group', id: 'g1', style: { width: 'fill', height: 'hug', fill: 'none', border: false, radius: 0 }, layout: { direction: 'row', gap: 8, paddingX: 0, paddingY: 0, main: 'start', cross: 'start' }, children: [
        { type: 'element', ref: 'id:flights', kind: 'list', appearance: 'cards', style: { width: 'fill', height: 'hug', fill: 'none', border: false, radius: 0 } },
      ] },
    ] }
    const html = renderToStaticMarkup(<ScreenMockupFrame screen={sectioned} layout={saved} />)
    expect(html).not.toContain('<table')
    expect(html).toContain('minmax(200px, 1fr)')
  })

  it('카드 목록과 버튼 모양을 코드에도 옮긴다', () => {
    let root = setAppearance(defaultLayout(screen), 'element:id:flights', 'cards')
    root = setAppearance(root, 'element:id:back', 'link')
    const react = reactCode(screen, root)
    expect(react).toContain('<Card key={row.id}>')
    expect(react).toContain('<Button variant="link">돌아가기</Button>')
    expect(composeCode(screen, root)).toContain('LazyVerticalGrid(columns = GridCells.Adaptive(200.dp)')
  })
})

describe('디자인 전용 컴포넌트', () => {
  it('배지·아바타·통계·탭·진행 막대·검색칸을 그리고 코드로 낸다', () => {
    const base = defaultLayout(screen)
    const next = idFactory(base)
    const nodes = (['badge', 'avatar', 'stat', 'tabs', 'progress', 'search'] as const).map((kind) => createDesignNode(kind, next('d')))
    const root = nodes.reduce<GroupNode>((tree, node) => insertNode(tree, node, 'group:root', 0), base)
    const html = renderToStaticMarkup(<ScreenMockupFrame screen={screen} layout={root} theme="shadcn" />)
    expect(html).toContain('role="tablist"')
    expect(html).toContain('지표 이름')
    expect(html).toContain('60%')
    const react = reactCode(screen, root)
    for (const name of ['Badge', 'Avatar', 'Tabs', 'Progress', 'Input']) expect(react).toContain(`import { ${name}`)
    expect(react).toContain('<CardDescription>지표 이름</CardDescription>')
  })

  it('카드 격자·통계·가격표 섹션은 문서 요소 없이 만든다', () => {
    for (const template of ['card-grid', 'stats-row', 'profile-card', 'pricing', 'tabs-panel'] as const) {
      const section = createSection(template, idFactory(defaultLayout(screen)))
      expect(JSON.stringify(section)).not.toContain('"type":"element"')
      expect(parseLayoutNode(JSON.parse(JSON.stringify(section)))).toEqual(section)
    }
  })
})
