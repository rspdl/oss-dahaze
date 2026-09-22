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
  DesignBinding,
  DesignChange,
  ElementDesign,
  MockupDimensions,
  ModelSampleSet,
  PrototypeAction,
  PrototypeMode,
  SampleVariant,
  SemanticProposal,
} from './prototype-contract'
import { designBindingKey } from './prototype-contract'

/**
 * 선언된 레이아웃을 화면처럼 그린다.
 *
 * **여기에 LLM 이 없다.** 구조는 문서가 선언한 것이고 렌더링은 결정적이다. 같은 IR 은 언제나
 * 같은 그림을 낸다.
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

const VIEWPORT_WIDTH: Record<MockupViewport, number> = {
  desktop: 1024,
  mobile: 390,
}

export const DEFAULT_VIEWPORT_DIMENSIONS: Record<MockupViewport, MockupDimensions> = {
  desktop: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 },
}

export interface ScreenMockupFrameProps {
  screen: ScreenMockup
  viewport?: MockupViewport
  dimensions?: MockupDimensions
  mode?: PrototypeMode
  sampleVariant?: SampleVariant
  samples?: ModelSampleSet[]
  outcomesByElementId?: Readonly<Record<string, ActionOutcome[]>>
  selectedElementPath?: string | null
  selectedElementScreenKey?: string | null
  designByElementPath?: Readonly<Record<string, ElementDesign>>
  sourceHash?: string
  onElementSelect?: (binding: DesignBinding) => void
  onDesignChange?: (change: DesignChange) => void
  onAction?: (action: PrototypeAction) => void
  selectedSampleIdByModel?: Readonly<Record<string, string>>
  onSampleSelect?: (modelId: string, recordId: string) => void
  values?: Readonly<Record<string, string | boolean>>
  onValueChange?: (fieldId: string, value: string | boolean) => void
  onProposeSemanticEdit?: (proposal: SemanticProposal) => void
  className?: string
}

interface ElementContext extends Omit<ScreenMockupFrameProps, 'screen' | 'viewport' | 'dimensions' | 'className'> {
  screenKey: string
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

function FieldLabel({ field }: { field: MockupField }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={cn(
          'text-xs font-medium',
          field.resolved ? 'text-text-muted' : 'text-diagnostic-error',
        )}
      >
        {field.name}
      </span>
      {field.required ? (
        <span className="text-[10px] text-text-subtle">필수</span>
      ) : null}
      {field.resolved ? null : (
        <span className="text-[10px] text-diagnostic-error">선언을 찾지 못함</span>
      )}
    </span>
  )
}

/**
 * 입력칸.
 *
 * `select` 는 선언된 값들을 그대로 보여준다. 그것은 지어낸 내용이 아니라 문서가 말한 사실이라
 * 화면에 드러나는 편이 낫다.
 */
function Control({ field, experience, value, onChange }: { field: MockupField; experience: boolean; value?: string | boolean; onChange?: (value: string | boolean) => void }) {
  if (experience) {
    if (field.control === 'checkbox') return <input aria-label={field.name} type="checkbox" checked={value === true} onChange={(event) => onChange?.(event.target.checked)} />
    if (field.control === 'select') {
      return <select aria-label={field.name} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange?.(event.target.value)} className="h-8 rounded-md border bg-surface px-2 text-xs"><option value="">선택</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select>
    }
    const type = field.control === 'datetime' ? 'datetime-local' : field.control
    return <input aria-label={field.name} type={type} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange?.(event.target.value)} className="h-8 rounded-md border bg-surface px-2 text-xs" />
  }
  if (field.control === 'checkbox') {
    return (
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-4 shrink-0 rounded border border-border-strong bg-surface"
        />
        <span className="text-[11px] text-text-subtle">{CONTROL_LABEL.checkbox}</span>
      </span>
    )
  }

  if (field.control === 'select') {
    return (
      <span className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 py-1.5">
        {field.options === null || field.options.length === 0 ? (
          <span className="text-[11px] text-text-subtle">{CONTROL_LABEL.select}</span>
        ) : (
          field.options.map((option) => (
            <span
              key={option}
              className="rounded-sm bg-surface-raised px-1.5 py-0.5 text-[11px] text-text-muted"
            >
              {option}
            </span>
          ))
        )}
      </span>
    )
  }

  return (
    <span className="flex h-8 items-center rounded-md border border-border-strong bg-surface px-2.5">
      <span className="text-[11px] text-text-subtle">{CONTROL_LABEL[field.control]}</span>
    </span>
  )
}

