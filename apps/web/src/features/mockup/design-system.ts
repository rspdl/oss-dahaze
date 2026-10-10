import type { CSSProperties } from 'react'

/**
 * 와이어프레임 전용 디자인 시스템.
 *
 * 특정 UI 프레임워크를 흉내 내지 않는다. 대신 두 생각만 빌린다.
 *
 * - **토큰**(shadcn 의 CSS 변수): 색·모서리·그림자·글꼴·글자 크기를 이름으로 부른다. 목업 뷰포트에
 *   `--wf-<이름>` 변수로 깔리고, CSS 값 안의 `$이름` 은 `var(--wf-이름)` 으로 바뀐다.
 * - **컴포넌트 = 기본 + 변형 축 + 파트**(shadcn 의 cva, Compose 의 Modifier): 컴포넌트마다 기본
 *   스타일이 있고, `variant`·`size`·`tone` 같은 축의 값이 그 위에 스타일을 더한다. 안쪽 조각(표의
 *   칸, 입력의 라벨 등)은 파트라는 이름으로 따로 스타일을 받는다.
 *
 * 스타일은 끝까지 CSS 다. 문서마다 토큰과 컴포넌트 스타일을 덮어쓸 수 있고(`DesignSystem`), 노드마다
 * `css`·`parts` 로 아무 CSS 속성이나 덮어쓸 수 있다. 쌓이는 순서는 언제나
 * `기본 → 변형 → 문서의 컴포넌트 덮어쓰기 → 노드 css` 다.
 *
 * 기본 토큰은 회색 단계만 쓰고 앱 토큰을 따라 밝은·어두운 모드를 함께 탄다.
 */

/** CSS 속성 → 값. 키는 camelCase·kebab-case·`--사용자-변수` 모두 받는다. 값의 `$이름` 은 토큰이다. */
export type Css = Record<string, string | number>

export interface ComponentOverride {
  base?: Css
  /** 축 → 값 → 스타일. 예: `{ variant: { primary: { background: '#2563eb' } } }` */
  variants?: Record<string, Record<string, Css>>
  parts?: Record<string, Css>
}

export interface DesignSystem {
  /** 기본 토큰을 덮어쓰거나 새 토큰을 더한다. 값은 CSS 값이다. */
  tokens?: Record<string, string>
  components?: Partial<Record<ComponentName, ComponentOverride>>
}

/* ---------- 토큰 ---------- */

export type TokenGroup = 'color' | 'radius' | 'shadow' | 'font' | 'text'

export interface TokenSpec {
  group: TokenGroup
  label: string
  value: string
}

const color = (label: string, value: string): TokenSpec => ({ group: 'color', label, value })

export const DEFAULT_TOKENS: Record<string, TokenSpec> = {
  background: color('화면 배경', 'var(--color-surface)'),
  foreground: color('글자', 'var(--color-text)'),
  'muted-foreground': color('보조 글자', 'var(--color-text-muted)'),
  'subtle-foreground': color('흐린 글자', 'var(--color-text-subtle)'),
  muted: color('옅은 면', 'var(--color-surface-raised)'),
  card: color('카드 면', 'var(--color-surface)'),
  border: color('테두리', 'var(--color-border)'),
  'border-strong': color('진한 테두리', 'var(--color-border-strong)'),
  input: color('입력칸 테두리', 'var(--color-border-strong)'),
  primary: color('주 색', 'var(--color-text)'),
  'primary-foreground': color('주 색 위 글자', 'var(--color-surface)'),
  secondary: color('보조 면', 'var(--color-surface-raised)'),
  'secondary-foreground': color('보조 면 위 글자', 'var(--color-text)'),
  accent: color('선택 면', 'var(--color-surface-raised)'),
  'accent-foreground': color('선택 면 위 글자', 'var(--color-text)'),
  destructive: color('위험', 'var(--color-text)'),
  'destructive-foreground': color('위험 위 글자', 'var(--color-surface)'),
  image: color('이미지 자리', 'var(--color-surface-raised)'),
  ring: color('강조 테두리', 'var(--color-text)'),
  'radius-sm': { group: 'radius', label: '작은 모서리', value: '4px' },
  'radius-md': { group: 'radius', label: '보통 모서리', value: '6px' },
  'radius-lg': { group: 'radius', label: '큰 모서리', value: '12px' },
  'radius-full': { group: 'radius', label: '둥근 모서리', value: '9999px' },
  'shadow-sm': { group: 'shadow', label: '얕은 그림자', value: '0 1px 2px rgb(0 0 0 / 0.05)' },
  'shadow-md': { group: 'shadow', label: '보통 그림자', value: '0 4px 12px rgb(0 0 0 / 0.08)' },
  'shadow-lg': { group: 'shadow', label: '깊은 그림자', value: '0 12px 32px rgb(0 0 0 / 0.12)' },
  'font-sans': { group: 'font', label: '본문 글꼴', value: 'var(--font-sans)' },
  'font-heading': { group: 'font', label: '제목 글꼴', value: 'var(--font-sans)' },
  'font-mono': { group: 'font', label: '고정폭 글꼴', value: 'var(--font-mono)' },
  'text-display': { group: 'text', label: '큰 제목', value: '34px' },
  'text-title': { group: 'text', label: '제목', value: '16px' },
  'text-body': { group: 'text', label: '본문', value: '14px' },
  'text-label': { group: 'text', label: '라벨', value: '12px' },
  'text-caption': { group: 'text', label: '캡션', value: '11px' },
}

