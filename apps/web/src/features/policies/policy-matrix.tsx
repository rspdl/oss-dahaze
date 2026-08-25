'use client'

import Link from 'next/link'
import { Fragment, useMemo, useState } from 'react'
import type { CompiledDocumentRef } from '@dahaze/api-client'
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@dahaze/ui'

import {
  axisKey,
  groupPolicies,
  indexPoliciesByAxes,
  type PolicyAxis,
  type PolicyRow,
} from '@/shared/rspdl/policies'
import { documentHref } from '@/features/navigation/views'

/**
 * 정책 매트릭스. 네 축(역할 · 모델 · 필드 · 행동)과 효과를 그대로 펼친 표다.
 *
 * 정책에는 이름이 없다 — `역할 × 모델 × 필드 × 행동` 의 조합이 곧 정체성이다. 그래서 이름
 * 열을 만들어 붙이는 대신 축을 그대로 열로 둔다. 문서를 읽을 때는 문장 사이에 흩어져 있던
 * 것이 여기서는 한눈에 비교된다.
 *
 * **판정하지 않는다.** 같은 축에 허용과 금지가 함께 있으면 두 줄을 붙여 놓기만 한다. 거기에
 * 경고 아이콘을 얹는 순간 dahaze 가 컴파일러 노릇을 하는 것이고, rspdl 0.1.0 은 이 경우에
 * 진단을 주지 않는다 (CLAUDE.md — 컴파일러가 유일한 해석자다).
 */
