import type { ModelSampleSet } from './prototype-contract'

export function parseModelSamples(value: unknown): ModelSampleSet[] {
  if (typeof value !== 'object' || value === null || !('models' in value) || typeof value.models !== 'object' || value.models === null) return []
  return Object.entries(value.models).flatMap(([modelId, raw]) => {
    if (typeof raw !== 'object' || raw === null) return []
    const variants = Object.fromEntries((['normal', 'empty', 'long', 'many'] as const).map((variant) => [variant, parseRows(variant in raw ? raw[variant as keyof typeof raw] : undefined)])) as ModelSampleSet['variants']
    return [{ modelId, variants }]
  })
}

function parseRows(value: unknown): ModelSampleSet['variants']['normal'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((row, index) => {
    if (typeof row !== 'object' || row === null || !('values' in row) || typeof row.values !== 'object' || row.values === null) return []
    const id = 'id' in row && typeof row.id === 'string' ? row.id : `row-${index}`
    const values = Object.fromEntries(Object.entries(row.values).filter((entry): entry is [string, string | number | boolean | null] => entry[1] === null || ['string', 'number', 'boolean'].includes(typeof entry[1])))
    return [{ id, values }]
  })
}
