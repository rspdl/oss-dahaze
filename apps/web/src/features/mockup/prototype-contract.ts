/**
 * 컴파일러가 선언한 결과 처리(상태·메시지·팝업·로딩). 체험 모드에서 버튼을 눌렀을 때 미리 보여준다.
 * 지금 작업공간은 이 연결을 만들지 않으므로 화면 이동 결과만 생긴다.
 */
export interface DeclaredHandler {
  kind: 'state' | 'message' | 'popup' | 'loading'
  id: string
  content?: string | null
}

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

export function designBindingKey(binding: DesignBinding): string {
  if (binding.elementId !== undefined) return `${binding.screenKey}:stable:${binding.elementId}`
  return `${binding.screenKey}:${binding.sourceHash ?? 'unversioned'}:${binding.elementPath ?? 'unresolved'}`
}

export interface ActionOutcome {
  id: string
  label: string
  targetScreenKey?: string | null
  handler?: DeclaredHandler | null
}

export interface PrototypeAction {
  screenKey: string
  elementId: string
  outcome: ActionOutcome
}

interface PathProposal {
  sourceScreenKey: string
  sourceElementId: string
  outcomeId: string | null
  targetScreenId: string | null
  handler: DeclaredHandler | null
  label: string | null
}

export type SemanticProposal =
  | { kind: 'add-element'; screenKey: string }
  | { kind: 'delete-element'; binding: ElementSelection }
  | { kind: 'move-element'; binding: ElementSelection }
  | { kind: 'update-element'; binding: ElementSelection }
  | ({ kind: 'connect' } & PathProposal)
  | ({ kind: 'disconnect' } & PathProposal)
