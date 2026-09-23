import { describe, expect, it } from 'vitest'

import { designBindingKey } from './prototype-contract'

describe('designBindingKey', () => {
  it('같은 요소 경로라도 화면과 소스 버전별로 분리한다', () => {
    const first = designBindingKey({ screenKey: 'a.rspdl:checkout', elementPath: 'elements.0', sourceHash: 'rev-1' })
    const otherScreen = designBindingKey({ screenKey: 'a.rspdl:receipt', elementPath: 'elements.0', sourceHash: 'rev-1' })
    const otherRevision = designBindingKey({ screenKey: 'a.rspdl:checkout', elementPath: 'elements.0', sourceHash: 'rev-2' })
    expect(new Set([first, otherScreen, otherRevision]).size).toBe(3)
  })
})
