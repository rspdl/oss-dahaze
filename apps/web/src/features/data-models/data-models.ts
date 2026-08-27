import type { ProjectCompileResponse } from '@dahaze/api-client'

/**
 * 컴파일러 원본 결과에서 데이터 모델을 화면이 읽을 수 있는 최소 단위로만 좁힌다.
 *
 * 이 모듈은 새 의미를 만들지 않는다. id·이름·필수 여부·값 타입·enum 값처럼 컴파일러가
 * 이미 준 사실만 한 화면에서 반복해서 읽지 않도록 모은다. 모르는 wire shape 는 비어 있는
 * 모델 목록으로 보이지 않게 `recognized: false` 로 돌려준다.
 */
export interface DataModelField {
  id: string
  name: string
  required: boolean
  typeKind: string
  enumVariants: string[] | null
}

export interface DataModelEntry {
  /** 같은 id 가 다른 문서에 있어도 목록에서 합쳐지지 않도록 path 를 포함한다. */
  key: string
  id: string
  name: string
  path: string
  fields: DataModelField[]
}

/** 컴파일러가 선언 순서대로 준 두 모델 사이의 관계. */
export interface DataModelRelation {
  id: string
  name: string
  /** 관계가 선언된 모델. 컴파일러가 준 parameter_model_ids[0] 이다. */
  sourceKey: string
  /** 관계의 상대 모델. 컴파일러가 준 parameter_model_ids[1] 이다. */
  targetKey: string
  /** required · unique 같은 컴파일러 관계 제약의 kind 원본. */
  constraints: string[]
}

export interface CollectedDataModels {
  models: DataModelEntry[]
  relations: DataModelRelation[]
  /** 화면이 현재 SDK wire shape 를 인식하는지. */
  recognized: boolean
  /** 문서가 있어 실제 컴파일이 실행됐는지. */
  compiled: boolean
}

const EMPTY: CollectedDataModels = {
  models: [],
  relations: [],
  recognized: true,
  compiled: true,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function enumVariants(moduleIr: Record<string, unknown>): Map<string, string[]> {
  const variantsById = new Map<string, string[]>()

  for (const rawEnum of records(moduleIr.enums)) {
    const id = str(rawEnum.id)
    if (id === null) continue
    variantsById.set(
      id,
      records(rawEnum.variants)
        .map((variant) => str(variant.name))
        .filter((name): name is string => name !== null),
    )
  }

  return variantsById
}

function fieldFrom(
  raw: Record<string, unknown>,
  variantsByEnumId: Map<string, string[]>,
): DataModelField | null {
  const id = str(raw.id)
  const name = str(raw.name)
  if (id === null || name === null) return null

  const valueType = isRecord(raw.value_type) ? raw.value_type : null
  const typeKind = valueType === null ? 'unknown' : (str(valueType.kind) ?? 'unknown')
  const definition = valueType !== null && isRecord(valueType.definition)
    ? valueType.definition
    : null
  const enumId = definition === null ? null : str(definition.id)

  return {
    id,
    name,
    required: raw.required === true,
    typeKind,
    enumVariants:
      typeKind === 'enum' && enumId !== null
        ? (variantsByEnumId.get(enumId) ?? null)
        : null,
  }
}

function relationConstraints(moduleIr: Record<string, unknown>): Map<string, string[]> {
  const constraintsByRelationId = new Map<string, string[]>()

  for (const raw of records(moduleIr.relational_constraints)) {
    const constraint = isRecord(raw.constraint) ? raw.constraint : null
    if (constraint === null) continue
    const relationId = str(constraint.relation_id)
    const kind = str(constraint.kind)
    if (relationId === null || kind === null) continue
    const current = constraintsByRelationId.get(relationId) ?? []
    current.push(kind)
    constraintsByRelationId.set(relationId, current)
  }

  return constraintsByRelationId
}

export function collectDataModels(
  response: ProjectCompileResponse | undefined,
): CollectedDataModels {
  if (response === undefined) return EMPTY
  if (response.result === null || response.result === undefined) {
    return { ...EMPTY, compiled: false }
  }

  const rawResult: unknown = response.result
  if (!isRecord(rawResult) || !Array.isArray(rawResult.files)) {
    return { ...EMPTY, recognized: false }
  }

  const models: DataModelEntry[] = []
  const relations: DataModelRelation[] = []
  for (const rawFile of records(rawResult.files)) {
    const path = str(rawFile.path) ?? ''
    const moduleIr = isRecord(rawFile.module) ? rawFile.module : null
    if (moduleIr === null) continue

    const variantsByEnumId = enumVariants(moduleIr)
    const modelKeys = new Map<string, string>()
    for (const rawModel of records(moduleIr.models)) {
      const id = str(rawModel.id)
      const name = str(rawModel.name)
      if (id === null || name === null) continue

      const key = `${path}:${id}`
      modelKeys.set(id, key)
      models.push({
        key,
        id,
        name,
        path,
        fields: records(rawModel.fields)
          .map((field) => fieldFrom(field, variantsByEnumId))
          .filter((field): field is DataModelField => field !== null),
      })
    }

    const constraintsByRelationId = relationConstraints(moduleIr)
    for (const rawRelation of records(moduleIr.relations)) {
      const id = str(rawRelation.id)
      const name = str(rawRelation.name)
      const parameterModelIds = rawRelation.parameter_model_ids
      if (
        id === null ||
        name === null ||
        !Array.isArray(parameterModelIds) ||
        parameterModelIds.length !== 2 ||
        !parameterModelIds.every((value): value is string => typeof value === 'string')
      ) {
        continue
      }

      const sourceId = parameterModelIds[0]
      const targetId = parameterModelIds[1]
      if (sourceId === undefined || targetId === undefined) continue
      const sourceKey = modelKeys.get(sourceId)
      const targetKey = modelKeys.get(targetId)
      // IR 이 실제 모델과 연결하지 못한 관계는 임의 노드를 만들지 않는다.
      if (sourceKey === undefined || targetKey === undefined) continue

      relations.push({
        id,
        name,
        sourceKey,
        targetKey,
        constraints: constraintsByRelationId.get(id) ?? [],
      })
    }
  }

  return { ...EMPTY, models, relations }
}
