import { describe, expect, it } from 'vitest'

import { utf8Sha256 } from './document-hash'

describe('planning edit document hash', () => {
  it('hashes the exact UTF-8 bytes without newline or normalization changes', async () => {
    expect(await utf8Sha256('한글\r\n😀e\u0301')).toBe('225c414e6d5ae26f29f2aa998776ce0e29561adf160faa0753bc3948afc72fd7')
  })
})
