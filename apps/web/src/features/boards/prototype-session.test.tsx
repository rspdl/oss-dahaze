import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePrototypeSession } from './prototype-session'

type SessionHook = ReturnType<typeof usePrototypeSession>

describe('prototype session persistence', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('mounts a fresh session, restores same-project values, and never writes them into another project', async () => {
    const storage = memoryStorage()
    const document = fakeDocument()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('window', document.defaultView)
    vi.stubGlobal('document', document)
    vi.stubGlobal('sessionStorage', storage)

    let latest: SessionHook | null = null
    const Harness = ({ projectId }: { projectId: string }) => {
      latest = usePrototypeSession(projectId)
      return null
    }
    let mounted = mount(document)
    await act(async () => { mounted.root.render(<Harness projectId="alpha" />) })
    expect(storage.getItem('dahaze:prototype:alpha')).toBe('{"selectedSampleIdByModel":{},"experienceValues":{}}')

    await act(async () => {
      latest!.setSelectedSampleIdByModel({ booking: 'sample-1' })
      latest!.setExperienceValues({ contact: '010-0000-0000' })
    })
    const alpha = storage.getItem('dahaze:prototype:alpha')
    expect(alpha).toContain('sample-1')
    expect(alpha).toContain('010-0000-0000')

    await act(async () => { mounted.root.unmount() })
    mounted = mount(document)
    await act(async () => { mounted.root.render(<Harness projectId="alpha" />) })
    expect(latest!.selectedSampleIdByModel).toEqual({ booking: 'sample-1' })
    expect(latest!.experienceValues).toEqual({ contact: '010-0000-0000' })

    await act(async () => { mounted.root.render(<Harness projectId="beta" />) })
    expect(storage.getItem('dahaze:prototype:alpha')).toBe(alpha)
    expect(storage.getItem('dahaze:prototype:beta')).toBe('{"selectedSampleIdByModel":{},"experienceValues":{}}')
    expect(latest!.selectedSampleIdByModel).toEqual({})
    expect(latest!.experienceValues).toEqual({})
    await act(async () => { mounted.root.unmount() })
  })
})

function mount(document: ReturnType<typeof fakeDocument>): { root: Root } {
  const container = fakeElement(document)
  return { root: createRoot(container as unknown as Element) }
}

function fakeDocument() {
  const view = { HTMLIFrameElement: class {}, HTMLElement: class {}, Node: class {} }
  const document = {
    nodeType: 9,
    defaultView: view,
    documentElement: null,
    addEventListener() {},
    removeEventListener() {},
  }
  return document
}

function fakeElement(ownerDocument: ReturnType<typeof fakeDocument>) {
  return {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument,
    parentNode: null,
    childNodes: [],
    style: {},
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    insertBefore() {},
    removeChild() {},
    setAttribute() {},
    removeAttribute() {},
  }
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}
