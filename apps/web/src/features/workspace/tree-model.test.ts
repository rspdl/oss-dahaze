import type { TreeEntryResponse } from '@dahaze/api-client'
import { describe, expect, it } from 'vitest'

import {
  buildTree,
  describeHolder,
  flattenVisible,
  holderSessionId,
  isWithin,
  joinPath,
  parentPath,
} from './tree-model'

function entry(path: string, kind: 'file' | 'folder' = 'file', extra: Partial<TreeEntryResponse> = {}) {
  return { path, kind, change: null, locked_by: null, ...extra } satisfies TreeEntryResponse
}

describe('paths', () => {
  it('computes parents and joins from the root', () => {
    expect(parentPath('/주문.rspdl')).toBe('/')
    expect(parentPath('/주문/결제.rspdl')).toBe('/주문')
    expect(joinPath('/', '주문')).toBe('/주문')
    expect(joinPath('/주문', '결제.rspdl')).toBe('/주문/결제.rspdl')
  })

  it('checks containment by segment, not by prefix', () => {
    expect(isWithin('/주문/결제.rspdl', '/주문')).toBe(true)
    expect(isWithin('/주문서.rspdl', '/주문')).toBe(false)
    expect(isWithin('/아무거나', '/')).toBe(true)
  })
})

describe('buildTree', () => {
  it('nests entries and puts folders before files in name order', () => {
    const nodes = buildTree([
      entry('/b.rspdl'),
      entry('/주문/결제.rspdl', 'file', { change: 'modify', locked_by: 'session:1' }),
      entry('/주문', 'folder'),
      entry('/a.rspdl'),
    ])

    expect(nodes.map((node) => node.path)).toEqual(['/주문', '/a.rspdl', '/b.rspdl'])
    expect(nodes[0]!.children).toEqual([
      {
        path: '/주문/결제.rspdl',
        name: '결제.rspdl',
        kind: 'file',
        change: 'modify',
        lockedBy: 'session:1',
        children: [],
      },
    ])
  })

  it('creates missing parent folders instead of dropping files', () => {
    const nodes = buildTree([entry('/가/나/다.rspdl')])
    expect(nodes[0]!.path).toBe('/가')
    expect(nodes[0]!.children[0]!.path).toBe('/가/나')
    expect(nodes[0]!.children[0]!.children[0]!.path).toBe('/가/나/다.rspdl')
  })

  it('sorts numbers naturally', () => {
    const nodes = buildTree([entry('/화면10.rspdl'), entry('/화면2.rspdl')])
    expect(nodes.map((node) => node.name)).toEqual(['화면2.rspdl', '화면10.rspdl'])
  })
})

describe('flattenVisible', () => {
  it('includes children of expanded folders only', () => {
    const nodes = buildTree([entry('/주문', 'folder'), entry('/주문/결제.rspdl'), entry('/a.rspdl')])
    expect(flattenVisible(nodes, new Set()).map((row) => row.node.path)).toEqual(['/주문', '/a.rspdl'])
    expect(flattenVisible(nodes, new Set(['/주문'])).map((row) => [row.node.path, row.depth])).toEqual([
      ['/주문', 0],
      ['/주문/결제.rspdl', 1],
      ['/a.rspdl', 0],
    ])
  })
})

describe('lock holders', () => {
  it('names app sessions and MCP clients', () => {
    expect(describeHolder('session:abc')).toBe('AI 대화')
    expect(describeHolder('mcp:u1')).toBe('MCP 클라이언트')
    expect(describeHolder('other')).toBe('other')
    expect(holderSessionId('session:abc')).toBe('abc')
    expect(holderSessionId('mcp:u1')).toBeNull()
  })
})
