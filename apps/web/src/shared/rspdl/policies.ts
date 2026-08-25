import type { ProjectCompileResponse } from '@dahaze/api-client'

/**
 * 프로젝트 컴파일 결과에서 **정책과 그 주변**을 꺼낸다.
 *
 * `analysis.ts` 와 같은 규칙 위에 있다. `result` 는 RSPDL SDK 가 준 원본이고 dahaze 는 그
 * 모양을 소유하지 않으므로 (ADR-0003), 좁히는 일을 여기 한 곳에서만 한다. 모르는 모양을
 * 만나면 던지지 않고 그 항목만 건너뛴다 — 컴파일러가 새 필드를 넣었다는 이유로 화면이
 * 죽으면 정책을 못 보여주는 것보다 나쁘다.
 *
 * **여기서 판정하지 않는다.** 같은 네 축에 allow 와 deny 가 함께 있어도 "충돌" 이라 부르지
 * 않고, 정책이 없는 필드를 "누락" 이라 부르지 않는다. 그 판정은 컴파일러의 몫이고, 컴파일러가
 * 진단을 주지 않았다면 dahaze 도 주지 않는다. 이 모듈이 하는 일은 흩어져 있는 사실을 한 줄
 * 옆에 모아 두는 것뿐이다 — 묶고 정렬하는 것은 표시이지 해석이 아니다.
 */

export type PolicyEffect = 'allow' | 'deny'

/** id 와 사람이 읽는 이름. 컴파일러가 둘 다 준다. */
export interface NamedRef {
  id: string
  name: string
}

export interface FieldRef extends NamedRef {
  required: boolean
  /** `value_type.kind` 그대로. `string` · `integer` · `enum` … */
  typeKind: string
  /** enum 필드가 가질 수 있는 값의 이름. enum 이 아니면 `null`. */
  enumVariants: string[] | null
}

/** 표 한 줄. 정책의 네 축과, 그 정책이 어디서 왔는지. */
export interface PolicyRow {
  id: string
  effect: PolicyEffect
  role: NamedRef
  action: NamedRef
  model: NamedRef
  field: FieldRef
  /** 소스 경로. 응답의 `documents` 로 문서를 되짚는다. */
  path: string
}

/** 제약 하나를 조각으로 분해한 것. 문장을 지어내지 않고 컴파일러가 준 세 조각을 그대로 둔다. */
export interface ConstraintFacet {
  id: string
  left: string
  /** `>` `≥` 처럼 아는 연산자는 기호로, 모르는 것은 컴파일러가 준 이름 그대로. */
  operator: string
  right: string
}

/** 어떤 화면이 이 필드를 어떻게 건드리는지. */
export interface ScreenTouch {
  screen: NamedRef
  /** `create` · `read` · `update` · `delete` · `input` */
  kind: string
}

/** 필드 하나를 중심으로 모은 것. 정책 + 그 정책이 걸리는 맥락. */
export interface FieldGroup {
  key: string
  field: FieldRef
  model: NamedRef
  path: string
  policies: PolicyRow[]
  constraints: ConstraintFacet[]
  screens: ScreenTouch[]
  /** 이 필드가 계산으로 만들어진다면, 그 계산의 재료가 되는 필드 이름들. */
  derivedFrom: string[] | null
  /** 이 필드가 바뀔 때 다시 계산되는 필드 이름들. */
  recalculates: string[]
}

export interface CollectedPolicies {
  rows: PolicyRow[]
  fields: FieldGroup[]
  /** `result` 가 우리가 아는 모양이었는지. `false` 면 "정책 0건" 이 아니라 "모른다" 는 뜻이다. */
  recognized: boolean
  /** 컴파일한 적이 있는지 (문서 0개면 `false`). 진단 0건과 구분해야 한다. */
  compiled: boolean
}

/* ------------------------------------------------------------------ 좁히기 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/**
 * 아는 연산자는 기호로 바꾼다. 모르는 것은 **컴파일러가 준 이름을 그대로 보여준다** —
 * 빈칸으로 두면 제약이 없는 것처럼 읽히고, 그건 사실이 아니다.
 */
const OPERATORS: Record<string, string> = {
  equal: '=',
  not_equal: '≠',
  greater_than: '>',
  greater_than_or_equal: '≥',
  less_than: '<',
  less_than_or_equal: '≤',
}

