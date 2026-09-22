import type { ProjectCompileResponse } from '@dahaze/api-client'

import { collectBoard } from '../boards/board-ir'
import type { MetadataCatalog } from './metadata-editor'

export function toMetadataCatalog(compilation: ProjectCompileResponse | undefined): MetadataCatalog {
  const models = new Map<string, MetadataCatalog['models'][number]>()
  const result = isRecord(compilation?.result) ? compilation.result : null
  for (const file of Array.isArray(result?.files) ? result.files.filter(isRecord) : []) {
    const moduleIr = isRecord(file.module) ? file.module : null
    if (moduleIr === null) continue
    const enums = new Map<string, string[]>()
    for (const rawEnum of Array.isArray(moduleIr.enums) ? moduleIr.enums.filter(isRecord) : []) {
      const id = string(rawEnum.id)
      if (id !== null) enums.set(id, Array.isArray(rawEnum.variants) ? rawEnum.variants.filter(isRecord).map((variant) => string(variant.name) ?? string(variant.id)).filter((value): value is string => value !== null) : [])
    }
    for (const rawModel of Array.isArray(moduleIr.models) ? moduleIr.models.filter(isRecord) : []) {
      const id = string(rawModel.id)
      if (id === null) continue
      const model = models.get(id) ?? { id, name: string(rawModel.name) ?? id, fields: [] }
      for (const rawField of Array.isArray(rawModel.fields) ? rawModel.fields.filter(isRecord) : []) {
        const fieldId = string(rawField.id)
        if (fieldId === null || model.fields.some((field) => field.id === fieldId)) continue
        const valueType = isRecord(rawField.value_type) ? rawField.value_type : null
        const typeKind = string(valueType?.kind) ?? 'unknown'
        const definition = isRecord(valueType?.definition) ? valueType.definition : null
        const enumId = string(definition?.id)
        model.fields.push({ id: fieldId, name: string(rawField.name) ?? fieldId, typeKind, ...(enumId === null ? {} : { enumVariants: enums.get(enumId) ?? [] }) })
      }
      models.set(id, model)
    }
  }
  const board = collectBoard(compilation)
  return { models: [...models.values()], screens: board.screens.map((screen) => ({ key: screen.key, name: screen.name })) }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function string(value: unknown): string | null { return typeof value === 'string' ? value : null }
