export type PrototypeMode = 'edit' | 'experience'
export type SampleVariant = 'normal' | 'empty' | 'long' | 'many'

export interface MockupDimensions {
  width: number
  height: number
}

export interface SampleRecord {
  id: string
  values: Record<string, string | number | boolean | null>
}

/** A project-owned set. The renderer never invents domain values. */
export interface ModelSampleSet {
  modelId: string
  variants: Record<SampleVariant, SampleRecord[]>
}

export interface DesignBinding {
  screenKey: string
  /** Compiler stable id when available. */
  elementId?: string
  /** Revision-bound fallback. Never reapply after the source changes. */
  elementPath?: string
  sourceHash?: string
}

export interface ElementSelection extends DesignBinding {
  elementKind: 'header' | 'section' | 'heading' | 'form' | 'input' | 'list' | 'button' | 'placeholder' | 'unrecognized'
  name?: string
  text?: string
  actionId?: string | null
  fieldId?: string
  modelId?: string
  fieldIds?: string[]
}

export interface ElementDesign {
  width?: number
  height?: number
}

export interface DesignChange {
  binding: DesignBinding
  patch: ElementDesign
}

export function designBindingKey(binding: DesignBinding): string {
  if (binding.elementId !== undefined) return `${binding.screenKey}:stable:${binding.elementId}`
  return `${binding.screenKey}:${binding.sourceHash ?? 'unversioned'}:${binding.elementPath ?? 'unresolved'}`
}

export interface ActionOutcome {
  id: string
  label: string
  targetScreenKey: string
}

export interface PrototypeAction {
  screenKey: string
  elementId: string
  outcome: ActionOutcome
}

export type SemanticProposal =
  | { kind: 'add-element'; screenKey: string }
  | { kind: 'delete-element'; binding: ElementSelection }
  | { kind: 'move-element'; binding: ElementSelection }
  | { kind: 'update-element'; binding: ElementSelection }
  | { kind: 'connect'; sourceScreenKey: string; sourceElementId: string; targetScreenKey: string }