interface ModuleIndex {
  path: string
  roles: Map<string, NamedRef>
  actions: Map<string, NamedRef>
  models: Map<string, NamedRef>
  fields: Map<string, FieldRef>
  /** 필드 id → 그 필드가 속한 모델 */
  fieldOwner: Map<string, NamedRef>
}

function indexEnums(moduleIr: Record<string, unknown>): Map<string, string[]> {
  const byEnumId = new Map<string, string[]>()
  for (const entry of records(moduleIr.enums)) {
    const id = str(entry.id)
    if (id === null) continue
    const names: string[] = []
    for (const variant of records(entry.variants)) {
      const name = str(variant.name)
      if (name !== null) names.push(name)
    }
    byEnumId.set(id, names)
  }
  return byEnumId
}

function toFieldRef(
  raw: Record<string, unknown>,
  enums: Map<string, string[]>,
): FieldRef | null {
  const id = str(raw.id)
  const name = str(raw.name)
  if (id === null || name === null) return null

  const valueType = isRecord(raw.value_type) ? raw.value_type : null
  const typeKind = valueType === null ? 'unknown' : (str(valueType.kind) ?? 'unknown')

  let enumVariants: string[] | null = null
  if (typeKind === 'enum' && valueType !== null && isRecord(valueType.definition)) {
    // 값의 **이름** 은 `module.enums` 가 갖고 있다. 필드의 `definition` 은 id 만 준다.
    const definitionId = str(valueType.definition.id)
    enumVariants = definitionId === null ? null : (enums.get(definitionId) ?? null)
  }

  return { id, name, required: raw.required === true, typeKind, enumVariants }
}

function indexModule(
  moduleIr: Record<string, unknown>,
  path: string,
): ModuleIndex | null {
  // 모듈의 id 와 이름이 없으면 우리가 아는 모양이 아니다. 그 파일은 통째로 건너뛴다.
  if (str(moduleIr.id) === null || str(moduleIr.name) === null) return null

  const enums = indexEnums(moduleIr)
  const index: ModuleIndex = {
    path,
    roles: new Map(),
    actions: new Map(),
    models: new Map(),
    fields: new Map(),
    fieldOwner: new Map(),
  }

  for (const key of ['roles', 'actions'] as const) {
    for (const raw of records(moduleIr[key])) {
      const id = str(raw.id)
      const name = str(raw.name)
      if (id === null || name === null) continue
      index[key].set(id, { id, name })
    }
  }

  for (const raw of records(moduleIr.models)) {
    const id = str(raw.id)
    const name = str(raw.name)
    if (id === null || name === null) continue
    const model: NamedRef = { id, name }
    index.models.set(id, model)
    for (const rawField of records(raw.fields)) {
      const field = toFieldRef(rawField, enums)
      if (field === null) continue
      index.fields.set(field.id, field)
      index.fieldOwner.set(field.id, model)
    }
  }

  return index
}

/** 제약의 한쪽 항을 사람이 읽는 문자열로. 필드는 이름으로, 상수는 표기 그대로. */
function operandLabel(operand: unknown, index: ModuleIndex): string | null {
  if (!isRecord(operand)) return null
  const kind = str(operand.kind)

  if (kind === 'field') {
    const fieldId = str(operand.value)
    if (fieldId === null) return null
    return index.fields.get(fieldId)?.name ?? fieldId
  }

  if (kind === 'constant') {
    const value = isRecord(operand.value) ? operand.value : null
    const representation =
      value !== null && isRecord(value.representation) ? value.representation : null
    // `representation.value` 는 정수도 문자열로 온다. 숫자로 되돌리지 않는다 — 문자열로
    // 준 데는 정밀도를 잃지 않으려는 이유가 있다.
    return representation === null ? null : str(representation.value)
  }

  return null
}

/* -------------------------------------------------------------------- 수집 */

const EMPTY: CollectedPolicies = {
  rows: [],
  fields: [],
  recognized: true,
  compiled: true,
}

