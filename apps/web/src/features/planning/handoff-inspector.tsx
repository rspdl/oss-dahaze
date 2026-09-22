'use client'

import { useMemo, useState } from 'react'
import { Button } from '@dahaze/ui'
import type { ProjectCompileResponse, ProjectSnapshotResponse } from '@dahaze/api-client'
import { collectPolicies } from '@/shared/rspdl/policies'
import { collectBoard } from '@/features/boards/board-ir'
import { buildIaTree } from '@/features/boards/ia-tree'
import { collectScreenMockups } from '@/features/mockup/screen-layouts'
import { ScreenMockupFrame } from '@/features/mockup/screen-mockup'

export function HandoffInspector({ snapshot, compare }: { snapshot: ProjectSnapshotResponse; compare?: ProjectSnapshotResponse }) {
  const files = records(record(snapshot.result)?.files)
  const compiled = { documents: [], locale: snapshot.locale, rspdl_version: snapshot.rspdl_version, wire_schema_version: snapshot.wire_schema_version, result: snapshot.result } as ProjectCompileResponse
  const policyRows = collectPolicies(compiled).rows
  const board = collectBoard(compiled)
  const iaTree = buildIaTree(board)
  const mockups = collectScreenMockups(compiled)
  const [screenKey, setScreenKey] = useState(mockups.screens[0]?.key ?? '')
  const selectedScreen = mockups.screens.find((screen) => screen.key === screenKey) ?? mockups.screens[0]
  const metadata = record(record(snapshot.planning_state)?.metadata)
  const environments = records(metadata?.environments)
  const selectedEnvironment = environments.find((entry) => string(entry.id) === 'desktop') ?? environments[0]
  const dimensions = { width: number(selectedEnvironment?.width) ?? 390, height: number(selectedEnvironment?.height) ?? 640 }
  const planning = record(snapshot.planning_state)
  const contextItems = useMemo(() => [...records(planning?.decisions).filter((item) => item.status === 'deferred').map((item) => ({ label: '보류 결정', text: string(item.title) ?? '제목 없음' })), ...records(planning?.proposals).filter((item) => item.kind === 'question' || item.kind === 'unsupported').map((item) => ({ label: item.kind === 'question' ? '확인 질문' : '지원하지 않는 범위', text: string(item.title) ?? string(item.content) ?? '내용 없음' }))], [planning])
  const comparison = compare === undefined ? null : compareSummary(snapshot, compare)
  const download = () => {
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `dahaze-project-v${snapshot.snapshot_version}.json`; anchor.click(); URL.revokeObjectURL(url)
  }
  return <section className="border-t p-4" aria-label="개발 전달본">
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">개발 전달본</h3><p className="mt-1 text-xs text-text-muted">스냅샷 {snapshot.snapshot_version} · 프로젝트 버전 {snapshot.project_revision} · <span className="font-mono">{snapshot.source_hash.slice(0, 12)}</span></p><p className="text-xs text-text-subtle">rspdl {snapshot.rspdl_version} · wire {snapshot.wire_schema_version}</p></div><Button size="sm" variant="outline" onClick={download}>JSON+원문 다운로드</Button></div>
    {comparison ? <div className="mt-3 rounded-control border px-3 py-2 text-xs text-text-muted"><p>원문: {comparison.documents}</p><p>프로젝트 메타데이터: {comparison.metadata}</p></div> : null}
    {contextItems.length > 0 ? <section className="mt-4"><h4 className="text-xs font-semibold">남은 맥락</h4>{contextItems.map((item, index) => <p key={index} className="mt-1 text-xs text-text-muted"><span className="font-medium">{item.label}</span> · {item.text}</p>)}</section> : null}
    {files.length === 0 ? <p className="mt-4 text-sm text-diagnostic-warning">이 스냅샷의 컴파일 결과 모양을 지원하지 않아 명세를 표시할 수 없습니다.</p> : <div className="mt-4 space-y-5"><section><h4 className="text-xs font-semibold">정책 명세</h4>{policyRows.length === 0 ? <p className="mt-2 text-xs text-text-subtle">정책 없음 또는 지원하지 않는 정책 모양</p> : policyRows.map((row) => <div key={`${row.path}:${row.id}`} className="mt-2 border-l-2 pl-3 text-xs text-text-muted"><p>{row.role.name} · {row.action.name} · {row.model.name}.{row.field.name} · {row.effect === 'allow' ? '허용' : '금지'}</p>{policyRows.length > 0 ? policyRowsForField(compiled, row.field.id).map((condition, index) => <p key={index} className="text-text-subtle">조건 {condition}</p>) : null}</div>)}</section><section><h4 className="text-xs font-semibold">정보구조</h4>{iaTree.nodes.map((node) => <p key={node.id} className="mt-1 text-xs text-text-muted" style={{ paddingLeft: `${node.depth * 12}px` }}>{node.kind === 'screen' ? '화면 · ' : ''}{node.name}</p>)}</section>{selectedScreen ? <details open><summary className="cursor-pointer text-xs font-semibold">읽기 전용 와이어프레임 {mockups.screens.length}개</summary><div className="mt-2 flex flex-wrap items-center gap-2"><select aria-label="전달본 화면" value={selectedScreen.key} onChange={(event) => setScreenKey(event.target.value)} className="rounded border bg-surface px-2 py-1 text-xs">{mockups.screens.map((screen) => <option key={screen.key} value={screen.key}>{screen.screenName ?? screen.screenId}</option>)}</select><span className="text-xs text-text-subtle">{string(selectedEnvironment?.name) ?? '기본 환경'} · {dimensions.width}×{dimensions.height}</span></div><div className="mt-2 max-h-96 overflow-auto"><ScreenMockupFrame screen={selectedScreen} dimensions={dimensions} /></div><MetadataFacts metadata={metadata} screenKey={selectedScreen.key} /></details> : <p className="text-xs text-diagnostic-warning">표시 가능한 와이어프레임이 없습니다.</p>}{files.map((file, fileIndex) => <SnapshotFile key={`${string(file.path) ?? 'file'}-${fileIndex}`} file={file} documents={snapshot.documents} />)}</div>}
  </section>
}

