import type { ConnectCompilerEdit, DisconnectCompilerEdit, ProposePlanningEditRequestEdit } from '@dahaze/api-client'

import type { SemanticProposal } from '../mockup/prototype-contract'

export type PlanningElementKind = 'header' | 'section' | 'form' | 'heading' | 'input' | 'list' | 'button' | 'placeholder'

export interface PlanningEditForm {
  kind: PlanningElementKind
  elementId: string
  value: string
  secondaryValue: string
  parentId: string
  beforeId: string
  slot: 'root' | 'children' | 'inputs'
  label: string
}

export function buildEdit(proposal: SemanticProposal, screenId: string, form: PlanningEditForm): ProposePlanningEditRequestEdit {
  if (proposal.kind === 'delete-element') return { operation: 'delete', screen_id: screenId, element_id: proposal.binding.elementId! }
  if (proposal.kind === 'move-element') return { operation: 'move', screen_id: screenId, element_id: proposal.binding.elementId!, slot: form.slot, parent_element_id: optional(form.parentId), before_element_id: optional(form.beforeId) }
  if (proposal.kind === 'connect') return pathEdit('connect', proposal, screenId, optional(form.label) ?? null)
  if (proposal.kind === 'disconnect') return pathEdit('disconnect', proposal, screenId, proposal.label)
  if (proposal.kind === 'update-element') {
    const binding = proposal.binding
    const patch = binding.elementKind === 'button' ? { name: form.value, action_id: optional(form.secondaryValue) ?? null } : binding.elementKind === 'input' ? { field_id: form.value } : binding.elementKind === 'list' ? { model_id: form.value, field_ids: commaIds(form.secondaryValue) } : { text: form.value }
    return { operation: 'update', screen_id: screenId, element_id: binding.elementId!, patch }
  }
  const base = { id: form.elementId }
  const element = form.kind === 'heading' ? { ...base, kind: 'heading' as const, text: form.value } : form.kind === 'button' ? { ...base, kind: 'button' as const, name: form.value, action_id: optional(form.secondaryValue) } : form.kind === 'input' ? { ...base, kind: 'input' as const, field_id: form.value } : form.kind === 'list' ? { ...base, kind: 'list' as const, model_id: form.value, field_ids: commaIds(form.secondaryValue) } : form.kind === 'placeholder' ? { ...base, kind: 'placeholder' as const, text: form.value } : { ...base, kind: form.kind }
  return { operation: 'insert', screen_id: screenId, element, slot: form.slot, parent_element_id: optional(form.parentId), before_element_id: optional(form.beforeId) }
}

function pathEdit(operation: 'connect', proposal: Extract<SemanticProposal, { kind: 'connect' }>, screenId: string, label: string | null): ConnectCompilerEdit
function pathEdit(operation: 'disconnect', proposal: Extract<SemanticProposal, { kind: 'disconnect' }>, screenId: string, label: string | null): DisconnectCompilerEdit
function pathEdit(operation: 'connect' | 'disconnect', proposal: Extract<SemanticProposal, { kind: 'connect' | 'disconnect' }>, screenId: string, label: string | null): ConnectCompilerEdit | DisconnectCompilerEdit {
  return { operation, source_screen_id: screenId, source_element_id: proposal.sourceElementId, outcome_id: proposal.outcomeId, target_screen_id: proposal.targetScreenId, handler: proposal.handler, label }
}

function commaIds(value: string): string[] { return value.split(',').map((item) => item.trim()).filter(Boolean) }
function optional(value: string): string | undefined { return value.trim() === '' ? undefined : value.trim() }