export function PolicyMatrix({
  projectId,
  rows,
  allRows,
  groupBy,
  documentsByPath,
}: {
  projectId: string
  /** 현재 필터를 통과해 표에 보이는 정책. */
  rows: PolicyRow[]
  /** 프로젝트의 필터 전 정책. 같은 조합의 상대가 필터 때문에 사라지지 않게 한다. */
  allRows: PolicyRow[]
  /** 묶을 축. `null` 이면 한 덩어리로 편다. */
  groupBy: PolicyAxis | null
  /** 소스 경로 → 문서. IR 은 문서를 모르므로 이 고리는 서버 응답이 함께 준다. */
  documentsByPath: Map<string, CompiledDocumentRef>
}) {
  const [sortBy, setSortBy] = useState<AxisColumn>('role')

  /*
    묶어도 표는 하나로 둔다. 묶음마다 표를 따로 그리면 열 너비가 제각각이 되어, 묶음을
    가로질러 같은 열을 비교하려는 순간 눈이 자리를 잃는다. 묶음 머리는 표 안의 한 줄이다.
  */
  const sections = useMemo(() => {
    if (groupBy === null) {
      return [{ key: '', label: null, rows: sortRows(rows, sortBy) }]
    }
    return groupPolicies(rows, groupBy).map((group) => ({
      key: group.key,
      label: group.label,
      rows: sortRows(group.rows, sortBy),
    }))
  }, [rows, groupBy, sortBy])

  /* 필터 전 목록을 써야 효과 하나를 숨겨도 비교할 상대의 존재가 사라지지 않는다. */
  const policiesByAxes = useMemo(() => indexPoliciesByAxes(allRows), [allRows])

  return (
    <TooltipProvider delayDuration={150}>
      {/* 작은 화면에서도 열을 문자 단위로 찌그러뜨리지 않고, 표 자체를 가로로 스크롤한다. */}
      <Table className="min-w-[60rem]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {AXIS_COLUMNS.map((column) => (
              <TableHead key={column.id} className="p-0">
                <button
                  type="button"
                  onClick={() => setSortBy(column.id)}
                  aria-pressed={sortBy === column.id}
                  className={cn(
                    'flex h-9 w-full items-center gap-1 px-3 text-left transition-colors duration-200 ease-out-expo hover:text-text',
                    sortBy === column.id && 'font-semibold text-text',
                  )}
                >
                  {column.label}
                </button>
              </TableHead>
            ))}
            <TableHead>효과</TableHead>
            <TableHead>문서</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {sections.map((section) => (
            <Fragment key={section.key}>
            {/*
              묶음 머리도 표 안의 한 줄이다. 묶음마다 표를 따로 그리면 열 너비가 제각각이
              되어, 묶음을 가로질러 같은 열을 비교하려는 순간 눈이 자리를 잃는다.
            */}
              {section.label === null ? null : (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={AXIS_COLUMNS.length + 2}
                    className="bg-surface-raised py-1.5 text-xs font-medium text-text-muted"
                  >
                    {section.label}
                    <span className="ml-2 font-normal text-text-subtle">
                      {section.rows.length}건
                    </span>
                  </TableCell>
                </TableRow>
              )}

              {section.rows.map((row) => {
                const document = documentsByPath.get(row.path)
                const peers = policiesByAxes.get(axisKey(row)) ?? [row]

                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.role.name}</TableCell>
                    <TableCell>{row.model.name}</TableCell>
                    <TableCell>
                      <span>{row.field.name}</span>
                      {row.field.required ? null : (
                        <span className="ml-1.5 text-xs text-text-subtle">선택</span>
                      )}
                    </TableCell>
                    <TableCell>{row.action.name}</TableCell>
                    <TableCell>
                      <EffectBadge effect={row.effect} />
                    {/*
                      같은 축에 줄이 둘 이상이라는 **사실**을 눈에 띄는 중립 표식으로
                      보여준다. 패널도 효과와 문서만 나란히 둘 뿐, 심각도나 판정은 붙이지
                      않는다 — 이것이 문제인지는 기획자가 정한다.
                    */}
                      {peers.length > 1 ? (
                        <SharedAxisPolicies
                          rows={peers}
                          currentRowId={row.id}
                          documentsByPath={documentsByPath}
                        />
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-text-muted">
                      {document === undefined ? (
                        <span className="font-mono">{row.path}</span>
                      ) : (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0"
                          asChild
                        >
                          <Link href={documentHref(projectId, document.id)}>
                            {document.title}
                          </Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </TooltipProvider>
  )
}

function SharedAxisPolicies({
  rows,
  currentRowId,
  documentsByPath,
}: {
  rows: PolicyRow[]
  currentRowId: string
  documentsByPath: Map<string, CompiledDocumentRef>
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="ml-2 border-border-strong bg-surface-raised text-text shadow-xs"
          aria-label={`프로젝트 전체에서 같은 역할, 모델, 필드, 행동으로 선언된 정책 ${rows.length}건 보기`}
        >
          <span aria-hidden>↔</span>
          같은 조합 {rows.length}건
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        className="w-80 max-w-[calc(100vw-2rem)] px-3.5 py-3 text-left text-pretty"
      >
        <p className="font-semibold">같은 조합으로 선언된 정책 {rows.length}건</p>
        <p className="mt-1 leading-relaxed text-surface/75">
          역할·모델·필드·행동이 같습니다. 효과와 출처만 나란히 표시합니다.
        </p>
        <ul className="mt-2.5 space-y-2 border-t border-surface/20 pt-2.5">
          {rows.map((row) => {
            const document = documentsByPath.get(row.path)
            return (
              <li key={`${row.path}:${row.id}`} className="flex items-start gap-2">
                <span className="min-w-10 font-semibold">
                  {row.effect === 'allow' ? '허용' : '✕ 금지'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {document?.title ?? row.path}
                  </span>
                  {document === undefined ? null : (
                    <span className="block truncate font-mono text-[0.6875rem] text-surface/60">
                      {row.path}
                    </span>
                  )}
                </span>
                {row.id === currentRowId ? (
                  <span className="shrink-0 text-surface/60">현재 행</span>
                ) : null}
              </li>
            )
          })}
        </ul>
        <p className="mt-2.5 border-t border-surface/20 pt-2.5 leading-relaxed text-surface/60">
          컴파일러 결과에 원문 위치가 없어 문장 자체는 표시하지 않습니다.
        </p>
      </TooltipContent>
    </Tooltip>
  )
}

/** 허용과 금지를 색으로만 구분하지 않는다. 글자와 기호가 같은 사실을 함께 전한다. */
export function EffectBadge({ effect }: { effect: 'allow' | 'deny' }) {
  return effect === 'allow' ? (
    <Badge variant="outline" className="border-border-strong text-text">
      허용
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="border-diagnostic-error/40 bg-diagnostic-error-subtle text-diagnostic-error"
    >
      ✕ 금지
    </Badge>
  )
}

type AxisColumn = 'role' | 'model' | 'field' | 'action'

const AXIS_COLUMNS: { id: AxisColumn; label: string }[] = [
  { id: 'role', label: '역할' },
  { id: 'model', label: '모델' },
  { id: 'field', label: '필드' },
  { id: 'action', label: '행동' },
]

/**
 * 고른 축을 첫 기준으로 삼고 나머지 축을 고정된 순서로 잇는다.
 *
 * 나머지를 고정하는 것이 중요하다. 기준만 바꾸고 뒤를 흔들면 같은 표를 두 번 봤을 때 줄
 * 순서가 달라져, 방금 본 줄을 다시 찾지 못한다.
 */
function sortRows(rows: PolicyRow[], first: AxisColumn): PolicyRow[] {
  const order: AxisColumn[] = [
    first,
    ...AXIS_COLUMNS.map((column) => column.id).filter((id) => id !== first),
  ]

  return [...rows].sort((a, b) => {
    for (const axis of order) {
      const compared = a[axis].name.localeCompare(b[axis].name, 'ko')
      if (compared !== 0) return compared
    }
    // 같은 축이면 허용을 먼저 둔다. 둘이 붙어 있어야 비교가 된다.
    return a.effect === b.effect ? 0 : a.effect === 'allow' ? -1 : 1
  })
}