function SnapshotFile({ file, documents }: { file: Record<string, unknown>; documents: ProjectSnapshotResponse['documents'] }) {
  const moduleIr = record(file.module)
  const path = string(file.path) ?? '알 수 없는 문서'
  if (moduleIr === null) return <p className="text-sm text-diagnostic-warning">{path}: 모듈 결과 없음</p>
  const screens = records(moduleIr.screens), models = records(moduleIr.models), paths = records(moduleIr.screen_paths), layouts = records(moduleIr.screen_layouts), ia = records(moduleIr.information_architecture)
  const source = documents.find((doc) => record(doc)?.path === path)
  return <article><h4 className="font-mono text-xs font-semibold">{path}</h4><div className="mt-2 grid gap-4 lg:grid-cols-2">
    <SpecGroup title="화면과 행동" empty="화면 명세 없음">{screens.map((screen, i) => { const id = string(screen.id) ?? `screen-${i}`; const routes = paths.filter((route) => string(route.source_screen_id) === id); const layout = layouts.find((entry) => string(entry.screen_id) === id); return <div key={id} className="border-l-2 pl-3"><p className="text-sm font-medium">{string(screen.name) ?? id}</p><p className="font-mono text-[11px] text-text-subtle">{id}</p>{routes.map((route, ri) => <p key={ri} className="mt-1 text-xs text-text-muted">{string(route.source_element_id) ?? '요소 미상'} → {string(route.target_screen_id) ?? '결과 미상'}{string(route.label) ? ` · ${string(route.label)}` : ''}</p>)}{layout ? <p className="mt-1 text-xs text-text-subtle">레이아웃 요소 {records(layout.elements).length}개</p> : <p className="mt-1 text-xs text-diagnostic-warning">레이아웃 미지원/누락</p>}</div> })}</SpecGroup>
    <SpecGroup title="데이터 모델" empty="모델 없음">{models.map((model, i) => <div key={string(model.id) ?? i} className="border-l-2 pl-3"><p className="text-sm font-medium">{string(model.name) ?? string(model.id) ?? '이름 없음'}</p>{records(model.fields).map((field, fi) => <p key={fi} className="mt-1 text-xs text-text-muted">{string(field.name) ?? string(field.id) ?? '필드'} · {field.required === true ? '필수' : '선택'} · 타입 {string(record(field.value_type)?.kind) ?? '미상'}</p>)}</div>)}</SpecGroup>
    <SpecGroup title="정보구조" empty="정보구조 없음">{ia.map((entry, i) => <p key={string(entry.id) ?? i} className="text-xs text-text-muted">{string(entry.name) ?? string(entry.id) ?? '분류'}{string(entry.parent_id) ? ` ← ${string(entry.parent_id)}` : ''}</p>)}</SpecGroup>
  </div><details className="mt-3"><summary className="cursor-pointer text-xs text-text-muted">이 버전의 원문 보기</summary><pre className="mt-2 max-h-64 overflow-auto border bg-surface px-3 py-2 text-xs">{string(record(source)?.text) ?? '원문을 찾지 못했습니다.'}</pre></details></article>
}

