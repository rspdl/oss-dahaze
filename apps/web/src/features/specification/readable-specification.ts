import type { ProjectCompileResponse } from '@dahaze/api-client'

export type SpecificationState = 'present' | 'absent' | 'uncompiled' | 'unsupported'

export interface SpecificationIdentity {
  snapshotVersion: number
  projectRevision: number
  sourceHash: string
  rspdlVersion: string
  wireSchemaVersion: number
}

export interface SpecificationDocument {
  path: string
  title: string | null
  text: string
}

export interface SourceReference {
  path: string
  span: { start: number; end: number } | null
  document: SpecificationDocument | null
}

export interface NamedSpecificationRef {
  id: string
  name: string
  resolved: boolean
}

export interface ReadableConstraint {
  id: string
  left: string
  operator: string
  right: string
  source: SourceReference
}

export interface ReadableProvenance {
  id: string
  kind: string
  sourceLabel: string
  phase: string | null
  verification: string | null
  rawCondition: string | null
  source: SourceReference
}

export interface ReadableField extends NamedSpecificationRef {
  model: NamedSpecificationRef
  required: boolean
  typeKind: string
  enumVariants: string[] | null
  constraints: ReadableConstraint[]
  provenance: ReadableProvenance[]
  source: SourceReference
}

export interface ReadableModel extends NamedSpecificationRef {
  key: string
  fields: ReadableField[]
  source: SourceReference
}

export interface ReadableOperation {
  kind: string
  model: NamedSpecificationRef
  fields: NamedSpecificationRef[]
  source: SourceReference
}

export interface ReadablePermission {
  role: NamedSpecificationRef
  action: NamedSpecificationRef
  model: NamedSpecificationRef
  field: NamedSpecificationRef | null
  verification: string
  rawCondition: string | null
  source: SourceReference
}

export interface ReadableProvidedData {
  model: NamedSpecificationRef
  field: NamedSpecificationRef
  sourceKind: string
  sourceLabel: string
  verification: string
  prerequisiteFields: NamedSpecificationRef[]
  source: SourceReference
}

export interface ReadableRecovery {
  kind: string
  screen: NamedSpecificationRef | null
  elementId: string | null
  action: NamedSpecificationRef | null
  pathId: string | null
  source: SourceReference
}

export interface ReadableOutcome {
  id: string
  localId: string
  kind: string
  action: NamedSpecificationRef
  providedData: ReadableProvidedData[]
  recovery: ReadableRecovery | null
  source: SourceReference
}

export interface ReadablePath {
  id: string | null
  sourceScreenId: string
  sourceElementId: string
  targetScreen: NamedSpecificationRef | null
  outcome: ReadableOutcome | null
  outcomeId: string | null
  handler: { kind: string; id: string | null; content: string | null } | null
  /** Display prose only. Never interpreted as an executable condition. */
  label: string | null
  rawCondition: string | null
  source: SourceReference
}

export interface ReadableElement {
  key: string
  path: string
  id: string | null
  kind: string
  recognized: boolean
  name: string | null
  text: string | null
  action: NamedSpecificationRef | null
  model: NamedSpecificationRef | null
  fields: ReadableField[]
  outcomes: ReadableOutcome[]
  paths: ReadablePath[]
  permissions: ReadablePermission[]
  children: ReadableElement[]
  source: SourceReference
}

export interface ReadableScreen extends NamedSpecificationRef {
  key: string
  kind: string | null
  roles: NamedSpecificationRef[]
  operations: ReadableOperation[]
  permissions: ReadablePermission[]
  elements: ReadableElement[]
  paths: ReadablePath[]
  source: SourceReference
}

export interface ReadableCategory extends NamedSpecificationRef {
  key: string
  parentId: string | null
  screenIds: string[]
  source: SourceReference
}

export interface ReadableDiagnostic {
  path: string
  ruleId: string
  severity: string
  messageKey: string
  message: string | null
  arguments: Record<string, string>
  source: SourceReference
}

