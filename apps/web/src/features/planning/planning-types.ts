export type PlanningMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }
export type PlanningItem = { id: string; title: string; detail?: string; resolutionRationale?: string; sourcePath?: string }
export type PlanningProposal = PlanningItem & { status: 'open' | 'adopted' | 'deferred'; rationale?: string }
export type PlanningSubject = { kind: 'question' | 'diagnostic' | 'proposal' | 'draft' | 'screen' | 'element'; id: string; label: string; sourcePath?: string; stableId?: string }
export type PlanningAiJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type PlanningAiJob = {
  id: string
  kind: 'interview' | 'generate'
  status: PlanningAiJobStatus
  stage?: string
  completed?: number
  total?: number
  message?: string
  errorMessage?: string
  retryable: boolean
  disposition?: 'current' | 'stale'
  conflictMessage?: string
  draftId?: string
  resultMessage?: string
  resultItems?: string[]
  createdAt: string
}
export type PlanningDraftChange = { path: string; before?: string | null; after: string | null }
export type PlanningDraft = { id: string; summary: string; baseRevision: number; status: 'draft' | 'applying' | 'applied'; changes: PlanningDraftChange[]; diagnostics: PlanningItem[]; analysis: string[] }
export type PlanningSnapshot = { revision: number; createdAt: string; changeKind: string; sourceHash: string }

export type PlanningCompilerState = 'not-run' | 'running' | 'recognized' | 'unsupported-shape' | 'failed'
export type PlanningCompilerSource =
  | { kind: 'current'; documents: { id: string; path: string; sourceHash: string }[] }
  | { kind: 'draft'; draftId: string; summary: string; baseProjectRevision: number; baseSourceHash: string; candidateSourceHash: string; stale: boolean }

export interface PlanningCompilerReview {
  state: PlanningCompilerState
  source: PlanningCompilerSource
  rspdlVersion?: string
  diagnostics: PlanningItem[]
  failureMessage?: string
}

export interface PlanningWorkspaceModel {
  revision: number
  projectRevision: number
  sourceHash: string
  messages: PlanningMessage[]
  acceptedDecisions: PlanningItem[]
  unresolvedDecisions: PlanningItem[]
  questions: PlanningItem[]
  proposals: PlanningProposal[]
  unsupported: PlanningItem[]
  jobs: PlanningAiJob[]
  compiler: PlanningCompilerReview
  drafts: PlanningDraft[]
  selectedDraftId: string | null
  snapshots: PlanningSnapshot[]
}
