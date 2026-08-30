import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RspdlDiagnostic } from '@dahaze/rspdl-editor'
import { describe, expect, it, vi } from 'vitest'

import { DocumentIssueBanner } from './document-issue-banner'

// 앱의 아이콘 모듈은 Next.js의 JSX 변환을 전제로 한다. node 환경의 정적 마크업 테스트에서는
// 장식 아이콘만 걷어 내고 배너의 문구와 접근 가능한 상태를 검증한다.
vi.mock('../../shared/ui/icons', () => ({
  CheckIcon: () => React.createElement('span'),
  ChevronRightIcon: () => React.createElement('span'),
  SparkleIcon: () => React.createElement('span'),
  SpinnerIcon: () => React.createElement('span'),
}))

const diagnostic: RspdlDiagnostic = {
  rule_id: 'semantic.lifecycle.field_producer_missing',
  severity: 'warning',
  message_key: 'field_producer_missing',
  span: { start: 1, end: 4 },
}

function render(overrides: Partial<Parameters<typeof DocumentIssueBanner>[0]> = {}) {
  return renderToStaticMarkup(
    <DocumentIssueBanner
      diagnostics={[diagnostic]}
      selectedIndex={0}
      hasResult
      isCompiling={false}
      isCurrent
      recognized
      renderMessage={() => '예약 상태를 만드는 규칙이 없습니다.'}
      renderTitle={() => '필드 값이 만들어지는 경로가 없습니다'}
      onSelect={vi.fn()}
      onAskAi={vi.fn()}
      {...overrides}
    />,
  )
}

describe('DocumentIssueBanner', () => {
  it('사람이 읽는 문제 설명과 탐색·해결 동작을 함께 보여 준다', () => {
    const html = render()

    expect(html).toContain('예약 상태를 만드는 규칙이 없습니다.')
    expect(html).toContain('필드 값이 만들어지는 경로가 없습니다')
    expect(html).toContain('1 / 1')
    expect(html).toContain('문제 위치로 이동')
    expect(html).toContain('AI에게 해결 요청')
    expect(html).toContain('semantic.lifecycle.field_producer_missing')
  })

  it('인식 가능한 최신 결과에 문제가 없으면 차분한 성공 상태를 보여 준다', () => {
    const html = render({ diagnostics: [] })

    expect(html).toContain('지금 확인할 문제가 없습니다')
    expect(html).not.toContain('AI에게 해결 요청')
  })

  it('모르는 결과 모양을 문제 없음으로 표현하지 않는다', () => {
    const html = render({ diagnostics: [], recognized: false })

    expect(html).toContain('검토 결과를 표시할 수 없습니다')
    expect(html).not.toContain('지금 확인할 문제가 없습니다')
  })

  it('아직 결과가 없으면 빈 문서를 문제 없는 문서로 오해하지 않는다', () => {
    const html = render({ diagnostics: [], hasResult: false })

    expect(html).toContain('문서를 입력하면 바로 검토합니다')
    expect(html).not.toContain('지금 확인할 문제가 없습니다')
  })

  it('검토 요청 실패와 재시도 동작을 분명히 보여 준다', () => {
    const html = render({ errorMessage: '서버에 연결할 수 없습니다.', onRetry: vi.fn() })

    expect(html).toContain('문서를 검토하지 못했습니다')
    expect(html).toContain('서버에 연결할 수 없습니다.')
    expect(html).toContain('다시 시도')
  })

  it('이전 결과에서는 위치 이동을 비활성화한다', () => {
    const html = render({ isCurrent: false })

    expect(html).toContain('이전 검토 결과')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>문제 위치로 이동<\/button>/)
  })

  it('위치로 이동할 수 없는 이유를 버튼에서도 알려 준다', () => {
    const html = render({ isCurrent: false })

    expect(html).toContain('최신 검토가 끝나면 이동할 수 있습니다')
  })

  it('문제가 여럿이면 전체 목록으로 들어가는 길을 준다', () => {
    const html = render({ diagnostics: [diagnostic, { ...diagnostic, severity: 'error' }] })

    expect(html).toContain('모든 문제 보기')
    expect(html).toContain('1 / 2')
  })

  it('문제가 한 건이면 목록을 따로 만들지 않는다', () => {
    const html = render()

    expect(html).not.toContain('모든 문제 보기')
  })
})