export const TOKEN_GROUP_LABEL: Record<TokenGroup, string> = { color: '색', radius: '모서리', shadow: '그림자', font: '글꼴', text: '글자 크기' }

const TOKEN_NAME = /^[a-z][a-z0-9-]{0,47}$/

export function isTokenName(name: string): boolean {
  return TOKEN_NAME.test(name)
}

/** 문서의 토큰까지 합친 최종 토큰. */
export function resolvedTokens(system: DesignSystem | undefined): Record<string, string> {
  return { ...Object.fromEntries(Object.entries(DEFAULT_TOKENS).map(([name, spec]) => [name, spec.value])), ...system?.tokens }
}

/** 목업 뷰포트에 까는 변수. 글꼴과 글자색도 토큰을 따른다. */
export function systemVariables(system: DesignSystem | undefined): CSSProperties {
  const vars = Object.fromEntries(Object.entries(resolvedTokens(system)).map(([name, value]) => [`--wf-${name}`, resolveValue(value)]))
  return { ...vars, fontFamily: 'var(--wf-font-sans)', color: 'var(--wf-foreground)', background: 'var(--wf-background)' } as CSSProperties
}

/* ---------- CSS 값 ---------- */

/** `$primary` → `var(--wf-primary)`. 따옴표 안의 글자는 건드리지 않는다. */
export function resolveValue(value: string | number): string | number {
  if (typeof value === 'number') return value
  return value.replace(/("[^"]*"|'[^']*')|\$([a-z][a-z0-9-]*)/g, (match, quoted: string | undefined, name: string | undefined) => quoted ?? `var(--wf-${name})`)
}

function camelCase(property: string): string {
  if (property.startsWith('--')) return property
  return property.trim().replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

function kebabCase(property: string): string {
  if (property.startsWith('--')) return property
  return property.replace(/^ms([A-Z])/, '-ms-$1').replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

/** 저장된 CSS 를 React 스타일로. 토큰을 풀고 속성 이름을 camelCase 로 맞춘다. */
export function toStyle(css: Css | undefined): CSSProperties {
  if (css === undefined) return {}
  const result: Record<string, string | number> = {}
  for (const [property, value] of Object.entries(css)) result[camelCase(property)] = resolveValue(value)
  return result as CSSProperties
}

export function mergeCss(...layers: (Css | undefined)[]): Css {
  const result: Css = {}
  for (const layer of layers) {
    if (layer === undefined) continue
    // 같은 속성을 다른 표기(kebab·camel)로 쓴 경우에도 뒤 층이 이기게 한 표기로 모은다.
    for (const [property, value] of Object.entries(layer)) result[camelCase(property)] = value
  }
  return result
}

/** 편집기에서 쓰는 `속성: 값;` 글. 한 줄에 하나. */
export function cssToText(css: Css | undefined): string {
  if (css === undefined) return ''
  return Object.entries(css).map(([property, value]) => `${kebabCase(property)}: ${value};`).join('\n')
}

/**
 * `속성: 값;` 글을 읽는다. 읽지 못한 줄은 버리지 않고 알려 준다 — 사람이 친 것이 소리 없이
 * 사라지면 안 된다.
 */
export function textToCss(text: string): { css: Css; errors: string[] } {
  const css: Css = {}
  const errors: string[] = []
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const declaration of splitDeclarations(withoutComments)) {
    const trimmed = declaration.trim()
    if (trimmed === '') continue
    const at = trimmed.indexOf(':')
    const property = at <= 0 ? '' : trimmed.slice(0, at).trim()
    const value = at <= 0 ? '' : trimmed.slice(at + 1).trim()
    if (!isCssProperty(property) || value === '') { errors.push(trimmed); continue }
    css[camelCase(property)] = value.slice(0, MAX_VALUE_LENGTH)
  }
  return { css, errors }
}

/** `;` 로 나누되 따옴표·괄호 안의 `;` 는 넘는다. 줄바꿈도 선언의 끝으로 본다. */
function splitDeclarations(text: string): string[] {
  const result: string[] = []
  let current = ''
  let depth = 0
  let quote: string | null = null
  for (const char of text) {
    if (quote !== null) { current += char; if (char === quote) quote = null; continue }
    if (char === '"' || char === "'") { quote = char; current += char; continue }
    if (char === '(') depth += 1
    if (char === ')') depth = Math.max(0, depth - 1)
    if ((char === ';' || char === '\n') && depth === 0) { result.push(current); current = ''; continue }
    current += char
  }
  result.push(current)
  return result
}

const MAX_VALUE_LENGTH = 500
const MAX_PROPERTIES = 120
const CSS_PROPERTY = /^(--[A-Za-z0-9_-]{1,64}|-?[A-Za-z][A-Za-z0-9-]{0,63})$/

export function isCssProperty(property: string): boolean {
  return CSS_PROPERTY.test(property)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 파일에서 읽은 CSS. 속성 이름이 아니거나 값이 글자·숫자가 아니면 그 속성만 버린다. */
export function parseCss(value: unknown): Css | undefined {
  if (!isRecord(value)) return undefined
  const result: Css = {}
  for (const [property, raw] of Object.entries(value).slice(0, MAX_PROPERTIES)) {
    if (!isCssProperty(property)) continue
    // `border-radius` 와 `borderRadius` 를 한 이름으로 모아야 편집기와 덮어쓰기가 같은 속성을 본다.
    if (typeof raw === 'number' && Number.isFinite(raw)) result[camelCase(property)] = raw
    else if (typeof raw === 'string' && raw.trim() !== '') result[camelCase(property)] = raw.slice(0, MAX_VALUE_LENGTH)
  }
  return Object.keys(result).length === 0 ? undefined : result
}

export function parseParts(value: unknown): Record<string, Css> | undefined {
  if (!isRecord(value)) return undefined
  const result: Record<string, Css> = {}
  for (const [part, raw] of Object.entries(value)) {
    const css = parseCss(raw)
    if (css !== undefined && /^[a-z][a-zA-Z0-9-]{0,31}$/.test(part)) result[part] = css
  }
  return Object.keys(result).length === 0 ? undefined : result
}

export function parseDesignSystem(value: unknown): DesignSystem | undefined {
  if (!isRecord(value)) return undefined
  const system: DesignSystem = {}
  if (isRecord(value.tokens)) {
    const tokens: Record<string, string> = {}
    for (const [name, raw] of Object.entries(value.tokens)) {
      if (!isTokenName(name)) continue
      if (typeof raw === 'string' && raw.trim() !== '') tokens[name] = raw.slice(0, MAX_VALUE_LENGTH)
      else if (typeof raw === 'number' && Number.isFinite(raw)) tokens[name] = String(raw)
    }
    if (Object.keys(tokens).length > 0) system.tokens = tokens
  }
  if (isRecord(value.components)) {
    const components: DesignSystem['components'] = {}
    for (const [name, raw] of Object.entries(value.components)) {
      if (!isComponentName(name) || !isRecord(raw)) continue
      const override: ComponentOverride = {}
      const base = parseCss(raw.base)
      if (base !== undefined) override.base = base
      const parts = parseParts(raw.parts)
      if (parts !== undefined) override.parts = parts
      if (isRecord(raw.variants)) {
        const variants: Record<string, Record<string, Css>> = {}
        for (const [axis, options] of Object.entries(raw.variants)) {
          if (!isRecord(options)) continue
          const parsed = Object.fromEntries(Object.entries(options).flatMap(([option, css]) => {
            const value = parseCss(css)
            return value === undefined ? [] : [[option, value]]
          }))
          if (Object.keys(parsed).length > 0) variants[axis] = parsed
        }
        if (Object.keys(variants).length > 0) override.variants = variants
      }
      if (Object.keys(override).length > 0) components[name] = override
    }
    if (Object.keys(components).length > 0) system.components = components
  }
  return Object.keys(system).length === 0 ? undefined : system
}

/* ---------- 컴포넌트 ---------- */

export interface AxisSpec {
  label: string
  default: string
  options: Record<string, { label: string; css: Css; parts?: Record<string, Css> }>
}

export interface ComponentSpec {
  label: string
  base: Css
  axes: Record<string, AxisSpec>
  parts: Record<string, { label: string; css: Css }>
}

export type ComponentName =
  | 'frame' | 'text' | 'button' | 'badge' | 'image' | 'avatar' | 'icon' | 'stat' | 'tabs' | 'progress'
  | 'search' | 'field' | 'checkbox' | 'switch' | 'list' | 'placeholder' | 'divider' | 'spacer' | 'rectangle'

/** 노드가 고른 축 값. 고르지 않은 축은 컴포넌트의 기본값이다. */
export type AxisValues = Partial<Record<string, string>>

const axis = (label: string, fallback: string, options: AxisSpec['options']): AxisSpec => ({ label, default: fallback, options })
const part = (label: string, css: Css) => ({ label, css })

const TEXT_SIZES: AxisSpec['options'] = {
  display: { label: '큰 제목', css: { fontSize: '$text-display', lineHeight: 1.15, fontWeight: 700, letterSpacing: '-0.02em', fontFamily: '$font-heading' } },
  title: { label: '제목', css: { fontSize: '$text-title', lineHeight: 1.35, fontWeight: 600, letterSpacing: '-0.01em', fontFamily: '$font-heading' } },
  body: { label: '본문', css: { fontSize: '$text-body', lineHeight: 1.55 } },
  label: { label: '라벨', css: { fontSize: '$text-label', lineHeight: 1.4, fontWeight: 500 } },
  caption: { label: '캡션', css: { fontSize: '$text-caption', lineHeight: 1.4 } },
}

const TONES: AxisSpec['options'] = {
  strong: { label: '진하게', css: { color: '$foreground' } },
  default: { label: '보통', css: { color: '$muted-foreground' } },
  muted: { label: '흐리게', css: { color: '$subtle-foreground' } },
  inherit: { label: '부모 따름', css: { color: 'inherit' } },
}

const CONTROL_SIZES: AxisSpec['options'] = {
  sm: { label: '작게', css: { minHeight: 28, paddingInline: 10, fontSize: 11 } },
  md: { label: '보통', css: { minHeight: 36, paddingInline: 16, fontSize: 12 } },
  lg: { label: '크게', css: { minHeight: 44, paddingInline: 24, fontSize: 14 } },
}

export const COMPONENTS: Record<ComponentName, ComponentSpec> = {
  frame: {
    label: '프레임',
    base: {},
    axes: {
      variant: axis('모양', 'plain', {
        plain: { label: '없음', css: {} },
        card: { label: '카드', css: { background: '$card', border: '1px solid $border', borderRadius: '$radius-lg', boxShadow: '$shadow-sm' } },
        muted: { label: '옅은 면', css: { background: '$muted' } },
        outline: { label: '테두리', css: { border: '1px solid $border', borderRadius: '$radius-md' } },
        // 안쪽 글자가 주 색 위에서 읽히도록 글자 토큰을 이 프레임 안에서만 바꾼다.
        primary: { label: '주 색', css: { background: '$primary', color: '$primary-foreground', borderRadius: '$radius-lg', '--wf-foreground': 'var(--wf-primary-foreground)', '--wf-muted-foreground': 'color-mix(in srgb, var(--wf-primary-foreground) 80%, transparent)', '--wf-subtle-foreground': 'color-mix(in srgb, var(--wf-primary-foreground) 60%, transparent)' } },
      }),
    },
    parts: {},
  },
  text: {
    label: '텍스트',
    base: { margin: 0, whiteSpace: 'pre-wrap' },
    axes: { variant: axis('글자 크기', 'body', TEXT_SIZES), tone: axis('글자 색', 'default', TONES) },
    parts: {},
  },
  button: {
    label: '버튼',
    base: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '1px solid transparent', borderRadius: '$radius-md', fontWeight: 500, whiteSpace: 'nowrap', cursor: 'default' },
    axes: {
      variant: axis('모양', 'primary', {
        primary: { label: '주', css: { background: '$primary', color: '$primary-foreground', borderColor: '$primary' } },
        secondary: { label: '보조', css: { background: '$secondary', color: '$secondary-foreground', borderColor: '$border-strong' } },
        outline: { label: '테두리', css: { background: 'transparent', color: '$foreground', borderColor: '$border-strong' } },
        ghost: { label: '텍스트', css: { background: 'transparent', color: '$foreground' } },
        link: { label: '링크', css: { background: 'transparent', color: '$foreground', textDecoration: 'underline', textUnderlineOffset: 3, paddingInline: 0, minHeight: 0 } },
        destructive: { label: '위험', css: { background: '$destructive', color: '$destructive-foreground', borderColor: '$destructive' } },
      }),
      size: axis('크기', 'md', CONTROL_SIZES),
    },
    parts: {},
  },
  badge: {
    label: '배지',
    base: { display: 'inline-flex', alignItems: 'center', border: '1px solid transparent', borderRadius: '$radius-full', paddingInline: 8, paddingBlock: 2, fontSize: 10, fontWeight: 500, whiteSpace: 'nowrap' },
    axes: {
      variant: axis('모양', 'secondary', {
        primary: { label: '강조', css: { background: '$primary', color: '$primary-foreground' } },
        secondary: { label: '기본', css: { background: '$muted', color: '$foreground' } },
        outline: { label: '테두리', css: { background: 'transparent', color: '$foreground', borderColor: '$border-strong' } },
        destructive: { label: '위험', css: { background: '$destructive', color: '$destructive-foreground' } },
      }),
    },
    parts: {},
  },
  image: {
    label: '이미지',
    base: { position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', minHeight: 64, background: '$image', borderRadius: '$radius-lg' },
    axes: {},
    parts: {
      cross: part('대각선', { stroke: '$border-strong' }),
      caption: part('설명', { position: 'relative', borderRadius: '$radius-sm', paddingInline: 8, paddingBlock: 2, fontSize: 11, background: '$background', color: '$muted-foreground' }),
    },
  },
  avatar: {
    label: '아바타',
    base: { display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '$radius-full', background: '$muted', color: '$muted-foreground', fontSize: 11, fontWeight: 600, overflow: 'hidden' },
    axes: { size: axis('크기', 'md', { sm: { label: '작게', css: { width: 28, height: 28 } }, md: { label: '보통', css: { width: 40, height: 40 } }, lg: { label: '크게', css: { width: 56, height: 56, fontSize: 14 } } }) },
    parts: {},
  },
  icon: {
    label: '아이콘',
    base: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '$radius-sm', background: '$muted', color: '$subtle-foreground' },
    axes: {},
    parts: {},
  },
  stat: {
    label: '통계',
    base: { display: 'flex', flexDirection: 'column', gap: 4, padding: 16, background: '$card', border: '1px solid $border', borderRadius: '$radius-lg', boxShadow: '$shadow-sm' },
    axes: {},
    parts: {
      label: part('이름', { fontSize: 11, color: '$muted-foreground' }),
      value: part('값', { fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: '$foreground' }),
    },
  },
  tabs: {
    label: '탭',
    base: { display: 'flex', gap: 4, width: '100%' },
    axes: {
      variant: axis('모양', 'underline', {
        underline: { label: '밑줄', css: { borderBottom: '1px solid $border' }, parts: { tab: { marginBottom: -1, borderBottom: '2px solid transparent' }, active: { borderBottomColor: '$primary' } } },
        pills: { label: '알약', css: { padding: 4, background: '$muted', borderRadius: '$radius-md', width: 'fit-content' }, parts: { tab: { borderRadius: '$radius-sm' }, active: { background: '$background', boxShadow: '$shadow-sm' } } },
      }),
    },
    parts: {
      tab: part('탭', { paddingInline: 12, paddingBlock: 8, fontSize: 12, color: '$muted-foreground' }),
      active: part('선택된 탭', { fontWeight: 600, color: '$foreground' }),
    },
  },
  progress: {
    label: '진행 막대',
    base: { display: 'flex', flexDirection: 'column', gap: 4, width: '100%' },
    axes: {},
    parts: {
      label: part('이름 줄', { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '$muted-foreground' }),
      track: part('막대', { height: 8, borderRadius: '$radius-full', background: '$muted', overflow: 'hidden' }),
      bar: part('채운 부분', { height: '100%', borderRadius: '$radius-full', background: '$primary' }),
    },
  },
  search: {
    label: '검색칸',
    base: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 36, paddingInline: 12, border: '1px solid $input', borderRadius: '$radius-md', background: '$background', fontSize: 11, color: '$subtle-foreground' },
    axes: {},
    parts: {},
  },
  field: {
    label: '입력칸',
    base: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
    axes: {
      variant: axis('모양', 'outline', {
        outline: { label: '테두리', css: {}, parts: { control: { border: '1px solid $input', borderRadius: '$radius-md', background: '$background' } } },
        filled: { label: '채움', css: {}, parts: { control: { border: '1px solid transparent', borderRadius: '$radius-md', background: '$muted' } } },
        underline: { label: '밑줄', css: {}, parts: { control: { border: 'none', borderBottom: '1px solid $input', borderRadius: 0, paddingInline: 0, background: 'transparent' } } },
      }),
      size: axis('크기', 'md', { sm: { label: '작게', css: {}, parts: { control: { minHeight: 28 } } }, md: { label: '보통', css: {}, parts: { control: { minHeight: 36 } } }, lg: { label: '크게', css: {}, parts: { control: { minHeight: 44, fontSize: 13 } } } }),
    },
    parts: {
      label: part('라벨', { fontSize: 12, fontWeight: 500, color: '$foreground' }),
      hint: part('형식 안내', { fontSize: 10, color: '$subtle-foreground' }),
      control: part('칸', { display: 'flex', alignItems: 'center', gap: 8, paddingInline: 10, fontSize: 11, color: '$subtle-foreground' }),
      option: part('선택값', { borderRadius: '$radius-sm', background: '$muted', paddingInline: 6, paddingBlock: 2, fontSize: 10, color: '$muted-foreground' }),
    },
  },
  checkbox: {
    label: '체크박스',
    base: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: '$foreground' },
    axes: {},
    parts: { box: part('상자', { width: 16, height: 16, flexShrink: 0, border: '1px solid $input', borderRadius: '$radius-sm', background: '$background' }) },
  },
  switch: {
    label: '스위치',
    base: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: '$foreground' },
    axes: {},
    parts: {
      track: part('바탕', { display: 'flex', alignItems: 'center', width: 32, height: 18, flexShrink: 0, padding: 2, borderRadius: '$radius-full', background: '$border-strong' }),
      thumb: part('손잡이', { width: 14, height: 14, borderRadius: '$radius-full', background: '$background' }),
    },
  },
  list: {
    label: '목록',
    base: {},
    axes: {
      variant: axis('모양', 'table', {
        table: { label: '표', css: { overflow: 'hidden', border: '1px solid $border', borderRadius: '$radius-lg', background: '$card', boxShadow: '$shadow-sm' }, parts: { header: { paddingInline: 12, paddingBlock: 8, borderBottom: '1px solid $border' } } },
        cards: { label: '카드', css: {}, parts: { header: { paddingBottom: 8 } } },
        list: { label: '한 줄 목록', css: {}, parts: { header: { paddingBottom: 8 } } },
      }),
    },
    parts: {
      header: part('머리 줄', { display: 'flex', alignItems: 'baseline', gap: 8 }),
      title: part('이름', { fontSize: 12, fontWeight: 600, color: '$foreground' }),
      meta: part('건수', { fontSize: 10, color: '$subtle-foreground' }),
      head: part('표 머리 칸', { paddingInline: 12, paddingBlock: 6, textAlign: 'left', fontSize: 10, fontWeight: 600, color: '$muted-foreground', background: 'color-mix(in srgb, var(--wf-muted) 60%, transparent)', borderBottom: '1px solid $border' }),
      cell: part('표 칸', { paddingInline: 12, paddingBlock: 8, fontSize: 11, color: '$muted-foreground', borderBottom: '1px solid $border' }),
      card: part('카드', { display: 'flex', flexDirection: 'column', gap: 8, padding: 16, background: '$card', border: '1px solid $border', borderRadius: '$radius-lg', boxShadow: '$shadow-sm' }),
      item: part('한 줄', { display: 'flex', alignItems: 'center', gap: 12, paddingInline: 12, paddingBlock: 10, background: '$card', borderBottom: '1px solid $border' }),
      selected: part('고른 줄', { background: '$accent', color: '$accent-foreground' }),
      empty: part('빈 목록', { paddingInline: 12, paddingBlock: 20, textAlign: 'center', fontSize: 11, color: '$subtle-foreground' }),
    },
  },
  placeholder: {
    label: '자리표시자',
    base: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 80, border: '1px dashed $border-strong', borderRadius: '$radius-md', background: '$muted', fontSize: 11, color: '$subtle-foreground' },
    axes: {},
    parts: {},
  },
  divider: {
    label: '구분선',
    base: { background: '$border-strong' },
    axes: {},
    parts: {},
  },
  spacer: { label: '여백', base: {}, axes: {}, parts: {} },
  rectangle: {
    label: '사각형',
    base: { minHeight: 16, background: '$border', borderRadius: '$radius-sm' },
    axes: {},
    parts: {},
  },
}

