import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { composeCode } from './compose-code'
import { canMove, changeDirection, createDesignNode, createGroup, defaultLayout, deleteNode, findNode, insertNode, moveNode, parseLayouts, resolveLayout, shiftNode, unwrapGroup, updateNode, wrapNode, type GroupNode } from './layout-tree'
import type { ScreenMockup } from './screen-layouts'
import { ScreenMockupFrame } from './screen-mockup'

const screen: ScreenMockup = {
  key: 'checkout.rspdl:shop.checkout', screenId: 'shop.checkout', screenName: '결제', path: 'checkout.rspdl', kind: 'page',
  elements: [
    { kind: 'header', id: 'top', children: [{ kind: 'heading', id: 'title', text: '주문 확인' }] },
    { kind: 'section', id: 'content', children: [
      { kind: 'button', id: 'pay', name: '결제하기', actionId: 'payment' },
      { kind: 'placeholder', id: null, text: '상품 이미지 영역' },
    ] },
  ],
}

const keys = (root: GroupNode) => JSON.stringify(root, (key, value: unknown) => key === 'style' || key === 'layout' ? undefined : value)

describe('배치 트리', () => {
  it('문서 구조에서 Column·Row 기본 배치를 만든다', () => {
    const root = defaultLayout(screen)
    expect(root.layout.direction).toBe('column')
    expect(findNode(root, 'element:id:top')).toMatchObject({ kind: 'header', layout: { direction: 'row' } })
    expect(findNode(root, 'element:path:elements.1.children.1')).toMatchObject({ kind: 'placeholder' })
  })

  it('요소는 자기가 선언된 영역 안에서만 옮긴다', () => {
    const root = defaultLayout(screen)
    expect(canMove(root, 'element:id:pay', 'element:id:content')).toBe(true)
    expect(canMove(root, 'element:id:pay', 'element:id:top')).toBe(false)
    expect(canMove(root, 'element:id:content', 'element:id:content')).toBe(false)
    expect(moveNode(root, 'element:id:pay', 'element:id:top', 0)).toBe(root)
    const moved = moveNode(root, 'element:id:pay', 'element:id:content', 1)
    expect((findNode(moved, 'element:id:content') as GroupNode).children.map((child) => child.type === 'element' ? child.ref : child.id)).toEqual(['path:elements.1.children.1', 'id:pay'])
    expect(shiftNode(moved, 'element:id:pay', -1)).toEqual(root)
  })

  it('감싼 그룹 안으로도 같은 영역의 요소만 들어간다', () => {
    const wrapped = wrapNode(defaultLayout(screen), 'element:id:pay', 'row', 'g1')
    expect(findNode(wrapped, 'group:g1')).toMatchObject({ layout: { direction: 'row' }, children: [{ ref: 'id:pay' }] })
    expect(canMove(wrapped, 'element:path:elements.1.children.1', 'group:g1')).toBe(true)
    expect(canMove(wrapped, 'element:id:title', 'group:g1')).toBe(false)
    expect(keys(unwrapGroup(wrapped, 'group:g1'))).toBe(keys(defaultLayout(screen)))
  })

  it('문서가 바뀌면 사라진 요소를 빼고 새 요소를 영역 끝에 붙이며, 사용자가 만든 빈 프레임은 남긴다', () => {
    const saved = updateNode(wrapNode(defaultLayout(screen), 'element:id:pay', 'row', 'g1'), 'group:g1', { layout: { gap: 24 } })
    const next: ScreenMockup = { ...screen, elements: [screen.elements[0]!, { kind: 'section', id: 'content', children: [
      { kind: 'heading', id: 'notice', text: '안내' },
    ] }] }
    const resolved = resolveLayout(next, saved)
    expect(findNode(resolved, 'group:g1')).toMatchObject({ children: [] })
    expect(findNode(resolved, 'element:id:pay')).toBeNull()
    expect(findNode(resolved, 'element:id:notice')).not.toBeNull()
    expect(resolveLayout(screen, saved)).toEqual(saved)
  })

  it('잘못된 저장값은 버리고 기본 배치로 그린다', () => {
    expect(parseLayouts({ broken: { type: 'group', id: 'root', style: { width: 'huge' } }, ok: defaultLayout(screen) })).toEqual({ ok: defaultLayout(screen) })
  })

  it('배치를 목업과 Compose 코드에 같은 규칙으로 반영한다', () => {
    const root = updateNode(defaultLayout(screen), 'element:id:content', { layout: { direction: 'row', main: 'space-between', cross: 'center' } })
    const html = renderToStaticMarkup(<ScreenMockupFrame screen={screen} layout={root} />)
    expect(html).toContain('data-layout="row"')
    expect(html).toContain('justify-content:space-between')
    expect(html).toContain('결제하기')
    const code = composeCode(screen, root)
    expect(code).toContain('fun CheckoutScreen()')
    expect(code).toContain('modifier = Modifier.fillMaxSize(),')
    expect(code).toContain('horizontalArrangement = Arrangement.SpaceBetween')
    expect(code).toContain('Button(onClick = { /* payment */ }')
    expect(code).toContain('Text("주문 확인", style = MaterialTheme.typography.titleMedium)')
  })
})

