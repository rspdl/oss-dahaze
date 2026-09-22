import { describe, expect, it } from 'vitest'
import { buildMetadataPatch, parseSampleModels, type SampleModels } from './metadata-editor'

describe('planning metadata samples', () => {
  it('remote variants and typed values initialize without coercion', () => { const models = parseSampleModels({ models: { booking: { normal: [{ id: '1', values: { seats: 2, paid: true, note: 'ok' } }], empty: [], long: [{ id: '2', values: { note: 'long' } }], many: [] } } }); expect(models.booking?.normal[0]?.values).toEqual({ seats: 2, paid: true, note: 'ok' }); expect(models.booking?.long).toHaveLength(1) })
  it('environment-only save preserves untouched models, variants, and extra metadata', () => { const original = { sample_data: { seed: 'kept', models: { booking: { normal: [{ id: '1', values: { seats: 2 } }], empty: [], long: [], many: [] } } } }; const patch = buildMetadataPatch(original, [{ id: 'mobile', name: '고객', width: 390, height: 844, screenKeys: [] }], parseSampleModels(original.sample_data)); expect(patch.sample_data.seed).toBe('kept'); expect((patch.sample_data.models as SampleModels).booking?.normal[0]?.values.seats).toBe(2) })
  it('empty editor draft does not erase existing data', () => { const original = { sample_data: { models: { user: { normal: [{ id: 'u', values: { active: false } }], empty: [], long: [], many: [] } } } }; const patch = buildMetadataPatch(original, [], parseSampleModels(original.sample_data)); expect((patch.sample_data.models as SampleModels).user?.normal).toHaveLength(1) })
})
