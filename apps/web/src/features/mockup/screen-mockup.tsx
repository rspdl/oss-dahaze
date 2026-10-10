'use client'

import * as React from 'react'
import { cn } from '@dahaze/ui'

import type {
  ControlKind,
  MockupElement,
  MockupField,
  ScreenMockup,
} from './screen-layouts'
import type {
  ActionOutcome,
  MockupDimensions,
  ModelSampleSet,
  PrototypeAction,
  PrototypeMode,
  SampleVariant,
} from './prototype-contract'
import { declaredElements, isContainer, nodeKey, resolveLayout, type ContainerLayout, type DeclaredElement, type DesignNode, type LayoutNode } from './layout-tree'
import { childStyle, containerStyle } from './layout-style'
import type { AppShellModel } from './app-shell'
import { AppShellFrame } from './app-shell-frame'
import { themeVariables, type UiTheme } from './ui-theme'

/** 테마 변수(`ui-theme.ts`)를 읽는 입력칸·버튼 모양. */
const INPUT_STYLE: React.CSSProperties = { background: 'var(--wf-input-bg)', borderColor: 'var(--wf-input-border)', borderRadius: 'var(--wf-input-radius)' }
function buttonStyle(variant: 'primary' | 'secondary' | 'ghost'): React.CSSProperties {
  if (variant === 'primary') return { background: 'var(--wf-primary)', color: 'var(--wf-primary-fg)', borderColor: 'var(--wf-primary-border)', borderRadius: 'var(--wf-button-radius)' }
  if (variant === 'secondary') return { background: 'var(--wf-secondary)', color: 'var(--wf-secondary-fg)', borderColor: 'var(--wf-border-strong)', borderRadius: 'var(--wf-button-radius)' }
  return { background: 'transparent', color: 'var(--wf-fg)', borderColor: 'transparent', borderRadius: 'var(--wf-button-radius)' }
}
const BUTTON_CLASS = 'inline-flex min-h-9 items-center justify-center border px-4 text-xs font-medium whitespace-nowrap'

/**
 * 선언된 레이아웃을 화면처럼 그린다.
 *
 * **여기에 LLM 이 없다.** 의미 구조는 문서가 선언한 것이고, 배치는 별도 디자인 상태인
 * Column·Row·Box 트리(`layout-tree.ts`)다. 같은 IR·트리·샘플 상태는 같은 그림을 낸다.
 *
 * 그리는 것은 **목업**이지 동작하는 폼이 아니다. 그래서 입력칸은 진짜 `input` 이 아니라
 * 입력칸처럼 보이는 상자다. 보드 위 노드 안에 진짜 폼 컨트롤을 넣으면 캔버스를 키보드로
 * 지나갈 때마다 칸마다 걸리고, 사용자는 채울 수 없는 칸에 커서를 잡히게 된다. 라벨은 읽히고
 * 상자는 장식이다.
 *
 * 문서가 말하지 않은 것은 그리지 않는다. 샘플 내용이 붙기 전까지 칸은 비어 있고, 비어 있는
 * 것은 아무 사실도 주장하지 않는다.
 */

/** 목업을 그릴 폭. 실제 기기 폭이라야 배치가 진짜 화면처럼 읽힌다. */
export type MockupViewport = 'desktop' | 'mobile'

export const DEFAULT_VIEWPORT_DIMENSIONS: Record<MockupViewport, MockupDimensions> = {
  desktop: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 },
}