function SpecGroup({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { const list = Array.isArray(children) ? children : [children]; return <section><h5 className="text-xs font-semibold">{title}</h5><div className="mt-2 space-y-3">{list.length === 0 ? <p className="text-xs text-text-subtle">{empty}</p> : children}</div></section> }
function MetadataFacts({ metadata, screenKey }: { metadata: Record<string, unknown> | null; screenKey: string }) { const samples = record(record(metadata?.sample_data)?.models); const design = record(record(record(metadata?.design)?.environments)?.desktop) ?? record(record(record(metadata?.design)?.environments)?.all); return <div className="mt-2 text-xs text-text-subtle"><p>화면별 배치 {Object.keys(record(design?.elements) ?? {}).filter((key) => key.includes(screenKey)).length}건</p><p>샘플 모델 {Object.keys(samples ?? {}).length}개 · 정상/빈 상태/긴 문구/많은 데이터 상황 포함</p></div> }
function policyRowsForField(compiled: ProjectCompileResponse, fieldId: string): string[] { const group = collectPolicies(compiled).fields.find((entry) => entry.field.id === fieldId); return group?.constraints.map((constraint) => `${constraint.left} ${constraint.operator} ${constraint.right}`) ?? [] }
function compareSummary(a: ProjectSnapshotResponse, b: ProjectSnapshotResponse) { const documentText = (snapshot: ProjectSnapshotResponse) => new Map(snapshot.documents.map((document) => { const raw = record(document); return [string(raw?.path) ?? '', string(raw?.text) ?? ''] })); const left = documentText(a), right = documentText(b); const paths = new Set([...left.keys(), ...right.keys()]); const changedPaths = [...paths].filter((path) => left.get(path) !== right.get(path)); const aMeta = record(record(a.planning_state)?.metadata) ?? {}, bMeta = record(record(b.planning_state)?.metadata) ?? {}; const metaKeys = new Set([...Object.keys(aMeta), ...Object.keys(bMeta)]); const changedMeta = [...metaKeys].filter((key) => JSON.stringify(aMeta[key]) !== JSON.stringify(bMeta[key])); return { documents: changedPaths.length === 0 ? '변경 없음' : changedPaths.join(', '), metadata: changedMeta.length === 0 ? '변경 없음' : changedMeta.join(', ') } }
function record(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null }
function records(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => record(item) !== null) : [] }
function string(value: unknown): string | null { return typeof value === 'string' ? value : null }
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