export interface ReadableContextItem {
  id: string
  kind: 'deferred' | 'question' | 'unsupported'
  title: string
  content: string | null
}

export interface ReadableSpecification {
  state: SpecificationState
  identity: SpecificationIdentity | null
  documents: SpecificationDocument[]
  modelsState: SpecificationState
  screensState: SpecificationState
  outcomesState: SpecificationState
  diagnosticsState: SpecificationState
  models: ReadableModel[]
  screens: ReadableScreen[]
  categories: ReadableCategory[]
  diagnostics: ReadableDiagnostic[]
  context: ReadableContextItem[]
}

export interface ReadableSpecificationOptions {
  documents?: readonly unknown[]
  identity?: SpecificationIdentity | null
  planningState?: unknown
}

type CompilationEnvelope = Pick<ProjectCompileResponse, 'result' | 'wire_schema_version'>

const SUPPORTED_WIRE_SCHEMA_VERSION = 1

interface ModuleIndex {
  path: string
  roles: Map<string, NamedSpecificationRef>
  actions: Map<string, NamedSpecificationRef>
  models: Map<string, ReadableModel>
  fields: Map<string, ReadableField>
  screens: Map<string, NamedSpecificationRef>
  outcomes: Map<string, ReadableOutcome>
  lookups: Map<string, Record<string, unknown>>
  producers: Map<string, Record<string, unknown>>
  derivations: Map<string, Record<string, unknown>>
}

const OPERATORS: Record<string, string> = {
  equal: '=',
  not_equal: '≠',
  greater_than: '>',
  greater_than_or_equal: '≥',
  less_than: '<',
  less_than_or_equal: '≤',
}

const EMPTY: Omit<ReadableSpecification, 'state' | 'identity' | 'documents' | 'context'> = {
  modelsState: 'uncompiled',
  screensState: 'uncompiled',
  outcomesState: 'uncompiled',
  diagnosticsState: 'uncompiled',
  models: [],
  screens: [],
  categories: [],
  diagnostics: [],
}

export function buildReadableSpecification(
  response: CompilationEnvelope | undefined,
  options: ReadableSpecificationOptions = {},
): ReadableSpecification {
  const documents = parseDocuments(options.documents)
  const context = parseContext(options.planningState)
  const identity = options.identity === undefined ? null : cloneIdentity(options.identity)
  if (response === undefined || response.result === null || response.result === undefined) {
    return { ...EMPTY, state: 'uncompiled', identity, documents, context }
  }
  if (response.wire_schema_version !== SUPPORTED_WIRE_SCHEMA_VERSION) {
    return {
      ...EMPTY,
      state: 'unsupported',
      identity,
      documents,
      context,
      modelsState: 'unsupported',
      screensState: 'unsupported',
      outcomesState: 'unsupported',
      diagnosticsState: 'unsupported',
    }
  }
  const result = record(response.result)
  if (result === null || !Array.isArray(result.files)) {
    return {
      ...EMPTY,
      state: 'unsupported',
      identity,
      documents,
      context,
      modelsState: 'unsupported',
      screensState: 'unsupported',
      outcomesState: 'unsupported',
      diagnosticsState: 'unsupported',
    }
  }

  const documentByPath = new Map(documents.map((document) => [document.path, document]))
  const models: ReadableModel[] = []
  const screens: ReadableScreen[] = []
  const categories: ReadableCategory[] = []
  const diagnostics: ReadableDiagnostic[] = []
  let modelsUnsupported = false
  let screensUnsupported = false
  let outcomesUnsupported = false
  let outcomeCount = 0

  for (const rawFile of records(result.files)) {
    const path = str(rawFile.path) ?? ''
    collectDiagnostics(rawFile, path, documentByPath, diagnostics)
    const moduleIr = record(rawFile.module)
    if (moduleIr === null) continue
    const index = buildIndex(moduleIr, path, documentByPath)
    outcomeCount += index.outcomes.size
    models.push(...index.models.values())
    if (hasUnsupportedArray(moduleIr, 'models')) modelsUnsupported = true
    if (hasUnsupportedArray(moduleIr, 'screens') || hasUnsupportedArray(moduleIr, 'screen_layouts')) screensUnsupported = true
    if (hasUnsupportedArray(moduleIr, 'action_outcomes')) outcomesUnsupported = true

    attachConstraints(moduleIr, index, documentByPath)
    attachProducerProvenance(moduleIr, index, documentByPath)
    collectOutcomeProvenance(index)
    categories.push(...collectCategories(moduleIr, index, documentByPath))
    screens.push(...collectScreens(moduleIr, index, documentByPath))
  }

  return {
    state: 'present',
    identity,
    documents,
    modelsState: modelsUnsupported ? 'unsupported' : models.length === 0 ? 'absent' : 'present',
    screensState: screensUnsupported ? 'unsupported' : screens.length === 0 ? 'absent' : 'present',
    outcomesState: outcomesUnsupported
      ? 'unsupported'
      : outcomeCount > 0
        ? 'present'
        : 'absent',
    diagnosticsState: diagnostics.length === 0 ? 'absent' : 'present',
    models,
    screens,
    categories,
    diagnostics,
    context,
  }
}

