import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import screenFixture from '../mockup/__screen-structure-fixture.json'
import { buildReadableSpecification } from './readable-specification'
import { ReadableSpecificationPanel } from './readable-specification-panel'

describe('ReadableSpecificationPanel', () => {
  it('renders a selected button from compiler IR without treating a path label as a condition', () => {
    const specification = buildReadableSpecification(
      { wire_schema_version: 1, result: screenFixture },
      { documents: [{ path: 'screen-structure.rspdl', text: 'x'.repeat(4000) }] },
    )
    const markup = renderToStaticMarkup(<ReadableSpecificationPanel
      specification={specification}
      screenKey="screen-structure.rspdl:reservation.create_facility"
      elementId="save"
    />)

    expect(markup).toContain('시설 등록 화면')
    expect(markup).toContain('생성')
    expect(markup).toContain('등록')
    expect(markup).toContain('검증 가능한 조건')
    expect(markup).toContain('표시 설명')
    expect(markup).toContain('실행 조건으로 해석하지 않음')
  })

  it('keeps compiler findings separate from human and AI context', () => {
    const result = { files: [{ path: 'a.rspdl', module: null, diagnostics: [{ rule_id: 'RSPDL-X', severity: 'warning', message_key: 'compiler.fact', message: '컴파일러 사실', span: { start: 0, end: 1 } }] }] }
    const specification = buildReadableSpecification(
      { wire_schema_version: 1, result },
      { planningState: { decisions: [{ id: 'd', status: 'deferred', title: '사람의 보류' }], proposals: [{ id: 'u', kind: 'unsupported', title: 'AI의 미지원 제안' }] } },
    )
    const markup = renderToStaticMarkup(<ReadableSpecificationPanel specification={specification} />)

    expect(markup).toContain('컴파일러 사실')
    expect(markup).toContain('사람의 보류')
    expect(markup).toContain('AI의 미지원 제안')
    expect(markup).toContain('컴파일러 판정이 아닌 기획 맥락')
  })
})
