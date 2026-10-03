'use client'

import * as React from 'react'
import type { MockupElement, ScreenMockup } from './screen-layouts'
import { designBindingKey, type DesignChange, type ElementDesign, type ElementSelection } from './prototype-contract'

const KIND_LABEL: Record<MockupElement['kind'], string> = {
  header: '헤더', section: '영역', heading: '제목', form: '입력 그룹', input: '입력', list: '목록', button: '버튼', placeholder: '자리표시자', unrecognized: '미지원 요소',
}

/** Keep compiler paths even when presentation changes; selection always leads back to the same spec. */
export function wireframeLayers(screen: ScreenMockup, sourceHash?: string): { selection: ElementSelection; label: string; depth: number }[] {
  const walk = (elements: MockupElement[], prefix: string, depth: number): ReturnType<typeof wireframeLayers> => elements.flatMap((element, index) => {
    const path = `${prefix}.${index}`
    const name = element.kind === 'input' ? element.field.name : element.kind === 'list' ? element.modelName : element.kind === 'button' ? element.name : element.kind === 'heading' || element.kind === 'placeholder' ? element.text : KIND_LABEL[element.kind]
    const selection: ElementSelection = {
      screenKey: screen.key, elementId: element.id ?? undefined, elementPath: path, sourceHash, elementKind: element.kind, name,
      ...(element.kind === 'button' ? { actionId: element.actionId } : {}),
      ...(element.kind === 'input' ? { fieldId: element.field.id } : {}),
      ...(element.kind === 'list' ? { modelId: element.modelId, fieldIds: element.fields.map((field) => field.id) } : {}),
      ...(element.kind === 'heading' || element.kind === 'placeholder' ? { text: element.text } : {}),
    }
    const children = element.kind === 'header' || element.kind === 'section' ? walk(element.children, `${path}.children`, depth + 1) : element.kind === 'form' ? walk(element.inputs, `${path}.inputs`, depth + 1) : []
    return [{ selection, label: `${KIND_LABEL[element.kind]} · ${name}`, depth }, ...children]
  })
  return walk(screen.elements, 'elements', 0)
}

export function WireframeInspector({ screen, sourceHash, selected, designs, onSelect, onChange }: {
  screen: ScreenMockup
  sourceHash?: string
  selected: ElementSelection | null
  designs: Readonly<Record<string, ElementDesign>>
  onSelect: (selection: ElementSelection) => void
  onChange: (change: DesignChange) => void
}) {
  const layers = wireframeLayers(screen, sourceHash)
  const active = selected?.screenKey !== screen.key ? undefined : layers.find(({ selection }) => selection.elementPath === selected.elementPath && selection.elementId === selected.elementId)
  const binding = active?.selection
  const design = binding === undefined ? {} : designs[designBindingKey(binding)] ?? {}
  const container = binding !== undefined && ['header', 'section', 'form'].includes(binding.elementKind)
  const change = (patch: ElementDesign) => { if (binding !== undefined) onChange({ binding, patch }) }
  return <section aria-label="와이어프레임 배치" className="border-b p-4">
    <h3 className="text-sm font-semibold">와이어프레임 배치</h3>
    <p className="mt-1 text-xs text-text-muted">기획 요소를 선택해 배치하고 아래에서 연결된 명세를 확인하세요. 배치는 기획 원문과 별도로 저장됩니다.</p>
    <div aria-label="기획 요소 목록" className="mt-3 max-h-48 space-y-1 overflow-auto">
      {layers.map(({ selection, label, depth }) => <button key={selection.elementPath} type="button" aria-pressed={binding?.elementPath === selection.elementPath} className="block w-full rounded border border-transparent px-2 py-1 text-left text-xs hover:bg-surface aria-pressed:border-accent aria-pressed:bg-accent-subtle" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => onSelect(selection)}>{label}</button>)}
      {layers.length === 0 ? <p className="text-xs text-text-subtle">선언된 기획 요소가 없습니다.</p> : null}
    </div>
    {binding === undefined ? <p className="mt-3 text-xs text-text-subtle">캔버스 또는 목록에서 요소를 선택하세요.</p> : <div className="mt-3 space-y-3">
      <p className="text-xs font-medium">{active?.label}</p>
      <p className="break-all text-[11px] text-text-muted">연결 문서 · {screen.path}</p>
      <div className="grid grid-cols-2 gap-2">
        {(['x', 'y', 'width', 'height'] as const).map((field) => <label key={field} className="text-xs">{{ x: 'X', y: 'Y', width: '너비', height: '높이' }[field]}<input aria-label={`배치 ${{ x: 'X', y: 'Y', width: '너비', height: '높이' }[field]}`} type="number" min={field === 'width' || field === 'height' ? 16 : 0} placeholder="자동" value={design[field] ?? ''} className="mt-1 w-full rounded border bg-surface px-2 py-1" onChange={(event) => {
          if (event.target.value === '') { change({ [field]: undefined }); return }
          const value = event.target.valueAsNumber
          if (Number.isFinite(value)) change({ [field]: Math.max(field === 'width' || field === 'height' ? 16 : 0, value) })
        }} /></label>)}
      </div>
      {container ? <div className="flex items-center gap-2 text-xs">
        <label className="flex-1">내부 배치<select aria-label="내부 배치" value={design.layout ?? ''} className="mt-1 w-full rounded border bg-surface px-2 py-1" onChange={(event) => change({ layout: event.target.value === '' ? undefined : event.target.value as ElementDesign['layout'] })}><option value="">기본</option><option value="column">세로</option><option value="row">가로</option><option value="grid">2열 그리드</option></select></label>
        <label className="w-20">간격<input aria-label="요소 간격" type="number" min={0} value={design.gap ?? ''} placeholder="자동" className="mt-1 w-full rounded border bg-surface px-2 py-1" onChange={(event) => { const value = event.target.valueAsNumber; if (event.target.value === '') change({ gap: undefined }); else if (Number.isFinite(value)) change({ gap: Math.max(0, value) }) }} /></label>
      </div> : null}
      <p className="text-[11px] text-text-subtle">이동 손잡이를 끌어 자유 배치합니다. X·Y는 부모 영역 기준입니다. 8px 맞춤 · Alt: 1px · 방향키: 이동 · Shift: 8px</p>
      <div className="flex flex-wrap gap-2"><button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => change({ x: undefined, y: undefined })}>자동 흐름으로 복귀</button><button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => change({ x: undefined, y: undefined, width: undefined, height: undefined, layout: undefined, gap: undefined })}>요소 배치 초기화</button></div>
    </div>}
  </section>
}