export function findReadableScreen(
  specification: ReadableSpecification,
  screenKey: string | undefined,
): ReadableScreen | null {
  if (screenKey === undefined) return null
  return specification.screens.find((screen) => screen.key === screenKey || screen.id === screenKey) ?? null
}

export function findReadableElement(
  screen: ReadableScreen | null,
  elementId?: string,
  elementPath?: string,
): ReadableElement | null {
  if (screen === null) return null
  const elements = flattenElements(screen.elements)
  if (elementId !== undefined) {
    const stable = elements.find((element) => element.id === elementId)
    if (stable !== undefined) return stable
  }
  if (elementPath !== undefined) return elements.find((element) => element.path === elementPath) ?? null
  return null
}

export function sourceExcerpt(source: SourceReference): string | null {
  if (source.document === null) return null
  if (source.span === null) return source.document.text
  const encoded = new TextEncoder().encode(source.document.text)
  const start = Math.max(0, Math.min(encoded.length, source.span.start))
  const end = Math.max(start, Math.min(encoded.length, source.span.end))
  return new TextDecoder().decode(encoded.slice(start, end))
}

function buildIndex(
  moduleIr: Record<string, unknown>,
  path: string,
  documents: ReadonlyMap<string, SpecificationDocument>,
): ModuleIndex {
  const named = (value: unknown): Map<string, NamedSpecificationRef> => {
    const result = new Map<string, NamedSpecificationRef>()
    for (const raw of records(value)) {
      const id = str(raw.id)
      if (id !== null) result.set(id, { id, name: str(raw.name) ?? id, resolved: str(raw.name) !== null })
    }
    return result
  }
  const roles = named(moduleIr.roles)
  const actions = named(moduleIr.actions)
  const screenRefs = named(moduleIr.screens)
  const enumNames = new Map<string, string[]>()
  for (const rawEnum of records(moduleIr.enums)) {
    const id = str(rawEnum.id)
    if (id !== null) enumNames.set(id, records(rawEnum.variants).map((variant) => str(variant.name)).filter(notNull))
  }
  const models = new Map<string, ReadableModel>()
  const fields = new Map<string, ReadableField>()
  for (const rawModel of records(moduleIr.models)) {
    const id = str(rawModel.id)
    if (id === null) continue
    const modelRef: NamedSpecificationRef = { id, name: str(rawModel.name) ?? id, resolved: str(rawModel.name) !== null }
    const model: ReadableModel = { ...modelRef, key: `${path}:${id}`, fields: [], source: source(path, rawModel.span, documents) }
    for (const rawField of records(rawModel.fields)) {
      const fieldId = str(rawField.id)
      if (fieldId === null) continue
      const valueType = record(rawField.value_type)
      const typeKind = str(valueType?.kind) ?? 'unknown'
      const definition = record(valueType?.definition)
      const enumId = str(definition?.id)
      const field: ReadableField = {
        id: fieldId,
        name: str(rawField.name) ?? fieldId,
        resolved: str(rawField.name) !== null,
        model: modelRef,
        required: rawField.required === true,
        typeKind,
        enumVariants: typeKind === 'enum' && enumId !== null ? (enumNames.get(enumId) ?? null) : null,
        constraints: [],
        provenance: [],
        source: source(path, rawField.span, documents),
      }
      fields.set(fieldId, field)
      model.fields.push(field)
    }
    models.set(id, model)
  }
  const lookups = indexRecords(moduleIr.lookup_results)
  const producers = new Map<string, Record<string, unknown>>()
  for (const production of records(moduleIr.conditional_productions)) {
    for (const producer of records(production.field_producers)) {
      const producerId = str(producer.id)
      if (producerId !== null) producers.set(producerId, producer)
    }
  }
  const derivations = new Map<string, Record<string, unknown>>()
  for (const raw of records(moduleIr.derivations)) {
    const target = str(raw.target_field_id)
    if (target !== null) derivations.set(target, raw)
  }
  const index: ModuleIndex = { path, roles, actions, models, fields, screens: screenRefs, outcomes: new Map(), lookups, producers, derivations }
  for (const rawOutcome of records(moduleIr.action_outcomes)) {
    const id = str(rawOutcome.id)
    const actionId = str(rawOutcome.action_id)
    if (id === null || actionId === null) continue
    const outcome: ReadableOutcome = {
      id,
      localId: str(rawOutcome.local_id) ?? id,
      kind: str(rawOutcome.kind) ?? 'unknown',
      action: resolve(index.actions, actionId),
      providedData: records(rawOutcome.provided_data).flatMap((raw) => {
        const modelId = str(raw.model_id)
        const fieldId = str(raw.field_id)
        const rawSource = record(raw.source)
        if (modelId === null || fieldId === null || rawSource === null) return []
        const sourceKind = str(rawSource.kind) ?? 'unknown'
        return [{
          model: resolveModels(index, modelId),
          field: resolveFields(index, fieldId),
          sourceKind,
          sourceLabel: outcomeDataSourceLabel(rawSource, index),
          verification: str(raw.verification) ?? 'unknown',
          prerequisiteFields: strings(raw.prerequisite_field_ids).map((fieldId) => resolveFields(index, fieldId)),
          source: source(path, raw.span, documents),
        }]
      }),
      recovery: parseRecovery(rawOutcome.recovery, index, documents),
      source: source(path, rawOutcome.span, documents),
    }
    index.outcomes.set(id, outcome)
  }
  return index
}

