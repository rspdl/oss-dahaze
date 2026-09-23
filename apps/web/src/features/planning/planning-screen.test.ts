import { describe, expect, it, vi } from 'vitest'
import type { PlanningDraftResponse, PlanningDraftSummaryResponse, PlanningStateResponse, ProjectCompileResponse } from '@dahaze/api-client'

vi.mock('../auth/require-session', () => ({ RequireSession: () => null }))
vi.mock('../../shared/ui/app-shell', () => ({ AppShell: () => null, Crumb: () => null }))
vi.mock('./handoff-inspector', () => ({ HandoffInspector: () => null }))
vi.mock('./metadata-editor', () => ({ MetadataEditor: () => null }))
vi.mock('./planning-workspace', () => ({ PlanningWorkspace: () => null }))

import { acceptedCompilerDocumentHref, toAiJob, toModel, type PlanningCompilerInputs } from './planning-screen'

function state(overrides: Partial<PlanningStateResponse> = {}): PlanningStateResponse {
  return {
    decisions: [], messages: [], metadata: {}, metadata_revision: 1, project_revision: 4,
    proposals: [], revision: 2, source_hash: 'current-source', ...overrides,
  } as PlanningStateResponse
}

function diagnostic(message: string) {
  return { rule_id: 'RSPDL-TEST', severity: 'warning', message_key: 'test.message', message, arguments: {}, span: { start: 0, end: 1 } }
}

function compilation(result: unknown): ProjectCompileResponse {
  return {
    documents: [{ id: 'document-1', path: 'accepted.rspdl', source_hash: 'a'.repeat(64), target_rspdl_version: '0.8.0', title: '저장 명세', updated_at: '2026-09-23T00:00:00Z' }],
    locale: 'ko-KR', result: result as ProjectCompileResponse['result'], rspdl_version: '0.8.0', wire_schema_version: 1,
  }
}

function draftSummary(): PlanningDraftSummaryResponse {
  return {
    applied_revision: null, base_project_revision: 3, base_source_hash: 'old-source', candidate_source_hash: 'candidate-source', created_at: '2026-09-23T00:00:00Z', id: 'draft-1', locale: 'ko-KR', project_id: 'project-1', rspdl_version: '0.8.0', summary: '후보 변경', updated_at: '2026-09-23T00:00:00Z', wire_schema_version: 1,
  }
}

function draft(result: unknown): PlanningDraftResponse {
  return {
    ...draftSummary(), candidate_documents: [], changes: [], result: result as PlanningDraftResponse['result'],
  }
}

function inputs(overrides: Partial<PlanningCompilerInputs> = {}): PlanningCompilerInputs {
  return {
    current: { state: 'ready', data: compilation({ files: [{ path: 'accepted.rspdl', diagnostics: [diagnostic('저장본 진단')] }] }) },
    selectedDraft: { state: 'ready' },
    ...overrides,
  }
}

describe('planning compiler review model', () => {
  it('uses the accepted compilation when no draft is explicitly selected', () => {
    const applied = { ...draftSummary(), applied_revision: 4 }
    const model = toModel(state(), [applied], [], null, inputs({ selectedDraft: { state: 'ready', data: draft({ files: [{ path: 'candidate.rspdl', diagnostics: [diagnostic('후보 진단')] }] }) } }))

    expect(model.compiler).toMatchObject({ state: 'recognized', source: { kind: 'current', documents: [{ id: 'document-1', path: 'accepted.rspdl', sourceHash: 'a'.repeat(64) }] }, rspdlVersion: '0.8.0' })
    expect(model.compiler.diagnostics).toEqual([expect.objectContaining({ detail: '저장본 진단', sourcePath: 'accepted.rspdl' })])
    expect(model.selectedDraftId).toBeNull()
  })

  it('keeps selected draft diagnostics and stale provenance separate from accepted source', () => {
    const model = toModel(state(), [draftSummary()], [], 'draft-1', inputs({
      selectedDraft: { state: 'ready', data: draft({ files: [{ path: 'candidate.rspdl', diagnostics: [diagnostic('후보 진단')] }] }) },
    }))

    expect(model.compiler).toMatchObject({
      state: 'recognized',
      source: { kind: 'draft', draftId: 'draft-1', baseProjectRevision: 3, baseSourceHash: 'old-source', candidateSourceHash: 'candidate-source', stale: true },
      diagnostics: [{ detail: '후보 진단', sourcePath: 'candidate.rspdl' }],
    })
    expect(model.compiler.diagnostics.some((item) => item.sourcePath === 'accepted.rspdl')).toBe(false)
  })

  it('does not fall through to accepted diagnostics when the selected draft fails to load', () => {
    const model = toModel(state(), [draftSummary()], [], 'draft-1', inputs({ selectedDraft: { state: 'failed', failureMessage: 'draft request failed' } }))

    expect(model.compiler).toMatchObject({ state: 'failed', source: { kind: 'draft', draftId: 'draft-1', stale: true }, diagnostics: [], failureMessage: 'draft request failed' })
  })

  it('keeps loading, failure, and unsupported current compilation states distinct and drops cached data', () => {
    const cached = compilation({ files: [{ path: 'old.rspdl', diagnostics: [diagnostic('오래된 진단')] }] })
    const loading = toModel(state(), [], [], null, inputs({ current: { state: 'loading', data: cached } }))
    const failed = toModel(state(), [], [], null, inputs({ current: { state: 'failed', data: cached, failureMessage: 'compile request failed' } }))
    const unsupported = toModel(state(), [], [], null, inputs({ current: { state: 'ready', data: compilation({ files: [{ path: 'accepted.rspdl', diagnostics: 'future-shape' }] }) } }))

    expect(loading.compiler).toMatchObject({ state: 'running', source: { kind: 'current', documents: [] }, diagnostics: [] })
    expect(failed.compiler).toMatchObject({ state: 'failed', source: { kind: 'current', documents: [] }, diagnostics: [], failureMessage: 'compile request failed' })
    expect(unsupported.compiler).toMatchObject({ state: 'unsupported-shape', diagnostics: [] })
  })

  it('builds document navigation only from recognized accepted compiler metadata', () => {
    const accepted = toModel(state(), [], [], null, inputs()).compiler
    const candidate = toModel(state(), [draftSummary()], [], 'draft-1', inputs({ selectedDraft: { state: 'ready', data: draft({ files: [{ path: 'candidate.rspdl', diagnostics: [] }] }) } })).compiler

    expect(acceptedCompilerDocumentHref('project-1', accepted, 'accepted.rspdl')).toBe('/projects/project-1/documents/document-1')
    expect(acceptedCompilerDocumentHref('project-1', accepted, 'missing.rspdl')).toBeNull()
    expect(acceptedCompilerDocumentHref('project-1', candidate, 'candidate.rspdl')).toBeNull()
  })
})