export interface ScreenMockupFrameProps {
  screen: ScreenMockup
  viewport?: MockupViewport
  showCaption?: boolean
  dimensions?: MockupDimensions
  mode?: PrototypeMode
  sampleVariant?: SampleVariant
  samples?: ModelSampleSet[]
  outcomesByElementId?: Readonly<Record<string, ActionOutcome[]>>
  selectedOutcomeIdByElementId?: Readonly<Record<string, string>>
  activeOutcome?: ActionOutcome | null
  /** 저장된 배치 트리. 없거나 문서와 어긋난 부분은 기본 배치로 채운다. */
  layout?: LayoutNode
  /** 화면 편집기에서만 준다. 노드를 고르고 강조할 수 있게 한다. */
  editor?: LayoutEditorBindings
  onAction?: (action: PrototypeAction) => void
  onOutcomeSelect?: (elementId: string, outcomeId: string) => void
  onOutcomeDismiss?: () => void
  selectedSampleIdByModel?: Readonly<Record<string, string>>
  onSampleSelect?: (modelId: string, recordId: string) => void
  values?: Readonly<Record<string, string | boolean>>
  onValueChange?: (fieldId: string, value: string | boolean) => void
  /** 앱 틀(왼쪽 메뉴·경로). 정보구조에 담긴 화면만 받는다. 없으면 화면 내용만 그린다. */
  shell?: AppShellModel | null
  /** 체험 모드에서 메뉴 항목을 눌렀을 때. */
  onNavigate?: (screenKey: string) => void
  /** 겉모양을 따를 UI 프레임워크. 구조는 바꾸지 않는다. */
  theme?: UiTheme
  className?: string
}

export interface LayoutEditorBindings {
  selectedKey: string | null
  hoveredKey: string | null
  onSelect: (key: string) => void
  onHover: (key: string | null) => void
}

interface ElementContext extends Omit<ScreenMockupFrameProps, 'screen' | 'viewport' | 'dimensions' | 'className' | 'showCaption' | 'layout' | 'shell' | 'onNavigate' | 'theme'> {
  screenKey: string
  declared: Map<string, DeclaredElement>
}

/** 입력칸 모양을 사람이 읽을 이름으로. 색이나 모양에만 기대지 않기 위해 텍스트로도 남긴다. */
const CONTROL_LABEL: Record<ControlKind, string> = {
  text: '글자',
  number: '숫자',
  date: '날짜',
  time: '시각',
  datetime: '날짜와 시각',
  select: '선택',
  checkbox: '예/아니오',
}

/** 칸 안에 흐리게 보이는 입력 형식. 값이 아니라 형식이라 지어낸 내용이 아니다. */
const CONTROL_FORMAT: Partial<Record<ControlKind, string>> = {
  number: '0',
  date: 'YYYY-MM-DD',
  time: 'HH:mm',
  datetime: 'YYYY-MM-DD HH:mm',
  select: '선택하세요',
}

function FieldLabel({ field, hint = false }: { field: MockupField; hint?: boolean }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span
        className={cn(
          'truncate text-xs font-medium',
          field.resolved ? 'text-text' : 'text-diagnostic-error',
        )}
      >
        {field.name}
      </span>
      {field.required ? (
        <span aria-label="필수" className="text-xs font-semibold text-text-muted">*</span>
      ) : null}
      {field.resolved ? null : (
        <span className="text-[10px] text-diagnostic-error">선언을 찾지 못함</span>
      )}
      {hint && field.resolved ? <span className="ml-auto shrink-0 pl-2 text-[10px] text-text-subtle">{CONTROL_LABEL[field.control]}</span> : null}
    </span>
  )
}

function ControlIcon({ control }: { control: ControlKind }) {
  const common = { 'aria-hidden': true, viewBox: '0 0 16 16', className: 'size-3.5 shrink-0 text-text-subtle', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 } as const
  switch (control) {
    case 'date':
    case 'datetime':
      return <svg {...common}><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg>
    case 'time':
      return <svg {...common}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></svg>
    case 'select':
      return <svg {...common}><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></svg>
    case 'number':
      return <svg {...common}><path d="m5.5 6.5 2.5-2.5 2.5 2.5M5.5 9.5 8 12l2.5-2.5" /></svg>
    default:
      return null
  }
}

/**
 * 입력칸. 관리 도구의 입력 폼처럼 값 형식에 맞는 모양으로 그린다.
 *
 * `select` 는 선언된 값들을 칸 아래에 그대로 보여준다. 그것은 지어낸 내용이 아니라 문서가 말한
 * 사실이라 화면에 드러나는 편이 낫다.
 */
