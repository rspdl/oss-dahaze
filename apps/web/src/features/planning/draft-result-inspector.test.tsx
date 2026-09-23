import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PlanningDraftResponse, PlanningStateResponse } from '@dahaze/api-client'

import { DraftResultInspector } from './draft-result-inspector'

describe('DraftResultInspector', () => {
  it('컴파일된 후보에서 IA와 기능명세를 보여 주고 저장 명세와 구분한다', () => {
    const draft = {
      id: 'draft-1', project_id: 'project-1', applied_revision: null, base_project_revision: 2,
      base_source_hash: 'a'.repeat(64), candidate_source_hash: 'b'.repeat(64),
      created_at: '', updated_at: '', locale: 'ko-KR', rspdl_version: '0.8.0', wire_schema_version: 1, summary: '예약 화면 추가',
      changes: [], candidate_documents: [{ path: 'booking.rspdl', text: 'candidate source' }],
      result: { files: [{ path: 'booking.rspdl', diagnostics: [], module: {
        information_architecture: [{ id: 'booking', name: '예약', parent_id: null, span: { start: 0, end: 1 } }],
        screen_categories: [{ category_id: 'booking', screen_id: 'booking.start', span: { start: 0, end: 1 } }],
        screens: [{ id: 'booking.start', name: '예약 시작', span: { start: 0, end: 1 } }],
        screen_layouts: [], screen_paths: [], models: [], roles: [], actions: [], policies: [],
      } }] },
    } as unknown as PlanningDraftResponse
    const planningState = { decisions: [], messages: [], metadata: {}, metadata_revision: 0, project_revision: 2, proposals: [], revision: 0, source_hash: 'a'.repeat(64) } as PlanningStateResponse

    const markup = renderToStaticMarkup(<DraftResultInspector draft={draft} planningState={planningState} />)

    expect(markup).toContain('컴파일된 후보 결과')
    expect(markup).toContain('변경 적용 전까지 저장 명세와 분리됩니다')
    expect(markup).toContain('후보 정보구조')
    expect(markup).toContain('예약 시작')
    expect(markup).toContain('후보 기능명세 보기')
  })

  it('같은 화면 ID를 가진 두 문서의 IA 배정을 source path로 분리한다', () => {
    const moduleIr = (screenName: string, assigned: boolean) => ({
      information_architecture: assigned ? [{ id: 'root', name: '분류 A', parent_id: null, span: { start: 0, end: 1 } }] : [],
      screen_categories: assigned ? [{ category_id: 'root', screen_id: 'shared', span: { start: 0, end: 1 } }] : [],
      screens: [{ id: 'shared', name: screenName, span: { start: 0, end: 1 } }],
      screen_layouts: [], screen_paths: [], models: [], roles: [], actions: [], policies: [],
    })
    const draft = {
      id: 'draft-2', project_id: 'project-1', applied_revision: null, base_project_revision: 2,
      base_source_hash: 'a'.repeat(64), candidate_source_hash: 'b'.repeat(64), created_at: '', updated_at: '',
      locale: 'ko-KR', rspdl_version: '0.8.0', wire_schema_version: 1, summary: '충돌 후보', changes: [],
      candidate_documents: [{ path: 'a.rspdl', text: 'a' }, { path: 'b.rspdl', text: 'b' }],
      result: { files: [{ path: 'a.rspdl', diagnostics: [], module: moduleIr('A 화면', true) }, { path: 'b.rspdl', diagnostics: [], module: moduleIr('B 화면', false) }] },
    } as unknown as PlanningDraftResponse
    const planningState = { decisions: [], messages: [], metadata: {}, metadata_revision: 0, project_revision: 2, proposals: [], revision: 0, source_hash: 'a'.repeat(64) } as PlanningStateResponse

    const markup = renderToStaticMarkup(<DraftResultInspector draft={draft} planningState={planningState} />)

    expect(markup).toMatch(/분류 A[\s\S]*화면 · A 화면/)
    expect(markup).toMatch(/화면 · B 화면[\s\S]*\(분류 미지정\)/)
  })
})