export function isComponentName(value: string): value is ComponentName {
  return Object.hasOwn(COMPONENTS, value)
}

/** 노드가 고른 값이 그 축에 있는지 보고, 없으면 기본값. */
export function axisValue(name: ComponentName, axisName: string, values: AxisValues): string | undefined {
  const spec = COMPONENTS[name].axes[axisName]
  if (spec === undefined) return undefined
  const chosen = values[axisName]
  return chosen !== undefined && Object.hasOwn(spec.options, chosen) ? chosen : spec.default
}

/**
 * 한 컴포넌트를 그릴 스타일 묶음. `root` 는 노드 자신, `part(이름)` 은 안쪽 조각이다.
 * 쌓는 순서: 기본 → 축 값 → 문서의 컴포넌트 덮어쓰기 → 노드 css.
 */
export interface ComponentStyles {
  root: CSSProperties
  part: (name: string) => CSSProperties
  /** 축의 최종 값. 렌더러가 모양마다 구조를 바꿀 때(표·카드 등) 쓴다. */
  value: (axis: string) => string | undefined
}

export function componentStyles(
  system: DesignSystem | undefined,
  name: ComponentName,
  values: AxisValues,
  node: { css?: Css; parts?: Record<string, Css> } = {},
): ComponentStyles {
  const spec = COMPONENTS[name]
  const override = system?.components?.[name]
  const chosen = Object.keys(spec.axes).map((axisName) => [axisName, axisValue(name, axisName, values)!] as const)
  const rootLayers: (Css | undefined)[] = [spec.base]
  for (const [axisName, option] of chosen) rootLayers.push(spec.axes[axisName]!.options[option]!.css)
  rootLayers.push(override?.base)
  for (const [axisName, option] of chosen) rootLayers.push(override?.variants?.[axisName]?.[option])
  rootLayers.push(node.css)
  const root = toStyle(mergeCss(...rootLayers))
  return {
    root,
    part: (partName) => {
      const layers: (Css | undefined)[] = [spec.parts[partName]?.css]
      for (const [axisName, option] of chosen) layers.push(spec.axes[axisName]!.options[option]!.parts?.[partName])
      layers.push(override?.parts?.[partName], node.parts?.[partName])
      return toStyle(mergeCss(...layers))
    },
    value: (axisName) => chosen.find(([candidate]) => candidate === axisName)?.[1],
  }
}

export const COMPONENT_NAMES = Object.keys(COMPONENTS) as ComponentName[]
