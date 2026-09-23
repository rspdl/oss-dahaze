import type { CreatePlanningAiJobRequest } from '@dahaze/api-client'

import type { PlanningSubject } from './planning-types'

export function buildPlanningAiJobRequest(input: {
  requestId: string
  kind: 'interview' | 'generate'
  instruction: string
  planningRevision: number
  projectRevision: number
  sourceHash: string
  sourceDraftId?: string
  subject?: PlanningSubject
}): CreatePlanningAiJobRequest {
  const { subject } = input
  return {
    request_id: input.requestId,
    kind: input.kind,
    instruction: input.instruction,
    expected_planning_revision: input.planningRevision,
    base_project_revision: input.projectRevision,
    base_source_hash: input.sourceHash,
    ...(input.sourceDraftId === undefined ? {} : { source_draft_id: input.sourceDraftId }),
    ...(subject === undefined ? {} : { selected_subject: {
      kind: subject.kind,
      id: subject.id,
      label: subject.label,
      ...(subject.sourcePath === undefined ? {} : { source_path: subject.sourcePath }),
      ...(subject.stableId === undefined ? {} : { stable_id: subject.stableId }),
    } }),
  }
}
