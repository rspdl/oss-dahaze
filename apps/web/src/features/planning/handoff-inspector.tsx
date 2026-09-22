'use client'

import { useMemo, useState } from 'react'
import { Button } from '@dahaze/ui'
import type { ProjectCompileResponse, ProjectSnapshotResponse } from '@dahaze/api-client'

import { parseModelSamples } from '@/features/mockup/sample-data'
import type { SampleVariant } from '@/features/mockup/prototype-contract'
import { collectScreenMockups } from '@/features/mockup/screen-layouts'
import { ScreenMockupFrame } from '@/features/mockup/screen-mockup'
import {
  buildReadableSpecification,
  findReadableScreen,
  type ReadableCategory,
  type ReadableElement,
  type ReadableSpecification,
} from '@/features/specification/readable-specification'
import { ReadableSpecificationPanel } from '@/features/specification/readable-specification-panel'
import { parsePlanningEnvironments, visibleScreenKeys } from './environments'

const SAMPLE_VARIANTS: { id: SampleVariant; label: string }[] = [
  { id: 'normal', label: '정상' },
  { id: 'empty', label: '빈 상태' },
  { id: 'long', label: '긴 문구' },
  { id: 'many', label: '많은 데이터' },
]

export function HandoffInspector({ snapshot, compare }: { snapshot: ProjectSnapshotResponse; compare?: ProjectSnapshotResponse }) {
  const compiled = useMemo(() => ({ documents: [], locale: snapshot.locale, rspdl_version: snapshot.rspdl_version, wire_schema_version: snapshot.wire_schema_version, result: snapshot.result } as ProjectCompileResponse), [snapshot])
  const planning = record(snapshot.planning_state)
  const metadata = record(planning?.metadata)
  const environments = useMemo(() => parsePlanningEnvironments(metadata?.environments), [metadata?.environments])
  const samples = useMemo(() => parseModelSamples(metadata?.sample_data), [metadata?.sample_data])
  const mockups = useMemo(() => collectScreenMockups(compiled), [compiled])
  const specification = useMemo(() => buildReadableSpecification(compiled, {
    documents: snapshot.documents,
    identity: {
      snapshotVersion: snapshot.snapshot_version,
      projectRevision: snapshot.project_revision,
      sourceHash: snapshot.source_hash,
      rspdlVersion: snapshot.rspdl_version,
      wireSchemaVersion: snapshot.wire_schema_version,
    },
    planningState: snapshot.planning_state,
  }), [compiled, snapshot])
  const [requestedEnvironmentId, setRequestedEnvironmentId] = useState(environments[0]?.id ?? 'all')
  const environmentId = requestedEnvironmentId === 'all' || environments.some((entry) => entry.id === requestedEnvironmentId) ? requestedEnvironmentId : (environments[0]?.id ?? 'all')
  const selectedEnvironment = environments.find((entry) => entry.id === environmentId)
  const visible = visibleScreenKeys(selectedEnvironment)
  const visibleMockups = mockups.screens.filter((screen) => visible === undefined || visible.has(screen.key) || visible.has(screen.screenId))
  const [requestedScreenKey, setRequestedScreenKey] = useState(mockups.screens[0]?.key ?? '')
  const selectedScreen = visibleMockups.find((screen) => screen.key === requestedScreenKey) ?? visibleMockups[0]
  const [elementPath, setElementPath] = useState('')
  const [sampleVariant, setSampleVariant] = useState<SampleVariant>('normal')
  const readableScreen = findReadableScreen(specification, selectedScreen?.key)
  const selectableElements = readableScreen === null ? [] : flattenElements(readableScreen.elements).filter((element) => element.kind === 'button' || element.kind === 'input' || element.kind === 'list')
  const effectiveElementPath = selectableElements.some((element) => element.path === elementPath) ? elementPath : ''
  const dimensions = selectedEnvironment === undefined ? { width: 1024, height: 768 } : { width: selectedEnvironment.width, height: selectedEnvironment.height }
  const designScope = environmentId === 'all' ? 'all' : environmentId
  const design = designForScope(metadata?.design, designScope)
  const comparison = useMemo(() => compare === undefined ? null : compareSnapshots(compare, snapshot), [compare, snapshot])

  const selectEnvironment = (id: string) => {
    setRequestedEnvironmentId(id)
    const environment = environments.find((entry) => entry.id === id)
    const allowed = visibleScreenKeys(environment)
    const first = mockups.screens.find((screen) => allowed === undefined || allowed.has(screen.key) || allowed.has(screen.screenId))
    if (first !== undefined) setRequestedScreenKey(first.key)
    setElementPath('')
  }
  const selectScreen = (key: string) => { setRequestedScreenKey(key); setElementPath('') }
  const download = () => {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `dahaze-project-v${snapshot.snapshot_version}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return <section className="border-t p-4" aria-label="개발 전달본">
    <div className="flex items-start justify-between gap-3">
      <div><h3 className="text-sm font-semibold">개발 전달본</h3><p className="mt-1 text-xs text-text-muted">스냅샷 {snapshot.snapshot_version} · 프로젝트 버전 {snapshot.project_revision} · <span className="font-mono">{snapshot.source_hash.slice(0, 12)}</span></p><p className="text-xs text-text-subtle">rspdl {snapshot.rspdl_version} · wire {snapshot.wire_schema_version}</p></div>
      <Button size="sm" variant="outline" onClick={download}>JSON+원문 다운로드</Button>
    </div>

    {comparison === null ? null : <SnapshotComparison comparison={comparison} />}
    <InformationArchitecture specification={specification} />

    <section className="mt-5">
      <h4 className="text-xs font-semibold">읽기 전용 와이어프레임</h4>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <label>환경 <select aria-label="전달본 환경" value={environmentId} onChange={(event) => selectEnvironment(event.target.value)} className="rounded border bg-surface px-2 py-1"><option value="all">전체</option>{environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}</select></label>
        <label>화면 <select aria-label="전달본 화면" value={selectedScreen?.key ?? ''} onChange={(event) => selectScreen(event.target.value)} className="max-w-56 rounded border bg-surface px-2 py-1">{visibleMockups.map((screen) => <option key={screen.key} value={screen.key}>{screen.screenName ?? screen.screenId}</option>)}</select></label>
        <label>상황 <select aria-label="전달본 샘플 상황" value={sampleVariant} onChange={(event) => setSampleVariant(event.target.value as SampleVariant)} className="rounded border bg-surface px-2 py-1">{SAMPLE_VARIANTS.map((variant) => <option key={variant.id} value={variant.id}>{variant.label}</option>)}</select></label>
        <span className="text-text-subtle">{selectedEnvironment?.name ?? '전체'} · {dimensions.width}×{dimensions.height}</span>
      </div>
      {selectedScreen === undefined ? <p className="mt-2 text-xs text-diagnostic-warning">이 환경에서 표시할 수 있는 화면이 없습니다.</p> : <>
        <div className="mt-2 max-h-[34rem] overflow-auto rounded-control border bg-canvas p-2" aria-label="읽기 전용 화면"><ScreenMockupFrame screen={selectedScreen} dimensions={dimensions} mode="edit" sampleVariant={sampleVariant} samples={samples} designByElementPath={design} sourceHash={snapshot.source_hash} /></div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><label>기능명세 범위 <select aria-label="전달본 기능명세 요소" value={effectiveElementPath} onChange={(event) => setElementPath(event.target.value)} className="max-w-64 rounded border bg-surface px-2 py-1"><option value="">화면 전체</option>{selectableElements.map((element) => <option key={element.key} value={element.path}>{elementOptionLabel(element)}</option>)}</select></label><span className="text-text-subtle">배치 {Object.keys(design).length}건 · 샘플 모델 {samples.length}개</span></div>
      </>}
    </section>

    <ReadableSpecificationPanel specification={specification} screenKey={selectedScreen?.key} elementPath={effectiveElementPath || undefined} className="mt-5" />
  </section>
}

function InformationArchitecture({ specification }: { specification: ReadableSpecification }) {
  const ordered = orderCategories(specification.categories)
  const screenById = new Map(specification.screens.map((screen) => [screen.id, screen]))
  const assigned = new Set(specification.categories.flatMap((category) => category.screenIds))
  const unassigned = specification.screens.filter((screen) => !assigned.has(screen.id))
  return <section className="mt-5"><h4 className="text-xs font-semibold">정보구조</h4>{ordered.length === 0 && unassigned.length === 0 ? <p className="mt-2 text-xs text-text-subtle">선언된 정보구조가 없습니다.</p> : <div className="mt-2 space-y-1">{ordered.map(({ category, depth }) => <div key={category.key}><p className="text-xs font-medium text-text" style={{ paddingLeft: `${depth * 14}px` }}>{category.name}</p>{category.screenIds.map((screenId) => <p key={screenId} className="text-xs text-text-muted" style={{ paddingLeft: `${(depth + 1) * 14}px` }}>화면 · {screenById.get(screenId)?.name ?? screenId}</p>)}</div>)}{unassigned.map((screen) => <p key={screen.key} className="text-xs text-text-muted">화면 · {screen.name} <span className="text-text-subtle">(분류 미지정)</span></p>)}</div>}</section>
}

interface SnapshotComparisonResult {
  documents: { path: string; before: unknown; after: unknown }[]
  planning: { key: string; before: unknown; after: unknown }[]
  compiler: { before: unknown; after: unknown } | null
  beforeVersion: number
  afterVersion: number
}

function SnapshotComparison({ comparison }: { comparison: SnapshotComparisonResult }) {
  return <details className="mt-4 rounded-control border px-3 py-2" open><summary className="cursor-pointer text-xs font-semibold">스냅샷 {comparison.beforeVersion} → {comparison.afterVersion} 실제 변경</summary><p className="mt-1 text-[11px] text-text-subtle">문서의 원문·제목·대상 RSPDL 버전과 기획 상태, 저장된 컴파일 결과를 비교합니다.</p><div className="mt-3 space-y-4">{comparison.documents.length === 0 ? <p className="text-xs text-text-subtle">문서 변경 없음</p> : comparison.documents.map((document) => <article key={document.path}><p className="font-mono text-xs font-medium">{document.path}</p><div className="mt-1 grid gap-2 lg:grid-cols-2"><CompareValue label="이전 문서" value={document.before} empty="문서 없음" /><CompareValue label="현재 문서" value={document.after} empty="문서 없음" /></div></article>)}{comparison.planning.length === 0 ? <p className="text-xs text-text-subtle">기획 상태 변경 없음</p> : comparison.planning.map((entry) => <article key={entry.key}><p className="text-xs font-medium">기획 상태 · {entry.key}</p><div className="mt-1 grid gap-2 lg:grid-cols-2"><CompareValue label="이전 값" value={entry.before} empty="값 없음" /><CompareValue label="현재 값" value={entry.after} empty="값 없음" /></div></article>)}{comparison.compiler === null ? <p className="text-xs text-text-subtle">저장된 컴파일 결과 변경 없음</p> : <article><p className="text-xs font-medium">저장된 컴파일 결과</p><div className="mt-1 grid gap-2 lg:grid-cols-2"><CompareValue label="이전 결과" value={comparison.compiler.before} empty="저장된 결과 없음" /><CompareValue label="현재 결과" value={comparison.compiler.after} empty="저장된 결과 없음" /></div></article>}</div></details>
}

function CompareValue({ label, value, empty }: { label: string; value: unknown; empty: string }) {
  return <div><p className="text-[10px] text-text-subtle">{label}</p><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-control border bg-surface px-2 py-1.5 text-[11px] text-text-muted">{value === null || value === undefined ? empty : typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre></div>
}

function compareSnapshots(before: ProjectSnapshotResponse, after: ProjectSnapshotResponse): SnapshotComparisonResult {
  const documentMap = (snapshot: ProjectSnapshotResponse) => new Map(snapshot.documents.flatMap((value) => { const raw = record(value); const path = string(raw?.path); return path === null ? [] : [[path, raw === null ? null : structuredClone(raw)] as const] }))
  const beforeDocuments = documentMap(before)
  const afterDocuments = documentMap(after)
  const paths = new Set([...beforeDocuments.keys(), ...afterDocuments.keys()])
  const documents = [...paths].filter((path) => JSON.stringify(beforeDocuments.get(path)) !== JSON.stringify(afterDocuments.get(path))).map((path) => ({ path, before: beforeDocuments.get(path) ?? null, after: afterDocuments.get(path) ?? null }))
  const beforePlanning = record(before.planning_state) ?? {}
  const afterPlanning = record(after.planning_state) ?? {}
  const keys = new Set([...Object.keys(beforePlanning), ...Object.keys(afterPlanning)])
  const planning = [...keys].filter((key) => JSON.stringify(beforePlanning[key]) !== JSON.stringify(afterPlanning[key])).map((key) => ({ key, before: beforePlanning[key], after: afterPlanning[key] }))
  const compiler = JSON.stringify(before.result) === JSON.stringify(after.result) ? null : { before: before.result, after: after.result }
  return { documents, planning, compiler, beforeVersion: before.snapshot_version, afterVersion: after.snapshot_version }
}

function designForScope(value: unknown, scope: string): Record<string, { width?: number; height?: number }> {
  const design = record(value)
  const environments = record(design?.environments)
  const selected = record(environments?.[scope])
  const elements = record(selected?.elements)
  if (elements === null) return {}
  return Object.fromEntries(Object.entries(elements).flatMap(([key, raw]) => { const item = record(raw); if (item === null) return []; const width = number(item.width); const height = number(item.height); return [[key, { ...(width === null ? {} : { width }), ...(height === null ? {} : { height }) }]] }))
}

function orderCategories(categories: ReadableCategory[]): { category: ReadableCategory; depth: number }[] {
  const byPathAndId = new Map(categories.map((category) => [`${category.source.path}:${category.id}`, category]))
  const children = new Map<string, ReadableCategory[]>()
  const roots: ReadableCategory[] = []
  for (const category of categories) {
    const parent = category.parentId === null ? undefined : byPathAndId.get(`${category.source.path}:${category.parentId}`)
    if (parent === undefined) roots.push(category)
    else children.set(parent.key, [...(children.get(parent.key) ?? []), category])
  }
  const result: { category: ReadableCategory; depth: number }[] = []
  const visit = (category: ReadableCategory, depth: number) => { result.push({ category, depth }); for (const child of children.get(category.key) ?? []) visit(child, depth + 1) }
  for (const root of roots) visit(root, 0)
  return result
}

function flattenElements(elements: ReadableElement[]): ReadableElement[] { return elements.flatMap((element) => [element, ...flattenElements(element.children)]) }
function elementOptionLabel(element: ReadableElement): string { const kind = element.kind === 'button' ? '버튼' : element.kind === 'input' ? '입력' : '목록'; return `${kind} · ${element.name ?? element.text ?? element.fields[0]?.name ?? element.model?.name ?? element.id ?? element.path}` }
function record(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null }
function string(value: unknown): string | null { return typeof value === 'string' ? value : null }
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
