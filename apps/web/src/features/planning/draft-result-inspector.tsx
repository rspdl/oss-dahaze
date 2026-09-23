'use client'

import * as React from 'react'
import { useMemo } from 'react'
import type { PlanningDraftResponse, PlanningStateResponse } from '@dahaze/api-client'

import { buildReadableSpecification, type ReadableCategory, type ReadableSpecification } from '../specification/readable-specification'
import { ReadableSpecificationPanel } from '../specification/readable-specification-panel'

export function DraftResultInspector({ draft, planningState }: { draft: PlanningDraftResponse; planningState: PlanningStateResponse }) {
  const specification = useMemo(() => buildReadableSpecification(
    { result: draft.result, wire_schema_version: draft.wire_schema_version },
    { documents: draft.candidate_documents, planningState },
  ), [draft, planningState])

  return <section className="border-b p-4" aria-label="컴파일된 후보 결과">
    <div><h3 className="text-sm font-semibold">컴파일된 후보 결과</h3><p className="mt-1 text-xs text-text-muted">후보 원문에서 만든 정보구조와 기능명세입니다. 변경 적용 전까지 저장 명세와 분리됩니다.</p></div>
    <CandidateInformationArchitecture specification={specification} />
    <details className="mt-4 rounded-control border px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold">후보 기능명세 보기</summary>
      <ReadableSpecificationPanel specification={specification} className="mt-4" />
    </details>
  </section>
}

function CandidateInformationArchitecture({ specification }: { specification: ReadableSpecification }) {
  const ordered = orderCategories(specification.categories)
  const screenByKey = new Map(specification.screens.map((screen) => [screen.key, screen]))
  const assigned = new Set(specification.categories.flatMap((category) => category.screenIds.map((screenId) => `${category.source.path}:${screenId}`)))
  const unassigned = specification.screens.filter((screen) => !assigned.has(screen.key))
  const unavailable = specification.state === 'uncompiled'
    ? '후보의 컴파일 결과가 없어 정보구조를 표시하지 못했습니다.'
    : specification.state === 'unsupported'
      ? '현재 화면이 지원하지 않는 컴파일 결과 형식입니다.'
      : null
  return <section className="mt-4"><h4 className="text-xs font-semibold">후보 정보구조</h4>{unavailable !== null ? <p className="mt-2 text-xs text-diagnostic-warning">{unavailable}</p> : ordered.length === 0 && unassigned.length === 0 ? <p className="mt-2 text-xs text-text-subtle">후보에 선언된 화면과 정보구조가 없습니다.</p> : <div className="mt-2 space-y-1 rounded-control border px-3 py-2">{ordered.map(({ category, depth }) => <div key={category.key}><p className="text-xs font-medium text-text" style={{ paddingLeft: `${depth * 14}px` }}>{category.name}</p>{category.screenIds.map((screenId) => { const key = `${category.source.path}:${screenId}`; return <p key={key} className="text-xs text-text-muted" style={{ paddingLeft: `${(depth + 1) * 14}px` }}>화면 · {screenByKey.get(key)?.name ?? screenId}</p> })}</div>)}{unassigned.map((screen) => <p key={screen.key} className="text-xs text-text-muted">화면 · {screen.name} <span className="text-text-subtle">(분류 미지정)</span></p>)}</div>}</section>
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
