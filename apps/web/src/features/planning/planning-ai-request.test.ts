import { describe, expect, it } from 'vitest'

import { buildPlanningAiJobRequest } from './planning-ai-request'

describe('planning AI job request', () => {
  it('freezes optimistic versions and duplicate-safe selected element context', () => {
    expect(buildPlanningAiJobRequest({
      requestId: '00000000-0000-4000-8000-000000000001', kind: 'interview', instruction: '이 버튼의 실패 처리를 확인해 주세요.',
      planningRevision: 7, projectRevision: 4, sourceHash: 'a'.repeat(64), sourceDraftId: 'draft-1',
      subject: { kind: 'element', id: 'pay', stableId: 'pay', sourcePath: 'mobile/checkout.rspdl', label: '결제 버튼' },
    })).toEqual({
      request_id: '00000000-0000-4000-8000-000000000001', kind: 'interview', instruction: '이 버튼의 실패 처리를 확인해 주세요.',
      expected_planning_revision: 7, base_project_revision: 4, base_source_hash: 'a'.repeat(64), source_draft_id: 'draft-1',
      selected_subject: { kind: 'element', id: 'pay', stable_id: 'pay', source_path: 'mobile/checkout.rspdl', label: '결제 버튼' },
    })
  })

  it('does not invent a selected subject or candidate source for accepted-source generation', () => {
    const request = buildPlanningAiJobRequest({ requestId: 'request-2', kind: 'generate', instruction: '초안을 작성해 주세요.', planningRevision: 1, projectRevision: 2, sourceHash: 'b'.repeat(64) })
    expect(request.selected_subject).toBeUndefined()
    expect(request.source_draft_id).toBeUndefined()
  })
})