function collectScreens(
  moduleIr: Record<string, unknown>,
  index: ModuleIndex,
  documents: ReadonlyMap<string, SpecificationDocument>,
): ReadableScreen[] {
  const layouts = new Map(records(moduleIr.screen_layouts).flatMap((layout) => {
    const screenId = str(layout.screen_id)
    return screenId === null ? [] : [[screenId, layout] as const]
  }))
  const allPaths = records(moduleIr.screen_paths).flatMap((raw) => parsePath(raw, index, documents))
  const result: ReadableScreen[] = []
  for (const rawScreen of records(moduleIr.screens)) {
    const id = str(rawScreen.id)
    if (id === null) continue
    const screenRef = resolve(index.screens, id)
    const layout = layouts.get(id)
    const permissions = layout === undefined ? [] : records(layout.permissions).map((raw) => parsePermission(raw, index, documents))
    const screenPaths = allPaths.filter((path) => path.sourceScreenId === id)
    const elements = layout === undefined ? [] : records(layout.elements).map((raw, elementIndex) => parseElement(raw, `elements.${elementIndex}`, id, screenPaths, permissions, index, documents))
    result.push({
      ...screenRef,
      key: `${index.path}:${id}`,
      kind: str(layout?.kind),
      roles: layout === undefined ? [] : strings(layout.role_ids).map((roleId) => resolve(index.roles, roleId)),
      operations: records(rawScreen.operations).flatMap((operation) => parseOperation(operation, index, documents)),
      permissions,
      elements,
      paths: screenPaths,
      source: source(index.path, rawScreen.span, documents),
    })
  }
  return result
}

