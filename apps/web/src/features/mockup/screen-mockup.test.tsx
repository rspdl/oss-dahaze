import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ProjectCompileResponse } from '@dahaze/api-client'
import screenStructure from './__screen-structure-fixture.json'
import { collectScreenMockups, findScreenMockup } from './screen-layouts'
import { ScreenMockupFrame } from './screen-mockup'
import type { MockupViewport } from './screen-mockup'

function response(result: unknown): ProjectCompileResponse {
  return {
    rspdl_version: '0.1.2',
    wire_schema_version: 1,
    locale: 'ko-KR',
    result: result as ProjectCompileResponse['result'],
    documents: [],
  }
}

const collected = collectScreenMockups(response(screenStructure))

function render(screenId: string, viewport: MockupViewport = 'desktop') {
  const screen = findScreenMockup(collected, screenId)
  if (screen === null) throw new Error(`화면을 찾지 못했다: ${screenId}`)
  return renderToStaticMarkup(
    <ScreenMockupFrame screen={screen} viewport={viewport} />,
  )
}

describe('ScreenMockupFrame', () => {
  it('선언된 필드 이름을 라벨로 그린다', () => {
    const markup = render('reservation.create_facility')

    expect(markup).toContain('이름')
    expect(markup).toContain('수용 인원')
    // 라벨은 모델의 이름이지 id 가 아니다.
    expect(markup).not.toContain('reservation.facility.capacity')
  })

  it('필수 여부를 색이 아니라 글자로도 드러낸다', () => {
    expect(render('reservation.create_facility')).toContain('필수')
  })

  it('버튼이 선언된 이름을 지닌다', () => {
    expect(render('reservation.facility_detail')).toContain('예약 신청')
  })

  it('자리표시자가 이름표를 보여준다', () => {
    expect(render('reservation.facility_detail')).toContain('시설 위치 지도')
  })

  it('제목과 화면 이름을 함께 그린다', () => {
    const markup = render('reservation.facility_list')

    expect(markup).toContain('시설 찾기')
    expect(markup).toContain('시설 목록 화면')
  })

  it('목록의 열을 선언된 필드 이름으로 만든다', () => {
    const markup = render('reservation.facility_list')

    expect(markup).toContain('시설 목록')
    expect(markup).toContain('<th')
  })

  it('값을 지어내지 않는다', () => {
    // 샘플 내용이 붙기 전에는 어떤 값도 화면에 없어야 한다. 빈 칸은 아무 사실도 주장하지 않는다.
    const markup = render('reservation.facility_list')
    expect(markup).not.toMatch(/강당|회의실|세미나/)
  })

  it('입력칸이 진짜 폼 컨트롤이 아니다', () => {
    // 보드 노드 안의 목업에 진짜 컨트롤을 넣으면 캔버스를 키보드로 지날 때 칸마다 걸린다.
    const markup = render('reservation.create_facility')
    expect(markup).not.toContain('<input')
    expect(markup).not.toContain('<select')
    expect(markup).not.toContain('<button')
  })

  it('뷰포트가 폭을 정하되 배치는 같다', () => {
    const desktop = render('reservation.facility_list', 'desktop')
    const mobile = render('reservation.facility_list', 'mobile')

    expect(desktop).toContain('width:1024px')
    expect(mobile).toContain('width:390px')
    // 같은 레이아웃이다. 폭만 다르고 요소가 빠지거나 더해지지 않는다.
    const strip = (markup: string) => markup.replace(/width:\d+px/, '')
    expect(strip(desktop)).toBe(strip(mobile))
  })
})

describe('모르는 것을 화면이 숨기지 않는다', () => {
  it('어휘 밖의 요소를 눈에 보이게 남긴다', () => {
    const odd = collectScreenMockups(
      response({
        files: [
          {
            path: 'a.rspdl',
            module: {
              screens: [{ id: 'a.b', name: '이상한 화면' }],
              screen_layouts: [{ screen_id: 'a.b', elements: [{ kind: '탭바' }] }],
            },
            diagnostics: [],
          },
        ],
      }),
    )
    const screen = findScreenMockup(odd, 'a.b')
    if (screen === null) throw new Error('화면을 찾지 못했다')

    expect(renderToStaticMarkup(<ScreenMockupFrame screen={screen} />)).toContain(
      '모르는 요소: 탭바',
    )
  })
})

describe('프로토타입 체험', () => {
  it('체험 모드에서는 실제 입력 컨트롤을 제공한다', () => {
    const screen = findScreenMockup(collected, 'reservation.create_facility')!
    const markup = renderToStaticMarkup(<ScreenMockupFrame screen={screen} mode="experience" />)
    expect(markup).toContain('<input')
  })

  it('한 행동에 여러 경로가 있으면 결과 선택을 요구한다', () => {
    const screen = findScreenMockup(collected, 'reservation.facility_list')!
    const markup = renderToStaticMarkup(<ScreenMockupFrame screen={screen} mode="experience" outcomesByElementId={{ open: [{ id: 'success', label: '성공', targetScreenKey: 'detail' }, { id: 'failure', label: '실패', targetScreenKey: 'error' }] }} />)
    expect(markup).toContain('결과 선택')
    expect(markup).toContain('성공')
    expect(markup).toContain('실패')
  })

  it('샘플 상황을 모델 단위의 표시된 예시로 일관되게 만든다', () => {
    const screen = findScreenMockup(collected, 'reservation.facility_list')!
    const normal = renderToStaticMarkup(<ScreenMockupFrame screen={screen} sampleVariant="normal" />)
    const empty = renderToStaticMarkup(<ScreenMockupFrame screen={screen} sampleVariant="empty" />)
    expect(normal).toContain('예시 데이터')
    expect(normal).toContain('예시 1')
    expect(empty).toContain('샘플이 비어 있습니다')
  })

  it('선택한 샘플의 필드값을 입력에 채우고 직접 입력값을 우선한다', () => {
    const screen = findScreenMockup(collected, 'reservation.create_facility')!
    const samples = [{ modelId: 'reservation.facility', variants: { normal: [{ id: 'chosen', values: { 'reservation.facility.capacity': 42 } }], empty: [], long: [], many: [] } }]
    const sampled = renderToStaticMarkup(<ScreenMockupFrame screen={screen} mode="experience" samples={samples} selectedSampleIdByModel={{ 'reservation.facility': 'chosen' }} />)
    const entered = renderToStaticMarkup(<ScreenMockupFrame screen={screen} mode="experience" samples={samples} selectedSampleIdByModel={{ 'reservation.facility': 'chosen' }} values={{ 'reservation.facility.capacity': '55' }} />)
    expect(sampled).toContain('value="42"')
    expect(entered).toContain('value="55"')
  })

  it('사용자 지정 너비와 높이를 적용한다', () => {
    const screen = findScreenMockup(collected, 'reservation.facility_list')!
    const markup = renderToStaticMarkup(<ScreenMockupFrame screen={screen} dimensions={{ width: 720, height: 900 }} />)
    expect(markup).toContain('width:720px')
    expect(markup).toContain('height:900px')
  })
})
