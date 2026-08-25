'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import type { CompiledDocumentRef } from '@dahaze/api-client'
import { Badge, Button, cn } from '@dahaze/ui'

import {
  SCREEN_OPERATION_LABELS,
  TYPE_LABELS,
  type FieldGroup,
} from '@/shared/rspdl/policies'
import { documentHref } from '@/features/navigation/views'
import { EffectBadge } from './policy-matrix'

/**
 * 필드 중심 뷰. 정책 한 줄 옆에 **그 정책이 걸리는 맥락**을 함께 둔다.
 *
 * 매트릭스는 정책끼리 비교하는 데 좋지만, "이 필드를 누가 어떻게 다루는가" 를 물을 때는
 * 답이 네 줄에 흩어진다. 여기서는 필드가 기준이고 정책·제약·화면·계산이 그 아래 모인다 —
 * 문서에서는 서로 다른 문단에 있던 것들이다.
 *
 * 맥락은 전부 컴파일러가 준 값이다. 제약은 `left · operator · right` 세 조각 그대로 두고
 * 문장으로 지어내지 않는다.
 */
export function PolicyFields({
  projectId,
  groups,
  documentsByPath,
}: {
  projectId: string
  groups: FieldGroup[]
  documentsByPath: Map<string, CompiledDocumentRef>
}) {
  return (
    <ul className="divide-y border-y">
      {groups.map((group, index) => (
        <li
          key={group.key}
          className="animate-rise py-5"
          style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
        >
          <FieldCard
            projectId={projectId}
            group={group}
            document={documentsByPath.get(group.path)}
          />
        </li>
      ))}
    </ul>
  )
}

function FieldCard({
  projectId,
  group,
  document,
}: {
  projectId: string
  group: FieldGroup
  document: CompiledDocumentRef | undefined
}) {
  return (
    <article>
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold text-text">
          <span className="text-text-muted">{group.model.name}</span>
          <span aria-hidden className="mx-1.5 text-text-subtle">
            ·
          </span>
          {group.field.name}
        </h3>

        <Badge variant="secondary" className="font-normal">
          {group.field.required ? '필수' : '선택'}{' '}
          {TYPE_LABELS[group.field.typeKind] ?? group.field.typeKind}
        </Badge>

        {document === undefined ? (
          <span className="font-mono text-xs text-text-subtle">{group.path}</span>
        ) : (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs font-normal text-text-subtle"
            asChild
          >
            <Link href={documentHref(projectId, document.id)}>{document.title}</Link>
          </Button>
        )}
      </header>

      {/*
        enum 필드는 "무엇으로 바꿀 수 있는가" 가 곧 정책의 대상이다. 값 목록이 없으면
        `승인 상태를 변경할 수 있다` 가 무엇을 뜻하는지 다른 문서를 열어 봐야 안다.
      */}
      {group.field.enumVariants === null ? null : (
        <p className="mt-1.5 text-xs text-text-muted">
          가능한 값{' '}
          {group.field.enumVariants.map((variant, index) => (
            <span key={variant}>
              {index > 0 ? <span aria-hidden> · </span> : null}
              <span className="text-text">{variant}</span>
            </span>
          ))}
        </p>
      )}

      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-[7rem_1fr]">
        <Facet label="정책">
          <ul className="flex flex-col gap-1.5">
            {group.policies.map((policy) => (
              <li key={policy.id} className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-text">{policy.role.name}</span>
                <span aria-hidden className="text-text-subtle">
                  →
                </span>
                <span className="text-sm text-text-muted">{policy.action.name}</span>
                <EffectBadge effect={policy.effect} />
              </li>
            ))}
          </ul>
        </Facet>

        <Facet label="제약" empty={group.constraints.length === 0}>
          <ul className="flex flex-col gap-1">
            {group.constraints.map((constraint) => (
              <li key={constraint.id} className="text-sm text-text-muted">
                <span className="text-text">{constraint.left}</span>{' '}
                <span className="font-mono">{constraint.operator}</span>{' '}
                <span className="text-text">{constraint.right}</span>
              </li>
            ))}
          </ul>
        </Facet>

        <Facet label="화면" empty={group.screens.length === 0}>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {group.screens.map((touch) => (
              <li
                key={`${touch.screen.id}:${touch.kind}`}
                className="text-sm text-text-muted"
              >
                {touch.screen.name}
                <span className="ml-1 text-xs text-text-subtle">
                  {SCREEN_OPERATION_LABELS[touch.kind] ?? touch.kind}
                </span>
              </li>
            ))}
          </ul>
        </Facet>

        <Facet
          label="계산"
          empty={group.derivedFrom === null && group.recalculates.length === 0}
        >
          <ul className="flex flex-col gap-1 text-sm text-text-muted">
            {group.derivedFrom === null ? null : (
              /* 조사는 앞말에 붙는다. `{...} 에서` 로 띄우면 한국어가 아니게 읽힌다. */
              <li>
                <span className="text-text">{group.derivedFrom.join(', ')}</span>
                에서 계산됨
              </li>
            )}
            {group.recalculates.length === 0 ? null : (
              <li>
                바뀌면 <span className="text-text">{group.recalculates.join(', ')}</span>{' '}
                재계산
              </li>
            )}
          </ul>
        </Facet>
      </dl>
    </article>
  )
}

/**
 * 맥락 한 줄. 비어 있어도 **자리를 지운다.**
 *
 * `제약 —` 처럼 빈 줄을 남기면 필드마다 같은 빈칸이 반복돼 목록이 길어지기만 한다. 없는
 * 것은 없는 대로 두고, 있는 것만 눈에 걸리게 한다.
 */
function Facet({
  label,
  children,
  empty = false,
}: {
  label: string
  children: ReactNode
  empty?: boolean
}) {
  if (empty) return null

  return (
    <>
      <dt className={cn('text-xs text-text-subtle sm:pt-0.5')}>{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}
