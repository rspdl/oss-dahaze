'use client'

import * as React from 'react'
import { cn } from '@dahaze/ui'

import type {
  ControlKind,
  MockupElement,
  MockupField,
  ScreenMockup,
} from './screen-layouts'

/**
 * 선언된 레이아웃을 화면처럼 그린다.
 *
 * **여기에 LLM 이 없다.** 구조는 문서가 선언한 것이고 렌더링은 결정적이다. 같은 IR 은 언제나
 * 같은 그림을 낸다.
 *
 * 그리는 것은 **목업**이지 동작하는 폼이 아니다. 그래서 입력칸은 진짜 `input` 이 아니라
 * 입력칸처럼 보이는 상자다. 보드 위 노드 안에 진짜 폼 컨트롤을 넣으면 캔버스를 키보드로
 * 지나갈 때마다 칸마다 걸리고, 사용자는 채울 수 없는 칸에 커서를 잡히게 된다. 라벨은 읽히고
 * 상자는 장식이다.
 *
 * 문서가 말하지 않은 것은 그리지 않는다. 샘플 내용이 붙기 전까지 칸은 비어 있고, 비어 있는
 * 것은 아무 사실도 주장하지 않는다.
 */

/** 목업을 그릴 폭. 실제 기기 폭이라야 배치가 진짜 화면처럼 읽힌다. */
export type MockupViewport = 'desktop' | 'mobile'

const VIEWPORT_WIDTH: Record<MockupViewport, number> = {
  desktop: 1024,
  mobile: 390,
}

/** 입력칸 모양을 사람이 읽을 이름으로. 색이나 모양에만 기대지 않기 위해 텍스트로도 남긴다. */
const CONTROL_LABEL: Record<ControlKind, string> = {
  text: '글자',
  number: '숫자',
  date: '날짜',
  time: '시각',
  datetime: '날짜와 시각',
  select: '선택',
  checkbox: '예/아니오',
}

function FieldLabel({ field }: { field: MockupField }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={cn(
          'text-xs font-medium',
          field.resolved ? 'text-text-muted' : 'text-diagnostic-error',
        )}
      >
        {field.name}
      </span>
      {field.required ? (
        <span className="text-[10px] text-text-subtle">필수</span>
      ) : null}
      {field.resolved ? null : (
        <span className="text-[10px] text-diagnostic-error">선언을 찾지 못함</span>
      )}
    </span>
  )
}

/**
 * 입력칸.
 *
 * `select` 는 선언된 값들을 그대로 보여준다. 그것은 지어낸 내용이 아니라 문서가 말한 사실이라
 * 화면에 드러나는 편이 낫다.
 */
function Control({ field }: { field: MockupField }) {
  if (field.control === 'checkbox') {
    return (
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-4 shrink-0 rounded border border-border-strong bg-surface"
        />
        <span className="text-[11px] text-text-subtle">{CONTROL_LABEL.checkbox}</span>
      </span>
    )
  }

  if (field.control === 'select') {
    return (
      <span className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 py-1.5">
        {field.options === null || field.options.length === 0 ? (
          <span className="text-[11px] text-text-subtle">{CONTROL_LABEL.select}</span>
        ) : (
          field.options.map((option) => (
            <span
              key={option}
              className="rounded-sm bg-surface-raised px-1.5 py-0.5 text-[11px] text-text-muted"
            >
              {option}
            </span>
          ))
        )}
      </span>
    )
  }

  return (
    <span className="flex h-8 items-center rounded-md border border-border-strong bg-surface px-2.5">
      <span className="text-[11px] text-text-subtle">{CONTROL_LABEL[field.control]}</span>
    </span>
  )
}

function Input({ field }: { field: MockupField }) {
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel field={field} />
      <Control field={field} />
    </div>
  )
}

/**
 * 목록.
 *
 * 선언된 필드가 열이 된다. 줄은 비워 둔다 — 샘플 내용이 붙기 전에 값을 지어내면 기획자가
 * 쓰지 않은 것을 쓴 것처럼 보인다. 빈 줄은 "여기에 데이터가 온다" 는 자리일 뿐이다.
 */