export function collectPolicies(
  response: ProjectCompileResponse | undefined,
): CollectedPolicies {
  if (response === undefined) return EMPTY
  // 문서가 없으면 서버가 컴파일러를 부르지 않는다. "정책 0건" 과 구분한다.
  if (response.result === null || response.result === undefined) {
    return { ...EMPTY, compiled: false }
  }

  const files = response.result.files
  if (!Array.isArray(files)) return { ...EMPTY, recognized: false }

  const rows: PolicyRow[] = []
  const groups = new Map<string, FieldGroup>()

  for (const file of files) {
    if (!isRecord(file)) continue
    const path = str(file.path) ?? ''
    // 진단이 있는 파일은 `module` 이 `null` 이다. 컴파일되지 않은 문서에서 정책을
    // 지어내지 않는다 — 그 문서가 왜 비어 보이는지는 진단이 말한다.
    const moduleIr = isRecord(file.module) ? file.module : null
    if (moduleIr === null) continue

    const index = indexModule(moduleIr, path)
    if (index === null) continue

    /*
      맥락은 **정책이 걸린 필드에 대해서만** 모은다. 정책 없는 필드까지 넣으면 표가 모델
      전체의 목록이 되고, 그건 정책 검토가 아니라 스키마 뷰어다.
    */
    const ensureGroup = (field: FieldRef, model: NamedRef): FieldGroup => {
      const existing = groups.get(field.id)
      if (existing !== undefined) return existing
      const created: FieldGroup = {
        key: field.id,
        field,
        model,
        path,
        policies: [],
        constraints: [],
        screens: [],
        derivedFrom: null,
        recalculates: [],
      }
      groups.set(field.id, created)
      return created
    }

    for (const raw of records(moduleIr.policies)) {
      const id = str(raw.id)
      const effect = str(raw.effect)
      const fieldId = str(raw.field_id)
      if (id === null || fieldId === null) continue
      if (effect !== 'allow' && effect !== 'deny') continue

      const roleId = str(raw.role_id)
      const modelId = str(raw.model_id)
      const actionId = str(raw.action_id)

      // 이름을 못 찾으면 id 를 그대로 보여준다. 줄을 버리면 정책이 사라진 것처럼 보인다.
      const named = (ref: NamedRef | undefined, rawId: string | null): NamedRef =>
        ref ?? { id: rawId ?? '', name: rawId ?? '—' }

      const field: FieldRef = index.fields.get(fieldId) ?? {
        id: fieldId,
        name: fieldId,
        required: false,
        typeKind: 'unknown',
        enumVariants: null,
      }
      const model = named(
        (modelId === null ? undefined : index.models.get(modelId)) ??
          index.fieldOwner.get(fieldId),
        modelId,
      )

      const row: PolicyRow = {
        id,
        effect,
        role: named(roleId === null ? undefined : index.roles.get(roleId), roleId),
        action: named(
          actionId === null ? undefined : index.actions.get(actionId),
          actionId,
        ),
        model,
        field,
        path,
      }
      rows.push(row)
      ensureGroup(field, model).policies.push(row)
    }

    /* --- 맥락: 제약 --- */
    for (const raw of records(moduleIr.constraints)) {
      const id = str(raw.id)
      const operator = str(raw.operator)
      if (id === null || operator === null) continue
      const left = operandLabel(raw.left, index)
      const right = operandLabel(raw.right, index)
      if (left === null || right === null) continue

      const facet: ConstraintFacet = {
        id,
        left,
        operator: OPERATORS[operator] ?? operator,
        right,
      }
      // 양쪽 항 모두에 붙인다. `신청자 ≠ 승인자` 는 두 필드 모두의 사실이다.
      for (const operand of [raw.left, raw.right]) {
        if (!isRecord(operand) || str(operand.kind) !== 'field') continue
        const fieldId = str(operand.value)
        if (fieldId === null) continue
        const group = groups.get(fieldId)
        if (group === undefined) continue
        if (!group.constraints.some((entry) => entry.id === facet.id)) {
          group.constraints.push(facet)
        }
      }
    }

    /* --- 맥락: 화면 --- */
    for (const raw of records(moduleIr.screens)) {
      const screenId = str(raw.id)
      const screenName = str(raw.name)
      if (screenId === null || screenName === null) continue
      const screen: NamedRef = { id: screenId, name: screenName }

      for (const operation of records(raw.operations)) {
        const kind = str(operation.kind)
        if (kind === null) continue
        const explicit = strings(operation.field_ids)
        // 필드를 지목하지 않는 조작(`생성`·`삭제`)은 그 모델의 필드 전부에 해당한다.
        const fieldIds =
          explicit.length > 0
            ? explicit
            : [...groups.values()]
                .filter((group) => group.model.id === str(operation.model_id))
                .map((group) => group.field.id)

        for (const fieldId of fieldIds) {
          const group = groups.get(fieldId)
          if (group === undefined) continue
          const already = group.screens.some(
            (touch) => touch.screen.id === screenId && touch.kind === kind,
          )
          if (!already) group.screens.push({ screen, kind })
        }
      }
    }

    /* --- 맥락: 계산 --- */
    for (const raw of records(moduleIr.derivations)) {
      const targetId = str(raw.target_field_id)
      if (targetId === null) continue
      const targetName = index.fields.get(targetId)?.name ?? targetId

      const expression = isRecord(raw.expression) ? raw.expression : null
      const sourceId = expression === null ? null : str(expression.source_field_id)
      const target = groups.get(targetId)
      if (target !== undefined && sourceId !== null) {
        const sourceName = index.fields.get(sourceId)?.name ?? sourceId
        target.derivedFrom = [...(target.derivedFrom ?? []), sourceName]
      }

      for (const triggerId of strings(raw.recalculate_when_changed_field_ids)) {
        const group = groups.get(triggerId)
        if (group === undefined) continue
        if (!group.recalculates.includes(targetName)) {
          group.recalculates.push(targetName)
        }
      }
    }
  }

  return {
    rows,
    fields: [...groups.values()].sort(
      (a, b) =>
        a.model.name.localeCompare(b.model.name, 'ko') ||
        a.field.name.localeCompare(b.field.name, 'ko'),
    ),
    recognized: true,
    compiled: true,
  }
}

