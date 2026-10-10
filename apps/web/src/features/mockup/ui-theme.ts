import type { CSSProperties } from 'react'

/**
 * 목업을 어떤 UI 프레임워크의 기본 모양으로 그릴지.
 *
 * 구조(무엇이 어디에 있는가)는 문서와 배치 트리가 정하고, 테마는 그 위의 겉모양만 바꾼다. 그래서
 * 컴포넌트마다 분기하지 않고 목업 뷰포트에 CSS 변수 한 벌을 바꿔 끼운다. 렌더러의 클래스는 이
 * 변수(`--wf-*`)만 읽는다.
 *
 * 색은 각 프레임워크의 기본 팔레트를 따른다. `wireframe` 은 앱 토큰의 회색 단계만 쓴다.
 */
export type UiTheme = 'wireframe' | 'shadcn' | 'material' | 'bootstrap'

export const UI_THEMES: UiTheme[] = ['wireframe', 'shadcn', 'material', 'bootstrap']

export const UI_THEME_LABEL: Record<UiTheme, string> = {
  wireframe: '회색 와이어프레임',
  shadcn: 'shadcn/ui',
  material: 'Material 3',
  bootstrap: 'Bootstrap 5',
}

export function isUiTheme(value: unknown): value is UiTheme {
  return typeof value === 'string' && (UI_THEMES as string[]).includes(value)
}

type Vars = Record<`--wf-${string}`, string>

const WIREFRAME: Vars = {
  '--wf-font': 'inherit',
  '--wf-bg': 'var(--color-surface)',
  '--wf-fg': 'var(--color-text)',
  '--wf-muted-fg': 'var(--color-text-muted)',
  '--wf-subtle-fg': 'var(--color-text-subtle)',
  '--wf-muted': 'var(--color-surface-raised)',
  '--wf-border': 'var(--color-border)',
  '--wf-border-strong': 'var(--color-border-strong)',
  '--wf-primary': 'var(--color-surface-raised)',
  '--wf-primary-fg': 'var(--color-text)',
  '--wf-primary-border': 'var(--color-border-strong)',
  '--wf-secondary': 'var(--color-surface)',
  '--wf-secondary-fg': 'var(--color-text)',
  '--wf-radius': '6px',
  '--wf-button-radius': '6px',
  '--wf-input-bg': 'var(--color-surface)',
  '--wf-input-border': 'var(--color-border-strong)',
  '--wf-input-radius': '6px',
  '--wf-card-shadow': 'none',
  '--wf-image': 'var(--color-surface-raised)',
  '--wf-nav-active': 'var(--color-surface)',
  '--wf-nav-active-fg': 'var(--color-text)',
  '--wf-heading-weight': '600',
}

const SHADCN: Vars = {
  ...WIREFRAME,
  // 각 프레임워크의 라틴 글꼴을 앞에 두고, 한글은 앱 글꼴로 내려앉게 한다.
  '--wf-font': 'Geist, Inter, var(--font-sans)',
  '--wf-bg': '#ffffff',
  '--wf-fg': '#09090b',
  '--wf-muted-fg': '#71717a',
  '--wf-subtle-fg': '#a1a1aa',
  '--wf-muted': '#f4f4f5',
  '--wf-border': '#e4e4e7',
  '--wf-border-strong': '#d4d4d8',
  '--wf-primary': '#18181b',
  '--wf-primary-fg': '#fafafa',
  '--wf-primary-border': '#18181b',
  '--wf-secondary': '#ffffff',
  '--wf-secondary-fg': '#18181b',
  '--wf-radius': '10px',
  '--wf-button-radius': '6px',
  '--wf-input-bg': '#ffffff',
  '--wf-input-border': '#e4e4e7',
  '--wf-input-radius': '6px',
  '--wf-card-shadow': '0 1px 2px rgb(0 0 0 / 0.05)',
  '--wf-image': '#f4f4f5',
  '--wf-nav-active': '#f4f4f5',
  '--wf-nav-active-fg': '#18181b',
  '--wf-heading-weight': '600',
}

const MATERIAL: Vars = {
  ...WIREFRAME,
  '--wf-font': 'Roboto, var(--font-sans)',
  '--wf-bg': '#fef7ff',
  '--wf-fg': '#1d1b20',
  '--wf-muted-fg': '#49454f',
  '--wf-subtle-fg': '#79747e',
  '--wf-muted': '#f3edf7',
  '--wf-border': '#e7e0ec',
  '--wf-border-strong': '#cac4d0',
  '--wf-primary': '#6750a4',
  '--wf-primary-fg': '#ffffff',
  '--wf-primary-border': '#6750a4',
  '--wf-secondary': 'transparent',
  '--wf-secondary-fg': '#6750a4',
  '--wf-radius': '12px',
  '--wf-button-radius': '999px',
  '--wf-input-bg': '#f3edf7',
  '--wf-input-border': '#79747e',
  '--wf-input-radius': '4px 4px 0 0',
  '--wf-card-shadow': '0 1px 3px rgb(0 0 0 / 0.12)',
  '--wf-image': '#eaddff',
  '--wf-nav-active': '#e8def8',
  '--wf-nav-active-fg': '#1d192b',
  '--wf-heading-weight': '500',
}

const BOOTSTRAP: Vars = {
  ...WIREFRAME,
  '--wf-font': '"Segoe UI", var(--font-sans)',
  '--wf-bg': '#ffffff',
  '--wf-fg': '#212529',
  '--wf-muted-fg': '#6c757d',
  '--wf-subtle-fg': '#adb5bd',
  '--wf-muted': '#f8f9fa',
  '--wf-border': '#dee2e6',
  '--wf-border-strong': '#ced4da',
  '--wf-primary': '#0d6efd',
  '--wf-primary-fg': '#ffffff',
  '--wf-primary-border': '#0d6efd',
  '--wf-secondary': '#6c757d',
  '--wf-secondary-fg': '#ffffff',
  '--wf-radius': '6px',
  '--wf-button-radius': '6px',
  '--wf-input-bg': '#ffffff',
  '--wf-input-border': '#ced4da',
  '--wf-input-radius': '6px',
  '--wf-card-shadow': '0 2px 4px rgb(0 0 0 / 0.075)',
  '--wf-image': '#e9ecef',
  '--wf-nav-active': '#0d6efd',
  '--wf-nav-active-fg': '#ffffff',
  '--wf-heading-weight': '500',
}

const VARS: Record<UiTheme, Vars> = { wireframe: WIREFRAME, shadcn: SHADCN, material: MATERIAL, bootstrap: BOOTSTRAP }

/** 앱 토큰을 테마 팔레트로 덮는다. 렌더러의 `text-text-muted`·`bg-surface` 같은 클래스가 그대로 따라온다. */
function tokenOverrides(vars: Vars): Record<string, string> {
  return {
    '--color-text': vars['--wf-fg']!,
    '--color-text-muted': vars['--wf-muted-fg']!,
    '--color-text-subtle': vars['--wf-subtle-fg']!,
    '--color-surface': vars['--wf-bg']!,
    '--color-surface-raised': vars['--wf-muted']!,
    '--color-canvas': vars['--wf-bg']!,
    '--color-border': vars['--wf-border']!,
    '--color-border-strong': vars['--wf-border-strong']!,
  }
}

export function themeVariables(theme: UiTheme = 'wireframe'): CSSProperties {
  const vars = VARS[theme]
  return {
    ...vars,
    ...(theme === 'wireframe' ? {} : tokenOverrides(vars)),
    fontFamily: 'var(--wf-font)',
    color: 'var(--wf-fg)',
  } as CSSProperties
}
