import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { COMPONENT_NAMES, COMPONENTS, componentStyles, cssToText, DEFAULT_TOKENS, parseDesignSystem, resolveValue, systemVariables, textToCss } from './design-system'
import { createDesignNode, createSection, defaultLayout, DESIGN_LABEL, idFactory, insertNode, parseLayoutNode, patchNode, type GroupNode } from './layout-tree'
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

describe('목록·버튼의 컴포넌트 모양', () => {
  it('같은 목록을 표·카드·한 줄 목록으로 그린다', () => {
    const cards = patchNode(defaultLayout(screen), 'element:id:flights', { variant: 'cards' })
    const html = renderToStaticMarkup(<ScreenMockupFrame screen={screen} layout={cards} />)
    expect(html).not.toContain('<table')
    expect(html).toContain('grid-template-columns:repeat(auto-fill, minmax(200px, 1fr))')
    // 첫 글자 필드가 카드 제목, 선택 필드는 배지, 나머지는 이름: 값 줄이다.
    expect(html).toContain('편명 1')
    expect(html).toMatch(/<dt[^>]*>운임<\/dt>/)
    expect(html).toContain('일반')

    const list = renderToStaticMarkup(<ScreenMockupFrame screen={screen} layout={patchNode(defaultLayout(screen), 'element:id:flights', { variant: 'list' })} />)
    expect(list).toContain('<ul')
    expect(renderToStaticMarkup(<ScreenMockupFrame screen={screen} />)).toContain('<table')
  })

  it('모양은 저장했다 다시 읽어도 남고, 모르는 값은 컴포넌트 기본값으로 그린다', () => {
    const root = patchNode(defaultLayout(screen), 'element:id:back', { variant: 'link' })
    const parsed = parseLayoutNode(JSON.parse(JSON.stringify(root))) as GroupNode
    expect(parsed.children[1]).toMatchObject({ ref: 'id:back', variant: 'link' })
    const unknown = patchNode(defaultLayout(screen), 'element:id:flights', { variant: 'carousel' })
    expect(renderToStaticMarkup(<ScreenMockupFrame screen={screen} layout={unknown} />)).toContain('<table')
  })

  it('영역 밖에 놓인 요소도 고른 모양은 잃지 않는다', () => {
    const sectioned: ScreenMockup = { ...screen, elements: [{ kind: 'section', id: 'body', children: screen.elements }] }
    // AI 가 구역 안 목록을 루트 바로 아래 프레임에 넣은 모양이다.
    const saved: GroupNode = { type: 'group', id: 'root', style: { width: 'fill', height: 'fill' }, layout: { direction: 'column', gap: 0, paddingX: 0, paddingY: 0, main: 'start', cross: 'start' }, children: [
      { type: 'group', id: 'g1', style: { width: 'fill', height: 'hug' }, layout: { direction: 'row', gap: 8, paddingX: 0, paddingY: 0, main: 'start', cross: 'start' }, children: [
        { type: 'element', ref: 'id:flights', kind: 'list', variant: 'cards', css: { outline: '3px dashed red' }, style: { width: 'fill', height: 'hug' } },
      ] },
    ] }
    const html = renderToStaticMarkup(<ScreenMockupFrame screen={sectioned} layout={saved} />)
    expect(html).not.toContain('<table')
    expect(html).toContain('minmax(200px, 1fr)')
    expect(html).toContain('outline:3px dashed red')
  })
})

describe('디자인 전용 컴포넌트', () => {
  it('배지·아바타·통계·탭·진행 막대·검색칸·입력칸·체크박스·스위치를 그린다', () => {
    const base = defaultLayout(screen)
    const next = idFactory(base)
    const nodes = (['badge', 'avatar', 'stat', 'tabs', 'progress', 'search', 'input', 'checkbox', 'switch'] as const).map((kind) => createDesignNode(kind, next('d')))
    const root = nodes.reduce<GroupNode>((tree, node) => insertNode(tree, node, 'group:root', 0), base)
    const html = renderToStaticMarkup(<ScreenMockupFrame screen={screen} layout={root} />)
    expect(html).toContain('role="tablist"')
    expect(html).toContain('지표 이름')
    expect(html).toContain('60%')
    expect(html).toContain('안내 문구')
  })

  it('섹션은 문서 요소 없이 만들고 저장했다 읽어도 같다', () => {
    for (const template of ['card-grid', 'stats-row', 'profile-card', 'pricing', 'tabs-panel', 'cta-banner', 'signup-form'] as const) {
      const section = createSection(template, idFactory(defaultLayout(screen)))
      expect(JSON.stringify(section)).not.toContain('"type":"element"')
      expect(parseLayoutNode(JSON.parse(JSON.stringify(section)))).toEqual(section)
    }
  })
})

