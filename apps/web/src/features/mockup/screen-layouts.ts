import type { ProjectCompileResponse } from '@dahaze/api-client'

/**
 * 컴파일러가 준 화면 레이아웃을 화면이 그릴 수 있는 최소 단위로만 좁힌다.
 *
 * 이 모듈은 새 의미를 만들지 않는다. `screen_layouts` 의 요소 트리를 그대로 옮기되,
 * `입력`·`목록` 이 id 로만 들고 있는 필드를 같은 응답의 `module.models` 와 조인해 이름과
 * 값 타입을 붙인다. 그 조인이 여기 한 곳에만 있어야 컴포넌트마다 IR 을 다시 해석하지 않는다
 * (ADR-0003 — `result` 의 모양은 컴파일러가 소유한다).
 *
 * **모르는 것을 지우지 않는다.** 어휘 밖의 요소도, 데이터가 빠진 요소도 표시용 자리로 남겨
 * 화면이 "여기 뭔가 있는데 우리가 모른다" 고 말할 수 있게 한다. 조용히 떨어뜨리면 렌더러가
 * 문서에 대해 거짓말을 하게 된다.
 */

/** 필드의 값 타입이 정하는 입력칸 모양. 모르는 타입은 글상자로 내려앉는다. */
export type ControlKind =
  | 'text'
  | 'number'
  | 'date'
  | 'time'
  | 'datetime'
  | 'select'
  | 'checkbox'

export interface MockupField {
  id: string
  /** 선언된 이름. 모델에서 찾지 못하면 id 를 대신 쓰고 `resolved` 가 거짓이 된다. */
  name: string
  required: boolean
  control: ControlKind
  /** `select` 일 때 고를 수 있는 값. 선언 순서를 지킨다. 그 밖에는 `null`. */
  options: string[] | null
  /** 이 필드를 `module.models` 에서 찾았는지. */
  resolved: boolean
}

/** 알아보지 못한 요소가 남는 이유. 둘을 구분해야 화면이 정확히 말할 수 있다. */
export type UnrecognizedReason = 'unknown-kind' | 'missing-data'

export type MockupElement =
  | { kind: 'header'; id: string | null; children: MockupElement[] }
  | { kind: 'section'; id: string | null; children: MockupElement[] }
  | { kind: 'heading'; id: string | null; text: string }
  | { kind: 'form'; id: string | null; inputs: MockupElement[] }
  | { kind: 'input'; id: string | null; field: MockupField }
  | { kind: 'list'; id: string | null; modelId: string; modelName: string; fields: MockupField[] }
  | { kind: 'button'; id: string | null; name: string; actionId: string | null }
  /** IR 의 키 이름을 그대로 따른다. 자리표시자는 `name` 이 아니라 `text` 를 든다. */
  | { kind: 'placeholder'; id: string | null; text: string }
  | { kind: 'unrecognized'; id: string | null; rawKind: string; reason: UnrecognizedReason }

export interface ScreenMockup {
  /** 같은 id 가 다른 문서에 있어도 합쳐지지 않도록 path 를 포함한다. */
  key: string
  screenId: string
  /** 화면의 선언된 이름. `module.screens` 에서 온다. 찾지 못하면 `null`. */
  screenName: string | null
  path: string
  /** `page` · `popup` · `tab` · `link`. 적지 않았으면 `null` 로 남긴다 — 기본값을 채우지 않는다. */
  kind: string | null
  elements: MockupElement[]
}

export interface CollectedMockups {
  screens: ScreenMockup[]
  /** 화면이 현재 SDK wire shape 를 인식하는지. `false` 는 "레이아웃 없음" 이 아니라 "모른다". */
  recognized: boolean
  /** 문서가 있어 실제 컴파일이 실행됐는지. */
  compiled: boolean
}

const EMPTY: CollectedMockups = { screens: [], recognized: true, compiled: true }

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
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/**
 * 값 타입 이름을 입력칸 모양으로 옮긴다.
 *
 * RSPDL 의 스칼라는 앞으로도 늘어난다. 모르는 이름을 만나면 던지지 않고 글상자로 내려앉는다 —
 * 컴파일러가 타입을 하나 더하는 날 렌더러가 죽는 것보다, 칸 모양이 한 칸 덜 정확한 편이 낫다.
 */
function controlFor(typeKind: string | null): ControlKind {
  switch (typeKind) {
    case 'integer':
    case 'decimal':
    case 'currency':
    case 'percentage':
    case 'quantity':
    case 'latitude':
    case 'longitude':
      return 'number'
    case 'date':
      return 'date'
    case 'time':
      return 'time'
    case 'date_time':
    case 'zoned_date_time':
      return 'datetime'
    case 'enum':
      return 'select'
    case 'boolean':
      return 'checkbox'
    default:
      return 'text'
  }
}

interface FieldFacts {
  name: string
  required: boolean
  control: ControlKind
  options: string[] | null
}

/**
 * 한 문서의 모델·enum 을 필드 id 로 찾을 수 있게 펼친다.
 *
 * enum 의 값은 `module.enums` 에서 가져온다. `value_type.definition.variants` 에도 목록이
 * 있지만 그쪽은 **id 로 정렬돼 있고** 표시 이름이 아니다. 선언 순서가 곧 읽는 순서이므로
 * 선언 순서를 지키는 쪽을 쓴다.
 */
