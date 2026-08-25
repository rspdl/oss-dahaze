'use client'

import type { CompiledDocumentRef } from '@dahaze/api-client'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@dahaze/ui'

import {
  axisOptions,
  type PolicyAxis,
  type PolicyRow,
} from '@/shared/rspdl/policies'
import { ChevronDownIcon, XIcon } from '@/shared/ui/icons'
import { activeFilterCount, usePolicyFilterStore } from './policy-filter-store'

/**
 * 축마다 값을 골라 거르고, 고른 축으로 묶는다.
 *
 * 축을 여섯 개 다 늘어놓는 이유는, 사람이 정책을 물을 때 시작점이 매번 다르기 때문이다.
 * "감사자가 뭘 할 수 있지" 는 역할에서, "이 필드 누가 건드리지" 는 필드에서, "금지된 게
 * 뭐지" 는 효과에서 출발한다. 어느 축이 주인공인지 미리 정해 두면 나머지 질문이 불편해진다.
 *
 * 선택지는 **지금 있는 정책에서만** 뽑는다. 고를 수는 있는데 고르면 결과가 비는 값이
 * 목록에 있으면, 사용자는 그게 필터 탓인지 문서 탓인지 알 수 없다.
 */

/** 화면에 늘어놓는 순서. 왼쪽부터 자주 쓰는 축이다. */
const AXES: { id: PolicyAxis; label: string }[] = [
  { id: 'role', label: '역할' },
  { id: 'model', label: '모델' },
  { id: 'field', label: '필드' },
  { id: 'action', label: '행동' },
  { id: 'effect', label: '효과' },
  { id: 'path', label: '문서' },
]

export function PolicyFilters({
  rows,
  visibleCount,
  documentsByPath,
}: {
  /** 거르기 **전**의 전체 줄. 선택지는 여기서 뽑는다 — 거른 뒤에서 뽑으면 한 번 고른
   *  값 말고는 다시 고를 수 없게 된다. */
  rows: PolicyRow[]
  visibleCount: number
  documentsByPath: Map<string, CompiledDocumentRef>
}) {
  const selection = usePolicyFilterStore((state) => state.selection)
  const groupBy = usePolicyFilterStore((state) => state.groupBy)
  const toggle = usePolicyFilterStore((state) => state.toggle)
  const clearAxis = usePolicyFilterStore((state) => state.clearAxis)
  const clearAll = usePolicyFilterStore((state) => state.clearAll)
  const setGroupBy = usePolicyFilterStore((state) => state.setGroupBy)

  const active = activeFilterCount(selection)

  /* 문서 경로는 사람이 읽는 이름이 아니다. 제목이 있으면 제목으로 보여 준다. */
  const relabel = (axis: PolicyAxis, value: string, label: string) =>
    axis === 'path' ? (documentsByPath.get(value)?.title ?? label) : label

  return (
    <div className="mb-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {AXES.map((axis) => {
          const options = axisOptions(rows, axis.id)
          const chosen = selection[axis.id] ?? []
          if (options.length === 0) return null

          return (
            <DropdownMenu key={axis.id}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    'gap-1.5 font-normal',
                    chosen.length > 0 && 'border-accent/50 bg-accent-subtle',
                  )}
                >
                  {axis.label}
                  {chosen.length > 0 ? (
                    <Badge variant="default" className="px-1.5 py-0 text-[0.6875rem]">
                      {chosen.length}
                    </Badge>
                  ) : null}
                  <ChevronDownIcon className="size-3.5 text-text-subtle" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="start" className="max-h-80 w-60 overflow-y-auto">
                <DropdownMenuLabel className="text-text-subtle">
                  {axis.label}로 거르기
                </DropdownMenuLabel>
                {options.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={chosen.includes(option.value)}
                    /* 메뉴를 닫지 않는다. 값을 여러 개 고르는 것이 기본 동작이다. */
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => toggle(axis.id, option.value)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {relabel(axis.id, option.value, option.label)}
                    </span>
                    <span className="ml-2 shrink-0 text-xs text-text-subtle">
                      {option.count}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
                {chosen.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => clearAxis(axis.id)}>
                      {axis.label} 선택 해제
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        })}

        <span aria-hidden className="mx-1 h-5 w-px bg-border" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'gap-1.5 font-normal',
                groupBy !== null && 'border-accent/50 bg-accent-subtle',
              )}
            >
              {groupBy === null
                ? '묶지 않음'
                : `${AXES.find((axis) => axis.id === groupBy)?.label}로 묶기`}
              <ChevronDownIcon className="size-3.5 text-text-subtle" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel className="text-text-subtle">
              매트릭스 묶기
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={groupBy === null}
              onCheckedChange={() => setGroupBy(null)}
            >
              묶지 않음
            </DropdownMenuCheckboxItem>
            {AXES.map((axis) => (
              <DropdownMenuCheckboxItem
                key={axis.id}
                checked={groupBy === axis.id}
                onCheckedChange={() => setGroupBy(axis.id)}
              >
                {axis.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {active > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 font-normal text-text-muted"
            onClick={clearAll}
          >
            <XIcon className="size-3.5" />
            필터 지우기
          </Button>
        ) : null}
      </div>

      {/*
        무엇을 숨기고 있는지 늘 말한다. 필터가 켜진 채로 잊히면 "정책이 이것뿐" 이라고
        잘못 읽히고, 그게 정책 검토에서 가장 위험한 오해다.
      */}
      {active > 0 ? (
        <p
          className="text-xs text-text-muted"
          role="status"
          aria-live="polite"
        >
          {rows.length}건 중{' '}
          <span className="font-medium text-text">{visibleCount}건</span>을 보고
          있습니다. 필터 {active}개가 켜져 있습니다.
        </p>
      ) : null}
    </div>
  )
}
