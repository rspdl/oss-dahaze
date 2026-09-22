export type PlanningMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }
export type PlanningItem = { id: string; title: string; detail?: string; sourcePath?: string }
export type PlanningDraftChange = { path: string; before?: string | null; after: string | null }
export type PlanningDraft = { id: string; summary: string; baseRevision: number; status: 'draft' | 'applying' | 'applied'; changes: PlanningDraftChange[]; diagnostics: PlanningItem[]; analysis: string[] }
export type PlanningSnapshot = { revision: number; createdAt: string; changeKind: string; sourceHash: string }

export interface PlanningWorkspaceModel {
  revision: number
  projectRevision: number
  sourceHash: string
  messages: PlanningMessage[]
  acceptedDecisions: PlanningItem[]
  unresolvedDecisions: PlanningItem[]
  questions: PlanningItem[]
  unsupported: PlanningItem[]
  compiler: { state: 'not-run' | 'running' | 'recognized' | 'unsupported-shape'; rspdlVersion?: string; diagnostics: PlanningItem[] }
  drafts: PlanningDraft[]
  selectedDraftId: string | null
  snapshots: PlanningSnapshot[]
}