function Control({ field, experience, value, onChange }: { field: MockupField; experience: boolean; value?: string | number | boolean | null; onChange?: (value: string | boolean) => void }) {
  if (experience) {
    if (field.control === 'checkbox') return <input aria-label={field.name} type="checkbox" checked={value === true} onChange={(event) => onChange?.(event.target.checked)} />
    if (field.control === 'select') {
      return <select aria-label={field.name} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange?.(event.target.value)} style={INPUT_STYLE} className="h-9 border px-2.5 text-xs"><option value="">선택하세요</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select>
    }
    const type = field.control === 'datetime' ? 'datetime-local' : field.control
    return <input aria-label={field.name} type={type} value={typeof value === 'string' || typeof value === 'number' ? value : ''} onChange={(event) => onChange?.(event.target.value)} style={INPUT_STYLE} className="h-9 border px-2.5 text-xs" />
  }
  if (field.control === 'checkbox') {
    return (
      <span className="flex h-9 items-center gap-2">
        <span aria-hidden className="flex h-4 w-7 shrink-0 items-center rounded-full p-0.5" style={{ background: 'var(--wf-border-strong)' }}><span className="size-3 rounded-full bg-white" /></span>
        <span className="text-[11px] text-text-subtle">아니오</span>
      </span>
    )
  }

  const format = CONTROL_FORMAT[field.control]
  return (
    <span className="flex flex-col gap-1">
      <span className="flex h-9 items-center gap-2 border px-2.5" style={INPUT_STYLE}>
        <span className={cn('min-w-0 flex-1 truncate text-[11px] text-text-subtle/70', field.control === 'number' && 'text-right')}>{format ?? ''}</span>
        <ControlIcon control={field.control} />
      </span>
      {field.control === 'select' && field.options !== null && field.options.length > 0 ? (
        <span className="flex flex-wrap gap-1">
          {field.options.map((option) => (
            <span key={option} className="rounded-sm bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-muted">{option}</span>
          ))}
        </span>
      ) : null}
    </span>
  )
}

function Input({ field, experience, value, onChange }: { field: MockupField; experience: boolean; value?: string | number | boolean | null; onChange?: (value: string | boolean) => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel field={field} hint />
      <Control field={field} experience={experience} value={value} onChange={onChange} />
    </div>
  )
}

/** 표 칸의 예시 값. 값이 아니라 형식을 보여준다 — 문서가 말하지 않은 숫자·날짜를 지어내지 않는다. */
export function exampleValue(field: MockupField, index: number, long = false): string {
  switch (field.control) {
    case 'number': return '000'
    case 'date': return 'YYYY-MM-DD'
    case 'time': return 'HH:mm'
    case 'datetime': return 'YYYY-MM-DD HH:mm'
    case 'select': return field.options === null || field.options.length === 0 ? '선택값' : field.options[index % field.options.length]!
    case 'checkbox': return index % 2 === 0 ? '예' : '아니오'
    default: return long ? `${field.name} ${index + 1} — 길게 표시되는 경우의 예시 문구` : `${field.name} ${index + 1}`
  }
}

/**
 * 목록.
 *
 * 선언된 필드가 열이 된다. 줄은 비워 둔다 — 샘플 내용이 붙기 전에 값을 지어내면 기획자가
 * 쓰지 않은 것을 쓴 것처럼 보인다. 빈 줄은 "여기에 데이터가 온다" 는 자리일 뿐이다.
 */
