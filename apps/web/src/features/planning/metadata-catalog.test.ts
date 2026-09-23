import { describe, expect, it } from 'vitest'
import type { ProjectCompileResponse } from '@dahaze/api-client'

import { toMetadataCatalog } from './metadata-catalog'

function response(models: unknown[], policies: unknown[] = []): ProjectCompileResponse {
  return { documents: [], locale: 'ko-KR', rspdl_version: 'test', wire_schema_version: 1, result: { files: [{ path: 'sample.rspdl', diagnostics: [], module: { models, policies, enums: [{ id: 'status', variants: [{ id: 'ready', name: '준비' }, { id: 'done', name: '완료' }] }] } }] } }
}

describe('metadata catalog', () => {
  it('includes models and fields when there are no policy rows', () => {
    const catalog = toMetadataCatalog(response([{ id: 'booking', name: '예약', fields: [{ id: 'name', name: '이름', value_type: { kind: 'string' } }] }]))
    expect(catalog.models).toEqual([{ id: 'booking', name: '예약', fields: [{ id: 'name', name: '이름', typeKind: 'string' }] }])
  })

  it('keeps non-policy fields and enum choices in a partially governed model', () => {
    const catalog = toMetadataCatalog(response([{ id: 'booking', name: '예약', fields: [{ id: 'guarded', name: '보호 필드', value_type: { kind: 'string' } }, { id: 'state', name: '상태', value_type: { kind: 'enum', definition: { id: 'status' } } }] }], [{ field_id: 'guarded' }]))
    expect(catalog.models[0]?.fields).toEqual([{ id: 'guarded', name: '보호 필드', typeKind: 'string' }, { id: 'state', name: '상태', typeKind: 'enum', enumVariants: ['준비', '완료'] }])
  })
})