/**
 * 같은 네 축을 공유하는 정책들의 키. 표에서 나란히 놓기 위한 것이다.
 *
 * 이 키가 같은 줄이 둘 이상이면 사람이 보고 판단한다. dahaze 는 그 사실에 이름을 붙이지
 * 않는다 — 컴파일러가 진단을 주지 않은 것에 우리가 심각도를 얹으면 컴파일러 노릇을 하는
 * 것이다 (CLAUDE.md).
 */
export function axisKey(row: PolicyRow): string {
  return [row.role.id, row.model.id, row.field.id, row.action.id].join(' ')
}

/**
 * 같은 네 축의 정책을 프로젝트 전체에서 찾기 위한 색인.
 *
 * 화면에 적용된 필터로 이 색인을 만들면 `효과=금지` 를 고르는 순간 같은 조합의 허용 정책이
 * 사라져, 가장 비교해야 할 정보가 필터 때문에 감춰진다. 호출자는 필터링 전 정책을 넘기고
 * 표에는 필터링된 행만 그린다.
 */
export function indexPoliciesByAxes(
  rows: readonly PolicyRow[],
): Map<string, PolicyRow[]> {
  const indexed = new Map<string, PolicyRow[]>()
  for (const row of rows) {
    const key = axisKey(row)
    const peers = indexed.get(key)
    if (peers === undefined) {
      indexed.set(key, [row])
    } else {
      peers.push(row)
    }
  }
  return indexed
}

/** 화면 조작의 한국어 이름. 컴파일러가 준 `kind` 를 표시용으로 옮긴 것뿐이다. */
export const SCREEN_OPERATION_LABELS: Record<string, string> = {
  create: '생성',
  read: '조회',
  update: '수정',
  delete: '삭제',
  input: '입력',
}

/** 필드 타입의 한국어 이름. RSPDL 소스에서 쓰는 낱말과 같게 둔다. */
export const TYPE_LABELS: Record<string, string> = {
  string: '문자열',
  integer: '정수',
  boolean: '참거짓',
  enum: '열거',
}

/* -------------------------------------------------------- 거르기 · 묶기 */

/**
 * 정책을 가로지르는 축. 필터도 묶기도 같은 축 위에서 움직인다.
 *
 * `effect` 와 `path` 를 네 축과 나란히 두는 이유: 사람이 "금지만 보여 줘" 나 "이 문서
 * 것만" 을 물을 때, 그것이 역할로 거르는 것과 다른 종류의 행동이라고 느끼지 않는다.
 */