function parseElement(
  raw: Record<string, unknown>,
  elementPath: string,
  screenId: string,
  paths: ReadablePath[],
  permissions: ReadablePermission[],
  index: ModuleIndex,
  documents: ReadonlyMap<string, SpecificationDocument>,
): ReadableElement {
  const kind = str(raw.kind) ?? 'unknown'
  const id = str(raw.id)
  const actionId = str(raw.action_id)
  const modelId = str(raw.model_id)
  const fieldIds = kind === 'input'
    ? (str(raw.field_id) === null ? [] : [str(raw.field_id)!])
    : strings(raw.field_ids)
  const explicitModel = modelId === null ? null : resolveModels(index, modelId)
  const fields = fieldIds.map((fieldId) => index.fields.get(fieldId) ?? unresolvedField(fieldId, explicitModel ?? unresolved(''), index.path, documents))
  const childrenKey = kind === 'form' ? 'inputs' : 'children'
  const childRecords = records(raw[childrenKey])
  const action = actionId === null ? null : resolve(index.actions, actionId)
  const elementPaths = id === null ? [] : paths.filter((path) => path.sourceScreenId === screenId && path.sourceElementId === id)
  const outcomes = actionId === null ? [] : [...index.outcomes.values()].filter((outcome) => outcome.action.id === actionId)
  return {
    key: `${index.path}:${screenId}:${id ?? elementPath}`,
    path: elementPath,
    id,
    kind,
    recognized: ['header', 'section', 'heading', 'form', 'input', 'list', 'button', 'placeholder'].includes(kind),
    name: str(raw.name),
    text: str(raw.text),
    action,
    model: explicitModel ?? fields[0]?.model ?? null,
    fields,
    outcomes,
    paths: elementPaths,
    permissions: actionId === null ? [] : permissions.filter((permission) => permission.action.id === actionId),
    children: childRecords.map((child, childIndex) => parseElement(child, `${elementPath}.${childrenKey}.${childIndex}`, screenId, paths, permissions, index, documents)),
    source: source(index.path, raw.span, documents),
  }
}

function parsePath(
  raw: Record<string, unknown>,
  index: ModuleIndex,
  documents: ReadonlyMap<string, SpecificationDocument>,
): ReadablePath[] {
  const sourceScreenId = str(raw.source_screen_id)
  const sourceElementId = str(raw.source_element_id)
  if (sourceScreenId === null || sourceElementId === null) return []
  const targetId = str(raw.target_screen_id)
  const outcomeId = str(raw.outcome_id)
  const handler = record(raw.handler)
  return [{
    id: str(raw.id),
    sourceScreenId,
    sourceElementId,
    targetScreen: targetId === null ? null : resolve(index.screens, targetId),
    outcome: outcomeId === null ? null : (index.outcomes.get(outcomeId) ?? null),
    outcomeId,
    handler: handler === null ? null : { kind: str(handler.kind) ?? 'unknown', id: str(handler.id), content: str(handler.content) },
    label: str(raw.label),
    rawCondition: opaqueCondition(raw),
    source: source(index.path, raw.span, documents),
  }]
}