function fieldFacts(moduleIr: Record<string, unknown>): Map<string, FieldFacts> {
  const variantsByEnumId = new Map<string, string[]>()
  for (const rawEnum of records(moduleIr.enums)) {
    const id = str(rawEnum.id)
    if (id === null) continue
    variantsByEnumId.set(
      id,
      records(rawEnum.variants)
        .map((variant) => str(variant.name))
        .filter((name): name is string => name !== null),
    )
  }

  const facts = new Map<string, FieldFacts>()
  for (const rawModel of records(moduleIr.models)) {
    for (const rawField of records(rawModel.fields)) {
      const id = str(rawField.id)
      const name = str(rawField.name)
      if (id === null || name === null) continue

      const valueType = isRecord(rawField.value_type) ? rawField.value_type : null
      const typeKind = valueType === null ? null : str(valueType.kind)
      const control = controlFor(typeKind)

      let options: string[] | null = null
      if (control === 'select' && valueType !== null && isRecord(valueType.definition)) {
        const enumId = str(valueType.definition.id)
        options = enumId === null ? null : (variantsByEnumId.get(enumId) ?? null)
      }

      facts.set(id, { name, required: rawField.required === true, control, options })
    }
  }

  return facts
}

function modelNames(moduleIr: Record<string, unknown>): Map<string, string> {
  const names = new Map<string, string>()
  for (const rawModel of records(moduleIr.models)) {
    const id = str(rawModel.id)
    const name = str(rawModel.name)
    if (id !== null && name !== null) names.set(id, name)
  }
  return names
}

function screenNames(moduleIr: Record<string, unknown>): Map<string, string> {
  const names = new Map<string, string>()
  for (const rawScreen of records(moduleIr.screens)) {
    const id = str(rawScreen.id)
    const name = str(rawScreen.name)
    if (id !== null && name !== null) names.set(id, name)
  }
  return names
}

function toField(fieldId: string, facts: Map<string, FieldFacts>): MockupField {
  const found = facts.get(fieldId)
  if (found === undefined) {
    // 선언을 찾지 못한 필드는 지우지 않는다. id 를 그대로 보여주면 사람이 무엇이 어긋났는지 안다.
    return { id: fieldId, name: fieldId, required: false, control: 'text', options: null, resolved: false }
  }
  return { id: fieldId, ...found, resolved: true }
}

function toElement(
  raw: Record<string, unknown>,
  facts: Map<string, FieldFacts>,
  models: Map<string, string>,
): MockupElement {
  const kind = str(raw.kind)
  const id = str(raw.id)
  if (kind === null) return { kind: 'unrecognized', id, rawKind: '', reason: 'unknown-kind' }

  const unrecognized = (reason: UnrecognizedReason): MockupElement => ({
    kind: 'unrecognized',
    id,
    rawKind: kind,
    reason,
  })

  switch (kind) {
    case 'header':
    case 'section': {
      const children = records(raw.children).map((child) => toElement(child, facts, models))
      return { kind, id, children }
    }
    case 'form': {
      const inputs = records(raw.inputs).map((input) => toElement(input, facts, models))
      return { kind: 'form', id, inputs }
    }
    case 'heading': {
      const text = str(raw.text)
      return text === null ? unrecognized('missing-data') : { kind: 'heading', id, text }
    }
    case 'input': {
      const fieldId = str(raw.field_id)
      return fieldId === null
        ? unrecognized('missing-data')
        : { kind: 'input', id, field: toField(fieldId, facts) }
    }
    case 'list': {
      const modelId = str(raw.model_id)
      if (modelId === null) return unrecognized('missing-data')
      return {
        kind: 'list',
        id,
        modelId,
        modelName: models.get(modelId) ?? modelId,
        fields: strings(raw.field_ids).map((fieldId) => toField(fieldId, facts)),
      }
    }
    case 'button': {
      const name = str(raw.name)
      if (name === null) return unrecognized('missing-data')
      return { kind: 'button', id, name, actionId: str(raw.action_id) }
    }
    case 'placeholder': {
      const text = str(raw.text)
      return text === null ? unrecognized('missing-data') : { kind: 'placeholder', id, text }
    }
    default:
      return unrecognized('unknown-kind')
  }
}

/**
 * 컴파일 결과는 `{ files: [{ path, module, diagnostics }] }` 모양이다.
 * 파일 여러 개를 한 번에 컴파일하므로 전부 이어 붙인다.
 */
export function collectScreenMockups(
  response: ProjectCompileResponse | undefined,
): CollectedMockups {
  if (response === undefined) return EMPTY
  if (response.result === null || response.result === undefined) {
    return { ...EMPTY, compiled: false }
  }

  const rawResult: unknown = response.result
  if (!isRecord(rawResult) || !Array.isArray(rawResult.files)) {
    return { ...EMPTY, recognized: false }
  }

  const screens: ScreenMockup[] = []
  for (const rawFile of records(rawResult.files)) {
    const path = str(rawFile.path) ?? ''
    const moduleIr = isRecord(rawFile.module) ? rawFile.module : null
    if (moduleIr === null) continue

    const facts = fieldFacts(moduleIr)
    const models = modelNames(moduleIr)
    const names = screenNames(moduleIr)

    for (const rawLayout of records(moduleIr.screen_layouts)) {
      const screenId = str(rawLayout.screen_id)
      if (screenId === null) continue

      screens.push({
        key: `${path}:${screenId}`,
        screenId,
        screenName: names.get(screenId) ?? null,
        path,
        kind: str(rawLayout.kind),
        elements: records(rawLayout.elements).map((element) =>
          toElement(element, facts, models),
        ),
      })
    }
  }

  return { ...EMPTY, screens }
}

/** 화면 하나를 id 로 꺼낸다. 보드가 노드마다 부르는 자리다. */
export function findScreenMockup(
  collected: CollectedMockups,
  screenId: string,
): ScreenMockup | null {
  return collected.screens.find((screen) => screen.screenId === screenId) ?? null
}
