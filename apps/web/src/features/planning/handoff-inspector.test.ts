import { describe, expect, it } from 'vitest'

import { snapshotDocumentSourceHashes } from './snapshot-document-hash'

describe('snapshot document design binding', () => {
  it('uses each document hash and derives legacy snapshots from exact UTF-8 text', async () => {
    const hashes = await snapshotDocumentSourceHashes([
      { path: 'new.rspdl', source_hash: 'a'.repeat(64), text: 'ignored' },
      { path: 'legacy.rspdl', text: '한글\r\n😀e\u0301' },
    ])
    expect(hashes['new.rspdl']).toBe('a'.repeat(64))
    expect(hashes['legacy.rspdl']).toBe('225c414e6d5ae26f29f2aa998776ce0e29561adf160faa0753bc3948afc72fd7')
  })
})