function parsePermission(
  raw: Record<string, unknown>,
  index: ModuleIndex,
  documents: ReadonlyMap<string, SpecificationDocument>,
): ReadablePermission {
  const fieldId = str(raw.field_id)
  return {
    role: resolve(index.roles, str(raw.role_id) ?? ''),
    action: resolve(index.actions, str(raw.action_id) ?? ''),
    model: resolveModels(index, str(raw.model_id) ?? ''),
    field: fieldId === null ? null : resolveFields(index, fieldId),
    verification: str(raw.verification) ?? 'unknown',
    rawCondition: opaqueCondition(raw),
    source: source(index.path, raw.span, documents),
  }
}

function parseOperation(
  raw: Record<string, unknown>,
  index: ModuleIndex,
  documents: ReadonlyMap<string, SpecificationDocument>,
): ReadableOperation[] {
  const kind = str(raw.kind)
  const modelId = str(raw.model_id)
  if (kind === null || modelId === null) return []
  return [{ kind, model: resolveModels(index, modelId), fields: strings(raw.field_ids).map((id) => resolveFields(index, id)), source: source(index.path, raw.span, documents) }]
}

function parseRecovery(
  value: unknown,
  index: ModuleIndex,
  documents: ReadonlyMap<string, SpecificationDocument>,
): ReadableRecovery | null {
  const raw = record(value)
  if (raw === null) return null
  const screenId = str(raw.screen_id)
  const actionId = str(raw.action_id)
  return {
    kind: str(raw.kind) ?? 'unknown',
    screen: screenId === null ? null : resolve(index.screens, screenId),
    elementId: str(raw.element_id),
    action: actionId === null ? null : resolve(index.actions, actionId),
    pathId: str(raw.path_id),
    source: source(index.path, raw.span, documents),
  }
}

function attachConstraints(
  moduleIr: Record<string, unknown>,
  index: ModuleIndex,
  documents: ReadonlyMap<string, SpecificationDocument>,
): void {
  for (const raw of records(moduleIr.constraints)) {
    const id = str(raw.id)
    if (id === null) continue
    const left = operand(raw.left, index)
    const right = operand(raw.right, index)
    const operator = str(raw.operator)
    if (left === null || right === null || operator === null) continue
    const constraint: ReadableConstraint = { id, left: left.label, operator: OPERATORS[operator] ?? operator, right: right.label, source: source(index.path, raw.span, documents) }
    for (const fieldId of [left.fieldId, right.fieldId]) {
      if (fieldId === null) continue
      const field = index.fields.get(fieldId)
      if (field !== undefined && !field.constraints.some((item) => item.id === id)) field.constraints.push(constraint)
    }
  }
}

function attachProducerProvenance(
  moduleIr: Record<string, unknown>,
  index: ModuleIndex,
  documents: ReadonlyMap<string, SpecificationDocument>,
): void {
  for (const production of records(moduleIr.conditional_productions)) for (const raw of records(production.field_producers)) {
    const id = str(raw.id)
    const fieldId = str(raw.output_field_id)
    const rawSource = record(raw.source)
    if (id === null || fieldId === null || rawSource === null) continue
    const field = index.fields.get(fieldId)
    if (field === undefined) continue
    field.provenance.push({
      id,
      kind: str(rawSource.kind) ?? 'unknown',
      sourceLabel: producerSourceLabel(rawSource, index),
      phase: str(raw.phase),
      verification: null,
      rawCondition: opaqueValue(raw.condition),
      source: source(index.path, raw.span, documents),
    })
  }
}

function collectOutcomeProvenance(index: ModuleIndex): void {
  for (const outcome of index.outcomes.values()) {
    for (const data of outcome.providedData) {
      const field = index.fields.get(data.field.id)
      if (field === undefined) continue
      field.provenance.push({
        id: `${outcome.id}:${data.field.id}`,
        kind: `outcome_${data.sourceKind}`,
        sourceLabel: `${outcome.localId} · ${data.sourceLabel}`,
        phase: null,
        verification: data.verification,
        rawCondition: null,
        source: data.source,
      })
    }
  }
}