describe('방향 바꾸기', () => {
  it('Column 과 Row 를 오가도 보이는 정렬을 지킨다', () => {
    const column = { direction: 'column' as const, gap: 8, paddingX: 0, paddingY: 0, main: 'start' as const, cross: 'center' as const }
    expect(changeDirection(column, 'row')).toMatchObject({ direction: 'row', main: 'center', cross: 'start' })
    expect(changeDirection(changeDirection(column, 'row'), 'column')).toEqual(column)
    expect(changeDirection({ ...column, direction: 'row', main: 'space-between' }, 'box')).toMatchObject({ main: 'center', cross: 'start' })
  })
})

describe('프레임과 디자인 전용 노드', () => {
  const withText = () => {
    const root = defaultLayout(screen)
    return insertNode(root, { ...createDesignNode('text', 'd1'), text: '안내 문구' }, 'element:id:content', 0)
  }

  it('디자인 노드는 어느 영역으로든 옮기고 문서가 바뀌어도 남는다', () => {
    const root = withText()
    expect(canMove(root, 'design:d1', 'element:id:top')).toBe(true)
    const moved = moveNode(root, 'design:d1', 'element:id:top', 0)
    expect((findNode(moved, 'element:id:top') as GroupNode).children[0]).toMatchObject({ type: 'design', text: '안내 문구' })
    expect(findNode(resolveLayout(screen, moved), 'design:d1')).not.toBeNull()
  })

  it('빈 프레임을 넣고 그 안으로 요소를 옮긴다', () => {
    const root = insertNode(defaultLayout(screen), createGroup('row', 'g9'), 'element:id:content', 0)
    expect(findNode(root, 'group:g9')).toMatchObject({ children: [] })
    const moved = moveNode(root, 'element:id:pay', 'group:g9', 0)
    expect(findNode(moved, 'group:g9')).toMatchObject({ children: [{ ref: 'id:pay' }] })
  })

  it('디자인 노드와 프레임만 지우고, 지운 프레임 안의 기획 요소는 남긴다', () => {
    const root = insertNode(wrapNode(withText(), 'element:id:pay', 'row', 'g1'), createDesignNode('divider', 'd2'), 'group:g1', 0)
    expect(deleteNode(root, 'element:id:pay')).toBe(root)
    expect(findNode(deleteNode(root, 'design:d1'), 'design:d1')).toBeNull()
    const ungrouped = deleteNode(root, 'group:g1')
    expect(findNode(ungrouped, 'group:g1')).toBeNull()
    expect(findNode(ungrouped, 'design:d2')).toBeNull()
    expect(findNode(ungrouped, 'element:id:pay')).not.toBeNull()
  })

  it('회색만 저장하고 예전 강조색은 회색으로 읽는다', () => {
    const root = updateNode(withText(), 'design:d1', { style: { fill: 'strong' } })
    expect(parseLayouts({ s: root }).s).toEqual(root)
    const legacy = JSON.parse(JSON.stringify(root).replace('"fill":"strong"', '"fill":"accent"'))
    expect(findNode(parseLayouts({ s: legacy }).s!, 'design:d1')?.style.fill).toBe('gray')
  })

  it('디자인 노드를 목업과 Compose 코드에 그린다', () => {
    const root = insertNode(insertNode(withText(), createDesignNode('spacer', 'd3'), 'element:id:content', 1), createDesignNode('rectangle', 'd4'), 'element:id:content', 2)
    const html = renderToStaticMarkup(<ScreenMockupFrame screen={screen} layout={root} />)
    expect(html).toContain('안내 문구')
    const code = composeCode(screen, root)
    expect(code).toContain('Text("안내 문구", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) // 디자인 전용')
    expect(code).toContain('Spacer(modifier = Modifier.width(16.dp).height(16.dp)) // 디자인 전용')
    expect(code).toContain('Box(modifier = Modifier.fillMaxWidth().height(120.dp).background(MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(4.dp))) // 디자인 전용')
  })
})