describe('planning AI review model', () => {
  it('keeps AI policy proposals open until the user resolves them', () => {
    const model = toModel(state({ proposals: [
      { id: 'question', kind: 'question', status: 'open', title: '연락처 출처는 무엇인가요?' },
      { id: 'policy', kind: 'policy', status: 'open', title: '결제 실패는 같은 화면에서 재시도한다' },
      { id: 'deferred', kind: 'policy', status: 'deferred', title: '나중에 정할 정책', rationale: '운영팀 확인 필요' },
    ] }), [], [], null, inputs())

    expect(model.questions).toEqual([expect.objectContaining({ id: 'question' })])
    expect(model.proposals).toEqual([
      expect.objectContaining({ id: 'policy', status: 'open' }),
      expect.objectContaining({ id: 'deferred', status: 'deferred', rationale: '운영팀 확인 필요' }),
    ])
    expect(model.acceptedDecisions).toEqual([])
  })

  it('preserves durable job progress, sanitized failure, stale conflicts, and retry limits', () => {
    expect(toAiJob({ id: 'job-1', kind: 'interview', status: 'running', progress: { stage: 'interview', completed: 1, total: 2, message: '질문을 정리하고 있습니다.' }, attempt: 1, max_attempts: 3, created_at: 'now' })).toMatchObject({ status: 'running', stage: 'interview', completed: 1, total: 2, retryable: false })
    expect(toAiJob({ id: 'job-2', kind: 'generate', status: 'failed', error: { code: 'invalid_output', message: '출력을 검증하지 못했습니다.', retryable: true }, attempt: 1, max_attempts: 3, created_at: 'now' })).toMatchObject({ errorMessage: '출력을 검증하지 못했습니다.', retryable: true })
    expect(toAiJob({ id: 'job-3', kind: 'interview', status: 'succeeded', result: { disposition: 'stale', conflict: { frozen_planning_revision: 2, current_planning_revision: 4 } }, attempt: 1, max_attempts: 3, created_at: 'now' })).toMatchObject({ disposition: 'stale', conflictMessage: '기준 기획 리비전 2에서 만든 결과이며 현재 리비전은 4입니다.' })
    expect(toAiJob({ id: 'job-3b', kind: 'interview', status: 'succeeded', result: { assistant_message: '확인 결과', policy_first_questions: [{ question: '연락처 출처는 무엇인가요?' }], proposals: [{ title: '실패 시 재시도' }], unsupported: ['외부 결제 실행'] }, attempt: 1, max_attempts: 3, created_at: 'now' })).toMatchObject({ resultMessage: '확인 결과', resultItems: ['실패 시 재시도', '연락처 출처는 무엇인가요?', '외부 결제 실행'] })
    expect(toAiJob({ id: 'job-4', kind: 'generate', status: 'failed', error: { retryable: true }, attempt: 3, max_attempts: 3, created_at: 'now' })?.retryable).toBe(false)
  })
})