function collectCategories(
  moduleIr: Record<string, unknown>,
  index: ModuleIndex,
  documents: ReadonlyMap<string, SpecificationDocument>,
): ReadableCategory[] {
  const screenIds = new Map<string, string[]>()
  for (const assignment of records(moduleIr.screen_categories)) {
    const categoryId = str(assignment.category_id)
    const screenId = str(assignment.screen_id)
    if (categoryId !== null && screenId !== null) screenIds.set(categoryId, [...(screenIds.get(categoryId) ?? []), screenId])
  }
  return records(moduleIr.information_architecture).flatMap((raw) => {
    const id = str(raw.id)
    if (id === null) return []
    return [{ id, name: str(raw.name) ?? id, resolved: str(raw.name) !== null, key: `${index.path}:${id}`, parentId: str(raw.parent_id), screenIds: screenIds.get(id) ?? [], source: source(index.path, raw.span, documents) }]
  })
}

function collectDiagnostics(
  rawFile: Record<string, unknown>,
  path: string,
  documents: ReadonlyMap<string, SpecificationDocument>,
  target: ReadableDiagnostic[],
): void {
  for (const raw of records(rawFile.diagnostics)) {
    const ruleId = str(raw.rule_id)
    const severity = str(raw.severity)
    const messageKey = str(raw.message_key)
    if (ruleId === null || severity === null || messageKey === null) continue
    const args = record(raw.arguments)
    target.push({
      path,
      ruleId,
      severity,
      messageKey,
      message: str(raw.message),
      arguments: Object.fromEntries(Object.entries(args ?? {}).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : [])),
      source: source(path, raw.span, documents),
    })
  }
}

function parseDocuments(value: readonly unknown[] | undefined): SpecificationDocument[] {
  if (value === undefined) return []
  return value.flatMap((entry) => {
    const raw = record(entry)
    const path = str(raw?.path)
    const text = str(raw?.text)
    if (path === null || text === null) return []
    return [{ path, title: str(raw?.title), text }]
  })
}

function parseContext(value: unknown): ReadableContextItem[] {
  const state = record(value)
  if (state === null) return []
  const deferred = records(state.decisions).filter((item) => item.status === 'deferred').map((item, index): ReadableContextItem => ({ id: str(item.id) ?? `deferred-${index}`, kind: 'deferred', title: str(item.title) ?? '제목 없음', content: str(item.rationale) ?? str(item.content) }))
  const proposals = records(state.proposals).flatMap((item, index): ReadableContextItem[] => {
    const kind = str(item.kind)
    if (kind !== 'question' && kind !== 'unsupported') return []
    return [{ id: str(item.id) ?? `${kind}-${index}`, kind, title: str(item.title) ?? str(item.content) ?? '제목 없음', content: str(item.content) }]
  })
  return [...deferred, ...proposals]
}

function source(
  path: string,
  spanValue: unknown,
  documents: ReadonlyMap<string, SpecificationDocument>,
): SourceReference {
  const rawSpan = record(spanValue)
  const start = num(rawSpan?.start)
  const end = num(rawSpan?.end)
  const document = documents.get(path)
  return { path, span: start === null || end === null ? null : { start, end }, document: document === undefined ? null : { ...document } }
}

function outcomeDataSourceLabel(raw: Record<string, unknown>, index: ModuleIndex): string {
  const kind = str(raw.kind) ?? 'unknown'
  const definition = record(raw.definition) ?? raw
  if (kind === 'lookup') {
    const resultId = str(definition.result_id) ?? 'unknown'
    const lookup = index.lookups.get(resultId)
    const inputId = str(lookup?.input_id)
    return inputId === null ? resultId : `${resultId} (${inputId})`
  }
  if (kind === 'derivation') return resolveFields(index, str(definition.target_field_id) ?? '').name
  if (kind === 'producer') {
    const producerId = str(definition.producer_id) ?? 'unknown'
    const producer = index.producers.get(producerId)
    return producer === undefined ? producerId : `${producerId} (${producerSourceLabel(record(producer.source) ?? {}, index)})`
  }
  return opaqueValue(raw) ?? kind
}