describe('디자인 시스템', () => {
  it('토큰을 CSS 변수로 깔고 값 안의 $이름을 변수로 바꾼다', () => {
    expect(resolveValue('1px solid $border-strong')).toBe('1px solid var(--wf-border-strong)')
    expect(resolveValue('"$5" $primary')).toBe('"$5" var(--wf-primary)')
    const vars = systemVariables({ tokens: { primary: '#2563eb', brand: '$primary' } }) as Record<string, string>
    expect(vars['--wf-primary']).toBe('#2563eb')
    expect(vars['--wf-brand']).toBe('var(--wf-primary)')
    expect(vars['--wf-border']).toBe('var(--color-border)')
  })

  it('기본 → 축 값 → 문서 덮어쓰기 → 노드 css 순으로 쌓는다', () => {
    const system = { components: { button: { base: { borderRadius: '999px' }, variants: { variant: { primary: { background: 'navy' } } } } } }
    const styles = componentStyles(system, 'button', { variant: 'primary', size: 'lg' }, { parts: {} })
    expect(styles.root).toMatchObject({ display: 'inline-flex', minHeight: 44, borderRadius: '999px', background: 'navy', color: 'var(--wf-primary-foreground)' })
    expect(componentStyles(undefined, 'button', { variant: 'nope' }).value('variant')).toBe('primary')
    const tabs = componentStyles(undefined, 'tabs', { variant: 'pills' }, { parts: { active: { color: 'red' } } })
    expect(tabs.part('active')).toMatchObject({ background: 'var(--wf-background)', color: 'red' })
  })

  it('노드 css 가 컴포넌트 스타일과 크기 규칙보다 이긴다', () => {
    const base = defaultLayout(screen)
    const node = { ...createDesignNode('button', 'd1'), text: 'CTA', variant: 'outline', css: { background: '$accent', 'border-radius': '0', width: '200px' } }
    const html = renderToStaticMarkup(<ScreenMockupFrame screen={screen} layout={insertNode(base, node, 'group:root', 0)} system={{ tokens: { accent: 'hotpink' } }} />)
    expect(html).toContain('--wf-accent:hotpink')
    const style = /<span style="([^"]*)">CTA<\/span>/.exec(html)![1]!
    const declarations = Object.fromEntries(style.split(';').map((declaration) => declaration.split(/:(.*)/s).slice(0, 2)))
    expect(declarations).toMatchObject({ background: 'var(--wf-accent)', 'border-radius': '0', width: '200px', 'border-color': 'var(--wf-border-strong)' })
    // 크기의 바탕값(min-height: 0)이 컴포넌트 크기(size 축)를 지우지 않는다.
    expect(declarations['min-height']).toBe('36px')
  })

  it('CSS 글을 읽고 쓰며, 읽지 못한 줄은 알려 준다', () => {
    const { css, errors } = textToCss('background: url("a;b.png");\nborder-radius: 12px\n/* 주석 */ color: $primary;\n이상한 줄\n--wf-foreground: white')
    expect(css).toEqual({ background: 'url("a;b.png")', borderRadius: '12px', color: '$primary', '--wf-foreground': 'white' })
    expect(errors).toEqual(['이상한 줄'])
    expect(cssToText(css)).toBe('background: url("a;b.png");\nborder-radius: 12px;\ncolor: $primary;\n--wf-foreground: white;')
  })

  it('파일의 디자인 시스템에서 모르는 컴포넌트와 잘못된 값만 버린다', () => {
    expect(parseDesignSystem({ tokens: { primary: '#000', 'Bad Name': 'x', size: 4 }, components: { button: { base: { 'border-radius': 4, 'not a prop': 'x' } }, widget: { base: { color: 'red' } } } }))
      .toEqual({ tokens: { primary: '#000', size: '4' }, components: { button: { base: { borderRadius: 4 } } } })
    expect(parseDesignSystem('shadcn')).toBeUndefined()
  })
})

describe('AI 프롬프트와 디자인 시스템', () => {
  it('프롬프트가 모든 컴포넌트·축 값·파트·토큰을 같은 이름으로 설명한다', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const prompt = readFileSync(resolve(__dirname, '../../../../api/src/dahaze_api/infrastructure/llm/prompts/agent_system_ko.md'), 'utf8')
    const guide = prompt.slice(prompt.indexOf('<!-- wireframe -->'), prompt.indexOf('<!-- /wireframe -->'))
    const missing: string[] = []
    const need = (name: string) => { if (!guide.includes(`\`${name}\``)) missing.push(name) }
    for (const name of COMPONENT_NAMES) {
      need(name)
      for (const [axis, spec] of Object.entries(COMPONENTS[name].axes)) {
        need(axis)
        need(spec.default)
        Object.keys(spec.options).forEach(need)
      }
      Object.keys(COMPONENTS[name].parts).forEach(need)
    }
    Object.keys(DEFAULT_TOKENS).forEach(need)
    Object.keys(DESIGN_LABEL).forEach(need)
    expect(missing).toEqual([])
  })
})