function ListElement({
  modelId,
  modelName,
  fields,
  records,
  isExample,
  selectedId,
  onSelect,
}: {
  modelId: string
  modelName: string
  fields: MockupField[]
  records: ModelSampleSet['variants'][SampleVariant] | null
  isExample: boolean
  selectedId?: string
  onSelect?: (modelId: string, recordId: string) => void
}) {
  return (
    <div className="overflow-hidden border border-border bg-surface" style={{ borderRadius: 'var(--wf-radius)', boxShadow: 'var(--wf-card-shadow)' }}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-text">{modelName}</span>
        <span className="text-[10px] text-text-subtle">{records === null ? '' : `${records.length}건`}{isExample ? ' · 형식 예시' : ''}</span>
      </div>
      {records !== null && records.length === 0 ? (
        <div className="px-3 py-5 text-center text-[11px] text-text-subtle">{modelName} 샘플이 비어 있습니다</div>
      ) : fields.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-text-subtle">보여줄 필드가 없다</div>
      ) : (
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b border-border bg-surface-raised/60">
              {fields.map((field) => (
                <th key={field.id} className={cn('px-3 py-1.5 text-left', field.control === 'number' && 'text-right')}>
                  <span className={cn('block truncate text-[10px] font-semibold', field.resolved ? 'text-text-muted' : 'text-diagnostic-error')}>{field.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(records ?? []).map((record) => (
              <tr key={record.id} aria-selected={record.id === selectedId} className={cn('border-b border-border last:border-b-0', record.id === selectedId && 'bg-accent-subtle')} onClick={() => onSelect?.(modelId, record.id)}>
                {fields.map((field) => (
                  <td key={field.id} className={cn('px-3 py-2', field.control === 'number' && 'text-right')}>
                    <span className={cn('block truncate text-[11px] text-text-muted', field.control !== 'text' && 'font-mono text-[10px]')}>{String(record.values[field.id] ?? '')}</span>
                  </td>
                ))}
              </tr>
            ))}
            {records === null ? [0, 1, 2].map((row) => <tr key={row} aria-hidden className="border-b border-border last:border-b-0">{fields.map((field) => <td key={field.id} className="px-3 py-2"><span className="block h-2 rounded-full bg-shimmer" /></td>)}</tr>) : null}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * 선언할 수 없는 자리.
 *
 * 지도·차트처럼 의미 단위 어휘로 옮길 수 없는 것은 이름표만 달고 비운다. 채우는 것은
 * 디자인의 일이다.
 */
function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-20 items-center justify-center rounded-md border border-dashed border-border-strong bg-surface-raised">
      <span className="text-[11px] text-text-subtle">{text}</span>
    </div>
  )
}

/**
 * 알아보지 못한 요소.
 *
 * 조용히 떨어뜨리지 않는다. 떨어뜨리면 렌더러가 문서에 대해 거짓말을 하게 되고, 사람은
 * 자기가 쓴 것이 왜 안 보이는지 알 길이 없다.
 */
function Unrecognized({
  rawKind,
  reason,
}: {
  rawKind: string
  reason: 'unknown-kind' | 'missing-data'
}) {
  const message =
    reason === 'unknown-kind'
      ? `모르는 요소${rawKind === '' ? '' : `: ${rawKind}`}`
      : `${rawKind} 요소에 필요한 값이 없다`

  return (
    <div className="rounded-md border border-dashed border-diagnostic-error bg-diagnostic-error-subtle px-3 py-2">
      <span className="text-[11px] text-diagnostic-error">{message}</span>
    </div>
  )
}

function editorProps(key: string, parentKey: string | null, context: ElementContext): React.HTMLAttributes<HTMLElement> & Record<`data-${string}`, string | undefined> {
  const editor = context.editor
  if (editor === undefined) return {}
  return {
    'data-node-key': key,
    'data-parent-key': parentKey ?? undefined,
    className: cn('outline-offset-[-1px]', editor.selectedKey === key ? 'outline-2 outline-text' : editor.hoveredKey === key ? 'outline-1 outline-text-subtle' : undefined),
    onClick: (event) => { event.stopPropagation(); editor.onSelect(key) },
    onPointerOver: (event) => { event.stopPropagation(); editor.onHover(key) },
  }
}

function LayoutNodeView({ node, parent, parentKey, context }: { node: LayoutNode; parent: ContainerLayout | null; parentKey: string | null; context: ElementContext }) {
  const key = nodeKey(node)
  const editing = editorProps(key, parentKey, context)
  const style = childStyle(node.style, parent)
  if (isContainer(node)) {
    const kind = node.type === 'element' ? node.kind : 'group'
    const Tag = kind === 'header' ? 'header' : kind === 'section' ? 'section' : 'div'
    return <Tag {...editing} data-layout={node.layout.direction} style={{ ...style, ...containerStyle(node.layout) }}>
      {node.children.map((child) => <LayoutNodeView key={nodeKey(child)} node={child} parent={node.layout} parentKey={key} context={context} />)}
      {node.children.length === 0 && context.editor !== undefined ? <EmptyFrame /> : null}
    </Tag>
  }
  if (node.type === 'design') {
    // Row 안의 구분선은 세로선이다. 너비 규칙과 상관없이 1px 폭으로 위아래를 채운다.
    const shown = node.design === 'divider' && parent?.direction === 'row' ? { ...style, flex: '0 0 auto', alignSelf: 'stretch', width: undefined } : style
    return <div {...editing} style={shown}><DesignContent node={node} parent={parent} editing={context.editor !== undefined} /></div>
  }
  if (node.type !== 'element') return null
  const entry = context.declared.get(node.ref)
  if (entry === undefined) return null
  return <div {...editing} style={style}>
    <LeafContent element={entry.element} context={context} stretch={{ width: node.style.width !== 'hug', height: node.style.height !== 'hug' }} />
  </div>
}

/** 편집기에서만 보이는 빈 프레임 자리. 요소를 끌어 넣을 수 있게 크기를 준다. */
function EmptyFrame() {
  return <div aria-hidden className="flex min-h-10 min-w-16 flex-1 items-center justify-center self-stretch rounded border border-dashed border-border-strong text-[10px] text-text-subtle">비어 있음</div>
}

const TEXT_CLASS = { display: 'text-[34px] leading-tight font-bold tracking-tight', title: 'text-base font-semibold tracking-tight', body: 'text-sm', caption: 'text-[11px]' } as const
const TONE_CLASS = { strong: 'text-text', default: 'text-text-muted', muted: 'text-text-subtle' } as const

/** 디자인 전용 노드. 문서에 없는 것이라 회색으로만 그린다. */
function DesignContent({ node, parent, editing }: { node: DesignNode; parent: ContainerLayout | null; editing: boolean }) {
  switch (node.design) {
    case 'text':
      return <p className={cn('whitespace-pre-wrap', TEXT_CLASS[node.textStyle ?? 'body'], TONE_CLASS[node.tone ?? 'default'])}>{node.text === '' ? '\u00a0' : node.text}</p>
    case 'rectangle':
      return <div className="size-full min-h-4" />
    case 'divider':
      return parent?.direction === 'row'
        ? <div className="h-full min-h-4 w-px self-stretch bg-border-strong" />
        : <div className="h-px w-full bg-border-strong" />
    case 'spacer':
      return <div className={cn('size-full', editing && 'bg-[repeating-linear-gradient(45deg,transparent_0_4px,var(--color-border)_4px_5px)]')} />
    case 'image':
      return (
        <div className="relative flex size-full min-h-16 items-center justify-center overflow-hidden" style={{ background: 'var(--wf-image)', borderRadius: 'inherit' }}>
          <svg aria-hidden className="absolute inset-0 size-full" preserveAspectRatio="none" viewBox="0 0 100 100"><path d="M0 0 100 100M100 0 0 100" stroke="var(--wf-border-strong)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" /></svg>
          <span className="relative rounded px-2 py-0.5 text-[11px] text-text-muted" style={{ background: 'var(--wf-bg)' }}>{node.text === undefined || node.text === '' ? '이미지' : node.text}</span>
        </div>
      )
    case 'button':
      return <span className={BUTTON_CLASS} style={{ ...buttonStyle(node.variant ?? 'primary'), width: node.style.width === 'hug' ? undefined : '100%' }}>{node.text === undefined || node.text === '' ? '버튼' : node.text}</span>
  }
}

function LeafContent({ element, context, stretch }: { element: MockupElement; context: ElementContext; stretch: { width: boolean; height: boolean } }) {
  const size = { width: stretch.width ? '100%' : undefined, height: stretch.height ? '100%' : undefined }
  switch (element.kind) {
    case 'heading':
      return (
        <h3 className="text-[15px] tracking-tight text-text" style={{ fontWeight: 'var(--wf-heading-weight)' as React.CSSProperties['fontWeight'] }}>{element.text}</h3>
      )
    case 'input':
      return <Input field={element.field} experience={context.mode === 'experience'} value={context.values?.[element.field.id] ?? selectedSampleValue(context, element.field.id)} onChange={(value) => context.onValueChange?.(element.field.id, value)} />
    case 'list': {
      const supplied = context.samples?.find((set) => set.modelId === element.modelId)
      const variant = context.sampleVariant ?? 'normal'
      const count = variant === 'empty' ? 0 : variant === 'many' ? 12 : 3
      const fallback = Array.from({ length: count }, (_, index) => ({ id: `${element.modelId}:example:${index + 1}`, values: Object.fromEntries(element.fields.map((field) => [field.id, exampleValue(field, index, variant === 'long')])) }))
      return <ListElement modelId={element.modelId} modelName={element.modelName} fields={element.fields} records={supplied?.variants[variant] ?? fallback} isExample={supplied === undefined} selectedId={context.selectedSampleIdByModel?.[element.modelId]} onSelect={context.onSampleSelect} />
    }
    case 'button': {
      // 행동을 선언한 버튼이 주 버튼이다. 행동이 없는 버튼(돌아가기 등)은 보조 버튼으로 그린다.
      const className = BUTTON_CLASS
      const look = { ...size, ...buttonStyle(element.actionId === null ? 'secondary' : 'primary') }
      if (context.mode !== 'experience') return <span style={look} className={className}>{element.name}</span>
      if (element.id === null) return <button type="button" disabled title="안정적 요소 ID가 없어 체험할 수 없습니다" style={look} className={cn(className, 'opacity-50')}>{element.name}</button>
      const elementId = element.id
      const outcomes = context.outcomesByElementId?.[elementId] ?? []
      if (outcomes.length === 0) return <button type="button" disabled title="선언된 결과가 없어 체험할 수 없습니다" style={look} className={cn(className, 'opacity-50')}>{element.name}</button>
      const selectedOutcome = outcomeForPreviewAction(outcomes, context.selectedOutcomeIdByElementId?.[elementId])
      return <button type="button" disabled={selectedOutcome === undefined} title={selectedOutcome === undefined ? '결과 시나리오를 먼저 선택하세요' : undefined} style={look} className={cn(className, 'disabled:opacity-50')} onClick={(event) => { event.stopPropagation(); dispatchPreviewAction(context.onAction, context.screenKey, elementId, outcomes, context.selectedOutcomeIdByElementId?.[elementId]) }}>{element.name}</button>
    }
    case 'placeholder':
      return <Placeholder text={element.text} />
    case 'unrecognized':
      return <Unrecognized rawKind={element.rawKind} reason={element.reason} />
    default:
      return null
  }
}

/** 시나리오를 고르는 것만으로는 실행하지 않는다. 선언된 버튼을 누를 때 선택 결과를 해석한다. */
export function outcomeForPreviewAction(outcomes: readonly ActionOutcome[], selectedOutcomeId?: string): ActionOutcome | undefined {
  if (outcomes.length === 1) return outcomes[0]
  return outcomes.find((outcome) => outcome.id === selectedOutcomeId)
}

export function dispatchPreviewAction(onAction: ScreenMockupFrameProps['onAction'], screenKey: string, elementId: string, outcomes: readonly ActionOutcome[], selectedOutcomeId?: string): void {
  const outcome = outcomeForPreviewAction(outcomes, selectedOutcomeId)
  if (outcome !== undefined) onAction?.({ screenKey, elementId, outcome })
}

function scenarioControls(elements: readonly MockupElement[], outcomesByElementId: Readonly<Record<string, ActionOutcome[]>>): { elementId: string; name: string; outcomes: ActionOutcome[] }[] {
  return elements.flatMap((element) => {
    if (element.kind === 'button' && element.id !== null) {
      const outcomes = outcomesByElementId[element.id] ?? []
      return outcomes.length > 1 ? [{ elementId: element.id, name: element.name, outcomes }] : []
    }
    if (element.kind === 'header' || element.kind === 'section') return scenarioControls(element.children, outcomesByElementId)
    if (element.kind === 'form') return scenarioControls(element.inputs, outcomesByElementId)
    return []
  })
}

const HANDLER_LABEL = { state: '상태', message: '메시지', popup: '팝업', loading: '로딩' } as const
const FRAME_HORIZONTAL_BORDER = 2

function OutcomePreview({ outcome, onDismiss }: { outcome: ActionOutcome | null | undefined; onDismiss?: () => void }) {
  const handler = outcome?.handler
  if (handler === null || handler === undefined) return null
  const heading = `${HANDLER_LABEL[handler.kind]} · ${handler.id}`
  const content = handler.content === null || handler.content === undefined || handler.content === '' ? null : handler.content
  const close = <button type="button" className="shrink-0 rounded border border-border-strong bg-surface px-2 py-1 text-[11px]" onClick={onDismiss}>미리보기 닫기</button>

  if (handler.kind === 'popup') {
    return <div data-outcome-preview="popup" className="absolute inset-0 z-20 flex items-center justify-center bg-black/35 p-6"><div role="dialog" aria-modal="false" aria-label={`선언된 ${handler.kind} handler`} className="w-full max-w-sm rounded-lg border border-border-strong bg-surface p-4 text-text shadow-xl"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{heading}</p>{content === null ? null : <p className="mt-2 text-sm text-text-muted">{content}</p>}</div>{close}</div></div></div>
  }
  if (handler.kind === 'loading') {
    return <div data-outcome-preview="loading" role="status" aria-label={`선언된 ${handler.kind} handler`} className="absolute inset-0 z-20 flex items-center justify-center bg-surface/85 p-6"><div className="flex max-w-sm items-center gap-3 rounded-lg border border-border-strong bg-surface px-4 py-3 shadow-lg"><span aria-hidden className="size-4 animate-spin rounded-full border-2 border-border-strong border-t-text" /><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{heading}</p>{content === null ? null : <p className="mt-1 text-xs text-text-muted">{content}</p>}</div>{close}</div></div>
  }
  return <div data-outcome-preview={handler.kind} role="status" aria-label={`선언된 ${handler.kind} handler`} className="absolute inset-x-3 bottom-3 z-20 flex items-start gap-3 rounded-lg border border-border-strong bg-surface px-3 py-2 text-text shadow-lg"><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{heading}</p>{content === null ? null : <p className="mt-1 text-xs text-text-muted">{content}</p>}</div>{close}</div>
}

function selectedSampleValue(context: ElementContext, fieldId: string): string | number | boolean | null | undefined {
  for (const sample of context.samples ?? []) {
    const selectedId = context.selectedSampleIdByModel?.[sample.modelId]
    if (selectedId === undefined) continue
    const row = sample.variants[context.sampleVariant ?? 'normal'].find((entry) => entry.id === selectedId)
    if (row !== undefined && fieldId in row.values) return row.values[fieldId]
  }
  return undefined
}

/**
 * 화면 하나를 기기 폭에 맞춰 그린다.
 *
 * 폭은 prop 이다. 프로젝트마다 고르는 설정은 서버에 있지만 그 값을 읽는 것은 보드의 일이고,
 * 렌더러는 어느 폭으로 그릴지만 안다.
 */
export function ScreenMockupFrame({
  screen,
  viewport = 'desktop',
  showCaption = true,
  className,
  dimensions,
  mode = 'edit', sampleVariant = 'normal', samples, outcomesByElementId,
  selectedOutcomeIdByElementId, activeOutcome,
  layout, editor,
  onAction, onOutcomeSelect, onOutcomeDismiss,
  selectedSampleIdByModel, onSampleSelect,
  values, onValueChange,
  shell, onNavigate, theme = 'wireframe',
}: ScreenMockupFrameProps) {
  const declared = React.useMemo(() => declaredElements(screen), [screen])
  const root = React.useMemo(() => resolveLayout(screen, layout), [screen, layout])
  const context: ElementContext = { screenKey: screen.key, declared, mode, sampleVariant, samples, outcomesByElementId, selectedOutcomeIdByElementId, activeOutcome, editor, onAction, onOutcomeSelect, onOutcomeDismiss, selectedSampleIdByModel, onSampleSelect, values, onValueChange }
  const rootEditing = editorProps(nodeKey(root), null, context)
  const controls = mode === 'experience' ? scenarioControls(screen.elements, outcomesByElementId ?? {}) : []
  const viewportDimensions = dimensions ?? DEFAULT_VIEWPORT_DIMENSIONS[viewport]
  const body = screen.elements.length === 0 ? (
    <div className="px-4 py-6 text-[11px] text-text-subtle">
      레이아웃에 요소가 없다
    </div>
  ) : (
    <div {...rootEditing} data-layout={root.layout.direction} style={{ ...childStyle(root.style, null), ...containerStyle(root.layout), overflow: 'auto' }}>
      {root.children.map((child) => <LayoutNodeView key={nodeKey(child)} node={child} parent={root.layout} parentKey={nodeKey(root)} context={context} />)}
    </div>
  )
  return (
    <figure
      className={cn(
        'flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-canvas',
        className,
      )}
      style={{ width: viewportDimensions.width + FRAME_HORIZONTAL_BORDER }}
    >
      {showCaption ? <figcaption className="flex items-baseline gap-2 border-b border-border bg-surface px-4 py-2">
        <span className="text-xs font-semibold text-text">
          {screen.screenName ?? screen.screenId}
        </span>
        {screen.kind === null ? null : (
          <span className="text-[10px] text-text-subtle">{screen.kind}</span>
        )}
      </figcaption> : null}

      {controls.length === 0 ? null : <div aria-label="결과 시나리오 선택" className="flex min-w-0 flex-wrap gap-2 border-b border-border bg-surface-raised px-4 py-2 text-[11px] text-text-muted">{controls.map((control) => <label key={control.elementId} className="flex min-w-0 flex-1 flex-wrap items-center gap-2"><span className="min-w-0 break-words">{control.name} 결과 시나리오</span><select aria-label={`${control.name} 결과 시나리오`} value={outcomeForPreviewAction(control.outcomes, selectedOutcomeIdByElementId?.[control.elementId])?.id ?? ''} onChange={(event) => onOutcomeSelect?.(control.elementId, event.target.value)} className="min-w-0 max-w-full flex-[1_1_12rem] rounded border border-border-strong bg-surface px-2 py-1 text-text"><option value="" disabled>결과 선택</option>{control.outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.label}</option>)}</select></label>)}</div>}

      <div data-mockup-viewport data-ui-theme={theme} className="relative flex shrink-0 flex-col overflow-hidden bg-surface" style={{ ...viewportDimensions, ...themeVariables(theme) }}>
      {shell === null || shell === undefined ? body : (
        <AppShellFrame shell={shell} width={viewportDimensions.width} interactive={mode === 'experience'} onNavigate={onNavigate}>{body}</AppShellFrame>
      )}
      {mode === 'experience' ? <OutcomePreview outcome={activeOutcome} onDismiss={onOutcomeDismiss} /> : null}
      </div>
    </figure>
  )
}