function producerSourceLabel(raw: Record<string, unknown>, index: ModuleIndex): string {
  const kind = str(raw.kind) ?? 'unknown'
  const definition = record(raw.definition) ?? raw
  if (kind === 'action_input' || kind === 'event_input') return str(definition.input_id) ?? kind
  if (kind === 'input_field' || kind === 'event_input_field') {
    const input = str(definition.input_id) ?? 'unknown'
    const field = resolveFields(index, str(definition.field_id) ?? '').name
    return `${input}.${field}`
  }
  if (kind === 'constant') return literalLabel(definition.value)
  if (kind === 'template') return 'template'
  return opaqueValue(raw) ?? kind
}

function literalLabel(value: unknown): string {
  const raw = record(value)
  const representation = record(raw?.representation)
  return str(representation?.value) ?? str(raw?.value) ?? opaqueValue(value) ?? 'constant'
}

function operand(value: unknown, index: ModuleIndex): { label: string; fieldId: string | null } | null {
  const raw = record(value)
  if (raw === null) return null
  const kind = str(raw.kind)
  if (kind === 'field') {
    const fieldId = str(raw.value)
    return fieldId === null ? null : { label: resolveFields(index, fieldId).name, fieldId }
  }
  if (kind === 'constant') return { label: literalLabel(raw.value), fieldId: null }
  return { label: opaqueValue(raw) ?? 'unknown', fieldId: null }
}

function resolve(index: ReadonlyMap<string, NamedSpecificationRef>, id: string): NamedSpecificationRef {
  return index.get(id) ?? unresolved(id)
}

function resolveModels(index: ModuleIndex, id: string): NamedSpecificationRef {
  const model = index.models.get(id)
  return model === undefined ? unresolved(id) : { id: model.id, name: model.name, resolved: model.resolved }
}

function resolveFields(index: ModuleIndex, id: string): NamedSpecificationRef {
  const field = index.fields.get(id)
  return field === undefined ? unresolved(id) : { id: field.id, name: field.name, resolved: field.resolved }
}

function unresolved(id: string): NamedSpecificationRef {
  return { id, name: id === '' ? '알 수 없음' : id, resolved: false }
}

function unresolvedField(
  id: string,
  model: NamedSpecificationRef,
  path: string,
  documents: ReadonlyMap<string, SpecificationDocument>,
): ReadableField {
  return { ...unresolved(id), model, required: false, typeKind: 'unknown', enumVariants: null, constraints: [], provenance: [], source: source(path, null, documents) }
}

function indexRecords(value: unknown): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>()
  for (const raw of records(value)) {
    const id = str(raw.id)
    if (id !== null) result.set(id, raw)
  }
  return result
}

function opaqueCondition(raw: Record<string, unknown>): string | null {
  return opaqueValue(raw.condition ?? raw.conditions)
}

function opaqueValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}

function cloneIdentity(value: SpecificationIdentity | null): SpecificationIdentity | null {
  return value === null ? null : { ...value }
}

function hasUnsupportedArray(raw: Record<string, unknown>, key: string): boolean {
  return raw[key] !== null && raw[key] !== undefined && !Array.isArray(raw[key])
}

function flattenElements(elements: readonly ReadableElement[]): ReadableElement[] {
  return elements.flatMap((element) => [element, ...flattenElements(element.children)])
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => record(item) !== null) : []
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function str(value: unknown): string | null { return typeof value === 'string' ? value : null }
function num(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function notNull<T>(value: T | null): value is T { return value !== null }
