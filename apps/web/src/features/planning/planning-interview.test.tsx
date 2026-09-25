import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PlanningInterview } from './planning-interview'

describe('PlanningInterview', () => {
  it('요약 없이 확인 질문만 반환한 생성 작업도 보관된 결과를 보여 준다', () => {
    const markup = renderToStaticMarkup(<PlanningInterview messages={[]} jobs={[
      { id: 'questions', kind: 'generate', status: 'succeeded', resultItems: ['환불 시점을 먼저 정해 주세요.'], retryable: false, createdAt: '' },
    ]} />)

    expect(markup).toContain('보관된 결과')
    expect(markup).toContain('환불 시점을 먼저 정해 주세요.')
  })

  it('진행 중인 작업과 stale 결과, 재시도 가능한 실패를 숨기지 않는다', () => {
    const markup = renderToStaticMarkup(<PlanningInterview messages={[]} jobs={[
      { id: 'running', kind: 'interview', status: 'running', stage: '질문 정리', completed: 1, total: 3, message: '정책 후보를 정리하고 있습니다.', retryable: false, createdAt: '' },
      { id: 'stale', kind: 'generate', status: 'succeeded', disposition: 'stale', conflictMessage: '기준 프로젝트 버전이 달라졌습니다.', retryable: true, createdAt: '' },
      { id: 'failed', kind: 'generate', status: 'failed', errorMessage: '응답 형식을 검증하지 못했습니다.', retryable: true, createdAt: '' },
    ]} onCancelJob={() => undefined} onRetryJob={() => undefined} />)

    expect(markup).toContain('AI 작업 상태')
    expect(markup).toContain('정책 후보를 정리하고 있습니다')
    expect(markup).toContain('기준 프로젝트 버전이 달라졌습니다')
    expect(markup).toContain('응답 형식을 검증하지 못했습니다')
    expect(markup).toContain('다시 시도')
    expect(markup).toContain('취소')
  })

  it('고른 맥락을 입력창 위에 보여 주고 해제할 수 있게 한다', () => {
    const markup = renderToStaticMarkup(<PlanningInterview messages={[]} jobs={[]} subject={{ kind: 'element', id: 'checkout:stable:pay', label: '결제 버튼' }} onClearSubject={() => undefined} />)

    expect(markup).toContain('이어서 확인 · 결제 버튼')
    expect(markup).toContain('선택 해제')
  })
})
