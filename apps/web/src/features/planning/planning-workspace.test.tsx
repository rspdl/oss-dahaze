import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { PlanningWorkspaceModel } from './planning-types'
import { PlanningWorkspace } from './planning-workspace'

const base: PlanningWorkspaceModel = {
  revision: 2, projectRevision: 4, sourceHash: 'abc', messages: [], acceptedDecisions: [], unresolvedDecisions: [], questions: [], unsupported: [],
  compiler: { state: 'not-run', diagnostics: [] }, drafts: [], selectedDraftId: null, snapshots: [],
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
})
