import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PlanningWorkspaceModel } from './planning-types'
import { PlanningWorkspace } from './planning-workspace'

const base: PlanningWorkspaceModel = {
  revision: 2, projectRevision: 4, sourceHash: 'abc', messages: [], acceptedDecisions: [], unresolvedDecisions: [], questions: [], unsupported: [],
  compiler: { state: 'not-run', source: { kind: 'current', documents: [] }, diagnostics: [] }, drafts: [], selectedDraftId: null, snapshots: [],
}

describe('PlanningWorkspace', () => {
  it('컴파일러 진단, AI 질문, 미정 결정, 미지원 범위를 분리한다', () => {
    const markup = renderToStaticMarkup(<PlanningWorkspace model={{ ...base, questions: [{ id: 'q', title: '연락처 출처는 무엇인가요?' }], unsupported: [{ id: 'u', title: '외부 결제 실행' }] }} />)
    expect(markup).toContain('컴파일러 진단')
    expect(markup).toContain('AI 확인 질문')
    expect(markup).toContain('미정 결정')
    expect(markup).toContain('검증 미지원 범위')
  })

  it('진단이 비어 있어도 검사 전 상태를 검증 완료로 표현하지 않는다', () => {
    const markup = renderToStaticMarkup(<PlanningWorkspace model={base} />)
    expect(markup).toContain('검사 전')
    expect(markup).not.toContain('검증 완료')
    expect(markup).not.toContain('문제 없음')
  })

  it('명시적으로 초안을 선택하지 않으면 적용된 초안을 미리보기나 진단 출처로 쓰지 않는다', () => {
    const markup = renderToStaticMarkup(<PlanningWorkspace model={{
      ...base,
      compiler: { state: 'recognized', source: { kind: 'current', documents: [{ id: 'document-1', path: 'accepted.rspdl', sourceHash: 'a'.repeat(64) }] }, rspdlVersion: '0.8.0', diagnostics: [] },
      drafts: [{ id: 'applied', summary: '예전 적용 초안', baseRevision: 3, status: 'applied', changes: [{ path: 'old.rspdl', after: 'old' }], diagnostics: [], analysis: [] }],
    }} />)

    expect(markup).toContain('저장 명세 · 결과 수신')
    expect(markup).toContain('accepted.rspdl')
    expect(markup).toContain('예전 적용 초안')
    expect(markup).not.toContain('변경 미리보기')
  })

  it('선택한 stale 초안의 진단 출처와 원문 해시를 현재 저장 명세와 구분한다', () => {
    const markup = renderToStaticMarkup(<PlanningWorkspace model={{
      ...base,
      selectedDraftId: 'draft-1',
      compiler: {
        state: 'recognized',
        source: { kind: 'draft', draftId: 'draft-1', summary: '연락처 변경', baseProjectRevision: 3, baseSourceHash: 'base-hash', candidateSourceHash: 'candidate-hash', stale: true },
        diagnostics: [{ id: 'candidate:0', title: '후보 진단', sourcePath: 'candidate.rspdl' }],
      },
      drafts: [{ id: 'draft-1', summary: '연락처 변경', baseRevision: 3, status: 'draft', changes: [], diagnostics: [], analysis: [] }],
    }} />)

    expect(markup).toContain('선택한 초안 · 결과 수신')
    expect(markup).toContain('기준 원문 base-hash')
    expect(markup).toContain('후보 원문 candidate-hash')
    expect(markup).toContain('현재 저장 명세와 다른 기준에서 만든 초안')
    expect(markup).toContain('후보 진단')
    expect(markup).toContain('<span class="mt-1 block font-mono text-[11px] text-text-subtle">candidate.rspdl</span>')
    expect(markup).not.toMatch(/<button[^>]*>candidate\.rspdl<\/button>/)
  })

  it('저장 명세 진단은 핸들러가 있을 때만 문서 이동 버튼으로 표시한다', () => {
    const model: PlanningWorkspaceModel = {
      ...base,
      compiler: { state: 'recognized', source: { kind: 'current', documents: [{ id: 'document-1', path: 'accepted.rspdl', sourceHash: 'a'.repeat(64) }] }, diagnostics: [{ id: 'accepted:0', title: '저장본 진단', sourcePath: 'accepted.rspdl' }] },
    }
    const clickable = renderToStaticMarkup(<PlanningWorkspace model={model} onOpenSource={() => undefined} />)
    const staticPath = renderToStaticMarkup(<PlanningWorkspace model={model} />)

    expect(clickable).toMatch(/<button[^>]*>accepted\.rspdl<\/button>/)
    expect(staticPath).toContain('<span class="mt-1 block font-mono text-[11px] text-text-subtle">accepted.rspdl</span>')
    expect(staticPath).not.toMatch(/<button[^>]*>accepted\.rspdl<\/button>/)
  })

  it('불러오기 실패와 지원하지 않는 결과를 검사 전과 구분한다', () => {
    const failed = renderToStaticMarkup(<PlanningWorkspace model={{ ...base, compiler: { state: 'failed', source: { kind: 'current', documents: [] }, diagnostics: [], failureMessage: 'network down' } }} />)
    const unsupported = renderToStaticMarkup(<PlanningWorkspace model={{ ...base, compiler: { state: 'unsupported-shape', source: { kind: 'current', documents: [] }, diagnostics: [] } }} />)

    expect(failed).toContain('불러오기 실패')
    expect(failed).toContain('이전 결과로 대신 표시하지 않습니다')
    expect(failed).toContain('network down')
    expect(unsupported).toContain('지원하지 않는 결과')
    expect(unsupported).toContain('현재 화면이 알지 못하는 컴파일 결과 모양')
  })
})