function ListElement({
  modelName,
  fields,
}: {
  modelName: string
  fields: MockupField[]
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="border-b border-border bg-surface-raised px-3 py-1.5">
        <span className="text-[11px] text-text-subtle">{modelName} 목록</span>
      </div>
      {fields.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-text-subtle">보여줄 필드가 없다</div>
      ) : (
        <table className="w-full table-fixed">
          <thead>
            <tr className="border-b border-border">
              {fields.map((field) => (
                <th key={field.id} className="px-3 py-1.5 text-left">
                  <FieldLabel field={field} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody aria-hidden>
            {[0, 1, 2].map((row) => (
              <tr key={row} className="border-b border-border last:border-b-0">
                {fields.map((field) => (
                  <td key={field.id} className="px-3 py-2">
                    <span className="block h-2 rounded-full bg-shimmer" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * 선언할 수 없는 자리.
 *
 * 지도·차트처럼 의미 단위 어휘로 옮길 수 없는 것은 이름표만 달고 비운다. 채우는 것은
 * 디자인의 일이다.
 */
function Placeholder({ text }: { text: string }) {
  return (
    <div className="flex min-h-20 items-center justify-center rounded-md border border-dashed border-border-strong bg-surface-raised">
      <span className="text-[11px] text-text-subtle">{text}</span>
    </div>
  )
}

/**
 * 알아보지 못한 요소.
 *
 * 조용히 떨어뜨리지 않는다. 떨어뜨리면 렌더러가 문서에 대해 거짓말을 하게 되고, 사람은
 * 자기가 쓴 것이 왜 안 보이는지 알 길이 없다.
 */
function Unrecognized({
  rawKind,
  reason,
}: {
  rawKind: string
  reason: 'unknown-kind' | 'missing-data'
}) {
  const message =
    reason === 'unknown-kind'
      ? `모르는 요소${rawKind === '' ? '' : `: ${rawKind}`}`
      : `${rawKind} 요소에 필요한 값이 없다`

  return (
    <div className="rounded-md border border-dashed border-diagnostic-error bg-diagnostic-error-subtle px-3 py-2">
      <span className="text-[11px] text-diagnostic-error">{message}</span>
    </div>
  )
}

function Element({ element }: { element: MockupElement }) {
  switch (element.kind) {
    case 'header':
      return (
        <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-raised px-4 py-3">
          {element.children.map((child, index) => (
            <Element key={index} element={child} />
          ))}
        </header>
      )
    case 'section':
      return (
        <section className="flex flex-col gap-3 px-4 py-3">
          {element.children.map((child, index) => (
            <Element key={index} element={child} />
          ))}
        </section>
      )
    case 'heading':
      return (
        <h3 className="text-sm font-semibold tracking-tight text-text">{element.text}</h3>
      )
    case 'form':
      return (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
          {element.inputs.map((input, index) => (
            <Element key={index} element={input} />
          ))}
        </div>
      )
    case 'input':
      return <Input field={element.field} />
    case 'list':
      return <ListElement modelName={element.modelName} fields={element.fields} />
    case 'button':
      return (
        <span className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-xs font-medium text-on-solid">
          {element.name}
        </span>
      )
    case 'placeholder':
      return <Placeholder text={element.text} />
    case 'unrecognized':
      return <Unrecognized rawKind={element.rawKind} reason={element.reason} />
  }
}

/**
 * 화면 하나를 기기 폭에 맞춰 그린다.
 *
 * 폭은 prop 이다. 프로젝트마다 고르는 설정은 서버에 있지만 그 값을 읽는 것은 보드의 일이고,
 * 렌더러는 어느 폭으로 그릴지만 안다.
 */
export function ScreenMockupFrame({
  screen,
  viewport = 'desktop',
  className,
}: {
  screen: ScreenMockup
  viewport?: MockupViewport
  className?: string
}) {
  return (
    <figure
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border border-border bg-canvas',
        className,
      )}
      style={{ width: VIEWPORT_WIDTH[viewport] }}
    >
      <figcaption className="flex items-baseline gap-2 border-b border-border bg-surface px-4 py-2">
        <span className="text-xs font-semibold text-text">
          {screen.screenName ?? screen.screenId}
        </span>
        {screen.kind === null ? null : (
          <span className="text-[10px] text-text-subtle">{screen.kind}</span>
        )}
      </figcaption>

      {screen.elements.length === 0 ? (
        <div className="px-4 py-6 text-[11px] text-text-subtle">
          레이아웃에 요소가 없다
        </div>
      ) : (
        <div className="flex flex-col">
          {screen.elements.map((element, index) => (
            <Element key={index} element={element} />
          ))}
        </div>
      )}
    </figure>
  )
}