export type PolicyAxis = 'role' | 'model' | 'field' | 'action' | 'effect' | 'path'

/** 축마다 고른 값들. 빈 배열은 "이 축으로는 거르지 않는다" 는 뜻이다. */
export type PolicySelection = Partial<Record<PolicyAxis, readonly string[]>>

/** 줄에서 축의 값을 꺼낸다. 거르기와 묶기가 같은 값을 보게 하려면 한 곳에서 꺼내야 한다. */
export function axisValue(row: PolicyRow, axis: PolicyAxis): string {
  switch (axis) {
    case 'effect':
      return row.effect
    case 'path':
      return row.path
    default:
      return row[axis].id
  }
}

/** 화면에 보이는 이름. id 는 사람이 읽는 값이 아니다. */
export function axisLabel(row: PolicyRow, axis: PolicyAxis): string {
  switch (axis) {
    case 'effect':
      return row.effect === 'allow' ? '허용' : '금지'
    case 'path':
      return row.path
    default:
      return row[axis].name
  }
}

/**
 * 고른 값만 남긴다. 축끼리는 **AND**, 한 축 안의 값끼리는 **OR** 다.
 *
 * `회계 관리자 또는 감사자` 이면서 `비용 신청` 인 정책 — 이것이 사람이 필터를 여러 개 켤 때
 * 기대하는 뜻이다. 축 안에서까지 AND 로 묶으면 값을 두 개 고르는 순간 결과가 늘 비어 버린다.
 */
export function filterPolicies(
  rows: readonly PolicyRow[],
  selection: PolicySelection,
): PolicyRow[] {
  const active = (Object.entries(selection) as [PolicyAxis, readonly string[]][])
    .filter(([, values]) => values.length > 0)
  if (active.length === 0) return [...rows]

  return rows.filter((row) =>
    active.every(([axis, values]) => values.includes(axisValue(row, axis))),
  )
}

/** 한 축의 고를 수 있는 값들. 지금 있는 정책에서만 뽑으므로 빈 선택지가 생기지 않는다. */
export function axisOptions(
  rows: readonly PolicyRow[],
  axis: PolicyAxis,
): { value: string; label: string; count: number }[] {
  const found = new Map<string, { value: string; label: string; count: number }>()
  for (const row of rows) {
    const value = axisValue(row, axis)
    const existing = found.get(value)
    if (existing === undefined) {
      found.set(value, { value, label: axisLabel(row, axis), count: 1 })
    } else {
      existing.count += 1
    }
  }
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'))
}

export interface PolicyGroup {
  key: string
  label: string
  rows: PolicyRow[]
}

/**
 * 고른 축으로 묶는다. 묶음 순서도 묶음 안의 순서도 이름순으로 고정한다.
 *
 * 정렬을 고정하는 이유는 표를 두 번 봤을 때 같은 자리에 같은 것이 있어야 하기 때문이다.
 * 개수순으로 정렬하면 정책 하나를 고칠 때마다 묶음이 자리를 바꾼다.
 */
export function groupPolicies(
  rows: readonly PolicyRow[],
  axis: PolicyAxis,
): PolicyGroup[] {
  const groups = new Map<string, PolicyGroup>()
  for (const row of rows) {
    const key = axisValue(row, axis)
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, { key, label: axisLabel(row, axis), rows: [row] })
    } else {
      existing.rows.push(row)
    }
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'))
}

/**
 * 걸러진 줄에 맞춰 필드 묶음도 줄인다.
 *
 * 필드 중심 뷰가 매트릭스와 **같은 것을 보여야** 한다. 필터를 켠 채 탭만 옮겼는데 사라졌던
 * 정책이 다시 나타나면, 사용자는 방금 무엇을 걸렀는지 알 수 없게 된다.
 *
 * 정책이 하나도 남지 않은 필드는 묶음째 뺀다 — 맥락만 남은 카드는 정책 검토가 아니다.
 */
export function filterFieldGroups(
  groups: readonly FieldGroup[],
  visible: readonly PolicyRow[],
): FieldGroup[] {
  const kept = new Set(visible.map((row) => row.id))
  return groups
    .map((group) => ({
      ...group,
      policies: group.policies.filter((policy) => kept.has(policy.id)),
    }))
    .filter((group) => group.policies.length > 0)
}