function Input({ field, experience, value, onChange }: { field: MockupField; experience: boolean; value?: string | boolean; onChange?: (value: string | boolean) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel field={field} />
      <Control field={field} experience={experience} value={value} onChange={onChange} />
    </div>
  )
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
    <div className="overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-surface-raised px-3 py-1.5">
        <span className="text-[11px] text-text-subtle">{modelName} 목록{isExample ? ' · 예시 데이터' : ''}</span>
      </div>
      {records !== null && records.length === 0 ? (
        <div className="px-3 py-5 text-center text-[11px] text-text-subtle">{modelName} 샘플이 비어 있습니다</div>
      ) : fields.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-text-subtle">보여줄 필드가 없다</div>
      ) : (
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b border-border">
              {fields.map((field) => (
                <th key={field.id} className="px-3 py-1.5 text-left">
                  <FieldLabel field={field} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(records ?? []).map((record) => (
              <tr key={record.id} aria-selected={record.id === selectedId} className={cn('border-b border-border last:border-b-0', record.id === selectedId && 'bg-accent-subtle')} onClick={() => onSelect?.(modelId, record.id)}>
                {fields.map((field) => (
                  <td key={field.id} className="px-3 py-2">
                    <span className="block truncate text-[11px] text-text-muted">{String(record.values[field.id] ?? '')}</span>
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
    <div className="flex min-h-20 items-center justify-center rounded-md border border-dashed border-border-strong bg-surface-raised">
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

function Element({ element, path, context }: { element: MockupElement; path: string; context: ElementContext }) {
  const stableId = element.id ?? undefined
  const binding: DesignBinding = { screenKey: context.screenKey, elementId: stableId, elementPath: path, sourceHash: context.sourceHash }
  const design = context.designByElementPath?.[designBindingKey(binding)]
  const selected = context.selectedElementPath === path && context.selectedElementScreenKey === context.screenKey
  const child = (() => {
  switch (element.kind) {
    case 'header':
      return (
        <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-raised px-4 py-3">
          {element.children.map((child, index) => (
            <Element key={index} element={child} path={`${path}.children.${index}`} context={context} />
          ))}
        </header>
      )
    case 'section':
      return (
        <section className="flex flex-col gap-3 px-4 py-3">
          {element.children.map((child, index) => (
            <Element key={index} element={child} path={`${path}.children.${index}`} context={context} />
          ))}
        </section>
      )
    case 'heading':
      return (
        <h3 className="text-sm font-semibold tracking-tight text-text">{element.text}</h3>
      )
    case 'form':
      return (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
          {element.inputs.map((input, index) => (
            <Element key={index} element={input} path={`${path}.inputs.${index}`} context={context} />
          ))}
        </div>
      )
    case 'input':
      return <Input field={element.field} experience={context.mode === 'experience'} value={context.values?.[element.field.id]} onChange={(value) => context.onValueChange?.(element.field.id, value)} />
    case 'list': {
      const supplied = context.samples?.find((set) => set.modelId === element.modelId)
      const variant = context.sampleVariant ?? 'normal'
      const count = variant === 'empty' ? 0 : variant === 'many' ? 12 : 3
      const fallback = Array.from({ length: count }, (_, index) => ({ id: `${element.modelId}:example:${index + 1}`, values: Object.fromEntries(element.fields.map((field) => [field.id, variant === 'long' ? `예시 ${field.name} 값이 길게 표시되는 경우 ${index + 1}` : `예시 ${index + 1}`])) }))
      return <ListElement modelId={element.modelId} modelName={element.modelName} fields={element.fields} records={supplied?.variants[variant] ?? fallback} isExample={supplied === undefined} selectedId={context.selectedSampleIdByModel?.[element.modelId]} onSelect={context.onSampleSelect} />
    }
    case 'button': {
      if (context.mode !== 'experience') return <span className="inline-flex h-8 items-center rounded-md border border-border-strong bg-surface-raised px-3 text-xs font-medium text-text">{element.name}</span>
      if (element.id === null) return <button type="button" disabled title="안정적 요소 ID가 없어 체험할 수 없습니다" className="inline-flex h-8 items-center rounded-md border border-border-strong bg-surface-raised px-3 text-xs font-medium text-text opacity-50">{element.name} · ID 없음</button>
      const elementId = element.id
      const outcomes = context.outcomesByElementId?.[elementId] ?? []
      if (outcomes.length > 1) return <label className="inline-flex items-center gap-2 text-xs"><span>{element.name}</span><select aria-label={`${element.name} 결과`} defaultValue="" onChange={(event) => { const outcome = outcomes.find((item) => item.id === event.target.value); if (outcome) context.onAction?.({ screenKey: context.screenKey, elementId, outcome }) }}><option value="" disabled>결과 선택</option>{outcomes.map((outcome) => <option key={outcome.id} value={outcome.id}>{outcome.label}</option>)}</select></label>
      if (outcomes.length === 0) return <button type="button" disabled title="선언된 결과가 없어 체험할 수 없습니다" className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-on-solid opacity-50">{element.name} · 결과 없음</button>
      return <button type="button" className="inline-flex h-8 items-center rounded-md border border-border-strong bg-surface-raised px-3 text-xs font-medium text-text" onClick={(event) => { event.stopPropagation(); const outcome = outcomes[0]; if (outcome) context.onAction?.({ screenKey: context.screenKey, elementId, outcome }) }}>{element.name}</button>
    }
    case 'placeholder':
      return <Placeholder text={element.text} />
    case 'unrecognized':
      return <Unrecognized rawKind={element.rawKind} reason={element.reason} />
  }
  })()
  return <div data-element-path={path} className={cn('relative', selected && 'ring-2 ring-accent')} style={{ width: design?.width, minHeight: design?.height }} onClick={(event) => { if (context.mode !== 'edit') return; event.stopPropagation(); context.onElementSelect?.(binding) }}>{child}{selected && context.mode === 'edit' ? <div className="nodrag absolute top-1 right-1 flex gap-1 rounded bg-surface p-1 shadow"><label className="text-[10px]">W <input aria-label="요소 너비" type="number" className="w-14 border" value={design?.width ?? ''} onChange={(event) => context.onDesignChange?.({ binding, patch: { width: Number(event.target.value) || undefined } })} /></label><label className="text-[10px]">H <input aria-label="요소 높이" type="number" className="w-14 border" value={design?.height ?? ''} onChange={(event) => context.onDesignChange?.({ binding, patch: { height: Number(event.target.value) || undefined } })} /></label><button type="button" className="text-[10px] text-diagnostic-error" onClick={() => context.onProposeSemanticEdit?.({ kind: 'delete-element', binding })}>삭제 제안</button></div> : null}</div>
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
  className,
  dimensions,
  mode = 'edit', sampleVariant = 'normal', samples, outcomesByElementId,
  selectedElementPath, selectedElementScreenKey, designByElementPath, sourceHash, onElementSelect, onDesignChange,
  onAction, onProposeSemanticEdit,
  selectedSampleIdByModel, onSampleSelect,
  values, onValueChange,
}: ScreenMockupFrameProps) {
  const context: ElementContext = { screenKey: screen.key, mode, sampleVariant, samples, outcomesByElementId, selectedElementPath, selectedElementScreenKey, designByElementPath, sourceHash, onElementSelect, onDesignChange, onAction, onProposeSemanticEdit, selectedSampleIdByModel, onSampleSelect, values, onValueChange }
  return (
    <figure
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border border-border bg-canvas',
        className,
      )}
      style={{ width: dimensions?.width ?? VIEWPORT_WIDTH[viewport], height: dimensions?.height }}
    >
      <figcaption className="flex items-baseline gap-2 border-b border-border bg-surface px-4 py-2">
        <span className="text-xs font-semibold text-text">
          {screen.screenName ?? screen.screenId}
        </span>
        {screen.kind === null ? null : (
          <span className="text-[10px] text-text-subtle">{screen.kind}</span>
        )}
      </figcaption>

      {screen.elements.length === 0 ? (
        <div className="px-4 py-6 text-[11px] text-text-subtle">
          레이아웃에 요소가 없다
        </div>
      ) : (
        <div className="flex min-h-0 flex-col overflow-y-auto">
          {screen.elements.map((element, index) => (
            <Element key={index} element={element} path={`elements.${index}`} context={context} />
          ))}
        </div>
      )}
    </figure>
  )
}
