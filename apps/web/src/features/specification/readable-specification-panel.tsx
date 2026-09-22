'use client'

import * as React from 'react'
import { cn } from '@dahaze/ui'

import {
  findReadableElement,
  findReadableScreen,
  sourceExcerpt,
  type NamedSpecificationRef,
  type ReadableElement,
  type ReadableField,
  type ReadableOutcome,
  type ReadablePath,
  type ReadablePermission,
  type ReadableScreen,
  type ReadableSpecification,
  type SourceReference,
  type SpecificationState,
} from './readable-specification'

export interface ReadableSpecificationPanelProps {
  specification: ReadableSpecification
  screenKey?: string
  elementId?: string
  elementPath?: string
  className?: string
}

const OPERATION_LABELS: Record<string, string> = { create: '생성', read: '조회', update: '수정', delete: '삭제', input: '입력' }
const OUTCOME_LABELS: Record<string, string> = { success: '성공', failure: '실패', cancel: '취소', timeout: '시간 초과' }
const HANDLER_LABELS: Record<string, string> = { state: '화면 상태', message: '메시지', popup: '팝업', loading: '로딩' }
const RECOVERY_LABELS: Record<string, string> = { retry: '재시도', return: '돌아가기', release: '해제' }
const VERIFICATION_LABELS: Record<string, string> = { allowed: '허용 확인', denied: '금지 확인', unknown: '확인 불가', verified: '데이터 출처 연결 확인' }
const TYPE_LABELS: Record<string, string> = { string: '문자열', integer: '정수', decimal: '소수', boolean: '참거짓', enum: '선택값', date: '날짜', time: '시각', date_time: '날짜와 시각', currency: '금액' }

export function ReadableSpecificationPanel({
  specification,
  screenKey,
  elementId,
  elementPath,
  className,
}: ReadableSpecificationPanelProps) {
  if (specification.state !== 'present') {
    return <StateNotice state={specification.state} subject="기능명세" className={className} />
  }
  const screen = findReadableScreen(specification, screenKey)
  const element = findReadableElement(screen, elementId, elementPath)
  return (
    <section className={cn('space-y-4', className)} aria-label="읽기 쉬운 기능명세">
      {specification.identity === null ? null : (
        <div className="rounded-control border bg-surface-raised/50 px-3 py-2 text-xs text-text-muted">
          <p>스냅샷 {specification.identity.snapshotVersion} · 프로젝트 버전 {specification.identity.projectRevision}</p>
          <p className="font-mono text-[11px] text-text-subtle">source {specification.identity.sourceHash}</p>
        </div>
      )}
      {screen === null ? <AllSpecification specification={specification} /> : <ScreenSpecification screen={screen} selectedElement={element} />}
      <ProjectStatus specification={specification} />
    </section>
  )
}

function ProjectStatus({ specification }: { specification: ReadableSpecification }) {
  return <>
    <FactSection title="컴파일러 진단" state={specification.diagnosticsState} empty="컴파일러가 보고한 진단이 없습니다.">
      {specification.diagnostics.map((diagnostic, index) => <article key={`${diagnostic.path}:${diagnostic.ruleId}:${index}`} className="rounded-control border px-3 py-2 text-xs"><div className="flex items-center justify-between gap-2"><p className="font-medium text-text">{diagnostic.message ?? diagnostic.messageKey}</p><span className="text-[10px] text-text-subtle">{diagnostic.severity}</span></div><p className="mt-1 font-mono text-[10px] text-text-subtle">{diagnostic.ruleId} · {diagnostic.messageKey}</p>{Object.keys(diagnostic.arguments).length === 0 ? null : <p className="mt-1 break-all text-text-muted">{JSON.stringify(diagnostic.arguments)}</p>}<SourceDetails source={diagnostic.source} /></article>)}
    </FactSection>
    <FactSection title="사람과 AI의 남은 맥락" state={specification.context.length === 0 ? 'absent' : 'present'} empty="보류 결정, 확인 질문, 검증 미지원 제안이 없습니다.">
      {specification.context.map((item) => <article key={`${item.kind}:${item.id}`} className="border-l-2 pl-3 text-xs"><p className="font-medium text-text">{item.kind === 'deferred' ? '보류 결정' : item.kind === 'question' ? '확인 질문' : '검증 미지원 제안'} · {item.title}</p>{item.content ? <p className="mt-1 text-text-muted">{item.content}</p> : null}<p className="mt-1 text-[10px] text-text-subtle">컴파일러 판정이 아닌 기획 맥락</p></article>)}
    </FactSection>
  </>
}

function AllSpecification({ specification }: { specification: ReadableSpecification }) {
  return <>
    <FactSection title="화면별 기능" state={specification.screensState} empty="선언된 화면이 없습니다.">
      {specification.screens.map((screen) => <ScreenSummary key={screen.key} screen={screen} />)}
    </FactSection>
    <FactSection title="데이터 모델" state={specification.modelsState} empty="선언된 데이터 모델이 없습니다.">
      {specification.models.map((model) => <article key={model.key} className="rounded-control border px-3 py-2"><p className="text-sm font-medium">{model.name}</p><p className="font-mono text-[11px] text-text-subtle">{model.id}</p><div className="mt-2 space-y-2">{model.fields.map((field) => <FieldFacts key={field.id} field={field} />)}</div><SourceDetails source={model.source} /></article>)}
    </FactSection>
  </>
}

function ScreenSpecification({ screen, selectedElement }: { screen: ReadableScreen; selectedElement: ReadableElement | null }) {
  return <>
    <section>
      <p className="text-[11px] font-medium tracking-[0.12em] text-text-subtle">화면 기능명세</p>
      <h4 className="mt-1 text-base font-semibold text-text">{screen.name}</h4>
      <p className="font-mono text-[11px] text-text-subtle">{screen.id}{screen.kind === null ? '' : ` · ${screen.kind}`}</p>
      <DefinitionList rows={[
        ['역할', screen.roles.length === 0 ? '선언 없음' : screen.roles.map(named).join(', ')],
        ['레이아웃 요소', `${flatten(screen.elements).length}개`],
        ['화면 경로', `${screen.paths.length}개`],
      ]} />
      <SourceDetails source={screen.source} />
    </section>

    <FactSection title="화면이 다루는 데이터" state={screen.operations.length === 0 ? 'absent' : 'present'} empty="선언된 화면 조작이 없습니다.">
      {screen.operations.map((operation, index) => <article key={`${operation.kind}-${index}`} className="border-l-2 pl-3 text-xs text-text-muted"><p><span className="font-medium text-text">{OPERATION_LABELS[operation.kind] ?? operation.kind}</span> · {named(operation.model)}</p><p className="mt-1 text-text-subtle">{operation.fields.length === 0 ? '필드 전체 또는 필드 미지정' : operation.fields.map(named).join(', ')}</p><SourceDetails source={operation.source} /></article>)}
    </FactSection>

    {selectedElement === null ? <ElementIndex elements={screen.elements} /> : <ElementSpecification element={selectedElement} />}

    <FactSection title="화면 권한 검증" state={screen.permissions.length === 0 ? 'absent' : 'present'} empty="이 화면에 연결된 권한 검증이 선언되지 않았습니다.">
      {screen.permissions.map((permission, index) => <PermissionFacts key={index} permission={permission} />)}
    </FactSection>
  </>
}

function ScreenSummary({ screen }: { screen: ReadableScreen }) {
  return <article className="rounded-control border px-3 py-2"><div className="flex items-baseline justify-between gap-2"><p className="text-sm font-medium">{screen.name}</p><span className="text-[11px] text-text-subtle">{screen.operations.length}개 조작 · {screen.paths.length}개 경로</span></div><p className="font-mono text-[11px] text-text-subtle">{screen.id}</p><div className="mt-2 flex flex-wrap gap-1">{screen.operations.map((operation, index) => <span key={index} className="rounded-full border px-2 py-0.5 text-[11px] text-text-muted">{OPERATION_LABELS[operation.kind] ?? operation.kind} · {operation.model.name}</span>)}</div></article>
}

function ElementIndex({ elements }: { elements: ReadableElement[] }) {
  const flat = flatten(elements)
  return <FactSection title="화면 요소" state={flat.length === 0 ? 'absent' : 'present'} empty="레이아웃 요소가 없습니다.">
    {flat.map((element) => <article key={element.key} className="border-l-2 pl-3 text-xs"><p className="font-medium text-text">{elementLabel(element)}</p><p className="font-mono text-[11px] text-text-subtle">{element.id ?? element.path}</p>{element.recognized ? null : <p className="mt-1 text-diagnostic-warning">이 요소 종류는 아직 읽어 표시할 수 없습니다: {element.kind}</p>}</article>)}
  </FactSection>
}

function ElementSpecification({ element }: { element: ReadableElement }) {
  return <section className="rounded-panel border bg-surface-raised/30 p-3">
    <p className="text-[11px] font-medium tracking-[0.12em] text-text-subtle">선택한 요소</p>
    <h5 className="mt-1 text-sm font-semibold">{elementLabel(element)}</h5>
    <p className="font-mono text-[11px] text-text-subtle">{element.id ?? element.path}</p>
    {!element.recognized ? <p className="mt-2 text-xs text-diagnostic-warning">컴파일 결과에는 존재하지만 이 요소 종류를 아직 해석하지 못합니다: {element.kind}</p> : null}
    {element.kind === 'button' ? <ButtonFacts element={element} /> : null}
    {element.kind === 'input' || element.kind === 'list' ? <DataElementFacts element={element} /> : null}
    {element.kind !== 'button' && element.kind !== 'input' && element.kind !== 'list' ? <DefinitionList rows={[["종류", element.kind], ["내용", element.text ?? element.name ?? '선언 없음']]} /> : null}
    <SourceDetails source={element.source} />
  </section>
}

function ButtonFacts({ element }: { element: ReadableElement }) {
  const typedPaths = element.paths.filter((path) => path.outcomeId !== null)
  const legacyPaths = element.paths.filter((path) => path.outcomeId === null)
  return <div className="mt-3 space-y-4">
    <DefinitionList rows={[
      ['행동', element.action === null ? '선언 없음' : named(element.action)],
      ['검증 가능한 조건', '선언 없음'],
      ['결과 계약', element.outcomes.length === 0 ? '선언 없음' : `${element.outcomes.length}개`],
    ]} />
    {element.outcomes.length === 0 ? <p className="text-xs text-text-subtle">typed 행동 결과가 선언되지 않았습니다. 기존 경로는 계속 보이지만 결과별 처리 보장은 확인되지 않습니다.</p> : element.outcomes.map((outcome) => <OutcomeFacts key={outcome.id} outcome={outcome} paths={typedPaths.filter((path) => path.outcomeId === outcome.id)} />)}
    {legacyPaths.length === 0 ? null : <div><p className="text-xs font-medium">결과 미연결 경로</p><div className="mt-2 space-y-2">{legacyPaths.map((path, index) => <PathFacts key={index} path={path} />)}</div></div>}
    <FactSection title="버튼 권한" state={element.permissions.length === 0 ? 'absent' : 'present'} empty="이 버튼의 행동에 연결된 화면 권한 검증이 없습니다.">
      {element.permissions.map((permission, index) => <PermissionFacts key={index} permission={permission} />)}
    </FactSection>
  </div>
}

function OutcomeFacts({ outcome, paths }: { outcome: ReadableOutcome; paths: ReadablePath[] }) {
  const exception = outcome.kind === 'failure' || outcome.kind === 'cancel' || outcome.kind === 'timeout'
  return <article className={cn('rounded-control border px-3 py-2', exception && 'border-diagnostic-warning/50')}>
    <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold">{OUTCOME_LABELS[outcome.kind] ?? outcome.kind} · {outcome.localId}</p><span className="font-mono text-[10px] text-text-subtle">{outcome.id}</span></div>
    <div className="mt-2 space-y-2">{paths.length === 0 ? <p className="text-xs text-text-subtle">이 결과에 연결된 화면 이동 또는 같은 화면 처리가 없습니다.</p> : paths.map((path, index) => <PathFacts key={index} path={path} />)}</div>
    {outcome.providedData.length === 0 ? null : <div className="mt-3"><p className="text-xs font-medium">제공 데이터</p>{outcome.providedData.map((data, index) => <div key={index} className="mt-1 text-xs text-text-muted"><p>{named(data.model)}.{named(data.field)} ← {data.sourceLabel} · {VERIFICATION_LABELS[data.verification] ?? data.verification}</p>{data.prerequisiteFields.length === 0 ? null : <p className="text-text-subtle">선행 입력 · {data.prerequisiteFields.map(named).join(', ')}</p>}<p className="text-[10px] text-text-subtle">이 표시는 데이터 출처 연결에만 해당하며 화면 경로 전체 검증을 뜻하지 않습니다.</p></div>)}</div>}
    {outcome.recovery === null ? null : <p className="mt-3 text-xs text-text-muted">복구 · {RECOVERY_LABELS[outcome.recovery.kind] ?? outcome.recovery.kind}{outcome.recovery.screen ? ` · ${named(outcome.recovery.screen)}` : ''}{outcome.recovery.elementId ? `.${outcome.recovery.elementId}` : ''}{outcome.recovery.action ? ` · ${named(outcome.recovery.action)}` : ''}{outcome.recovery.pathId ? ` · 경로 ${outcome.recovery.pathId}` : ''}</p>}
    <SourceDetails source={outcome.source} />
  </article>
}

function PathFacts({ path }: { path: ReadablePath }) {
  return <div className="border-l-2 pl-3 text-xs text-text-muted">
    <p>{path.targetScreen ? `이동 · ${named(path.targetScreen)}` : path.handler ? `${HANDLER_LABELS[path.handler.kind] ?? path.handler.kind}${path.handler.id ? ` · ${path.handler.id}` : ''}${path.handler.content ? ` · ${path.handler.content}` : ''}` : '처리 대상 선언 없음'}</p>
    {path.label === null ? null : <p className="mt-1 text-text-subtle">표시 설명 · {path.label} <span className="text-[10px]">(실행 조건으로 해석하지 않음)</span></p>}
    {path.rawCondition === null ? null : <p className="mt-1 break-all text-diagnostic-warning">조건 원문 · {path.rawCondition} · 현재 해석 미지원</p>}
    <SourceDetails source={path.source} />
  </div>
}

function DataElementFacts({ element }: { element: ReadableElement }) {
  return <div className="mt-3 space-y-3">
    {element.model === null ? null : <p className="text-xs text-text-muted">모델 · {named(element.model)}</p>}
    {element.fields.length === 0 ? <p className="text-xs text-text-subtle">연결된 필드가 없습니다.</p> : element.fields.map((field) => <FieldFacts key={field.id} field={field} />)}
  </div>
}

function FieldFacts({ field }: { field: ReadableField }) {
  return <article className="rounded-control border px-3 py-2 text-xs">
    <p className="font-medium text-text">{field.model.name}.{field.name}</p>
    <p className="mt-1 text-text-muted">{TYPE_LABELS[field.typeKind] ?? field.typeKind} · {field.required ? '필수' : '선택'}{field.enumVariants === null ? '' : ` · ${field.enumVariants.join(', ')}`}</p>
    {!field.resolved ? <p className="mt-1 text-diagnostic-warning">필드 선언을 찾지 못했습니다: {field.id}</p> : null}
    <div className="mt-2"><p className="font-medium text-text">값의 출처</p>{field.provenance.length === 0 ? <p className="mt-1 text-text-subtle">선언된 생산 출처가 없습니다.</p> : field.provenance.map((item) => <div key={item.id} className="mt-1 text-text-muted"><p>{item.sourceLabel} · {item.kind}{item.phase ? ` · ${item.phase}` : ''}{item.verification ? ` · ${VERIFICATION_LABELS[item.verification] ?? item.verification}` : ''}</p>{item.rawCondition ? <p className="break-all text-diagnostic-warning">조건 원문 · {item.rawCondition} · 현재 해석 미지원</p> : null}</div>)}</div>
    <div className="mt-2"><p className="font-medium text-text">데이터 제약</p>{field.constraints.length === 0 ? <p className="mt-1 text-text-subtle">선언된 데이터 제약이 없습니다.</p> : field.constraints.map((constraint) => <p key={constraint.id} className="mt-1 text-text-muted">{constraint.left} {constraint.operator} {constraint.right}</p>)}</div>
    <SourceDetails source={field.source} />
  </article>
}

function PermissionFacts({ permission }: { permission: ReadablePermission }) {
  return <article className="border-l-2 pl-3 text-xs text-text-muted"><p>{named(permission.role)} · {named(permission.action)} · {named(permission.model)}{permission.field ? `.${named(permission.field)}` : ''}</p><p className="mt-1 font-medium text-text">{VERIFICATION_LABELS[permission.verification] ?? permission.verification}</p>{permission.rawCondition ? <p className="mt-1 break-all text-diagnostic-warning">조건 원문 · {permission.rawCondition} · 현재 해석 미지원</p> : null}<SourceDetails source={permission.source} /></article>
}

function FactSection({ title, state, empty, children }: { title: string; state: SpecificationState; empty: string; children: React.ReactNode }) {
  return <section><h5 className="text-xs font-semibold text-text">{title}</h5>{state === 'present' ? <div className="mt-2 space-y-3">{children}</div> : <StateNotice state={state} subject={empty} className="mt-2" />}</section>
}

function StateNotice({ state, subject, className }: { state: SpecificationState; subject: string; className?: string }) {
  const message = state === 'uncompiled' ? '저장된 컴파일 결과가 없습니다.' : state === 'unsupported' ? '현재 화면이 알지 못하는 컴파일 결과 모양입니다.' : subject
  return <p className={cn('text-xs text-text-subtle', state === 'unsupported' && 'text-diagnostic-warning', className)}>{message}</p>
}

function SourceDetails({ source }: { source: SourceReference }) {
  const excerpt = sourceExcerpt(source)
  return <details className="mt-2"><summary className="cursor-pointer text-[11px] text-text-subtle">원문 · {source.path || '경로 없음'}</summary>{excerpt === null ? <p className="mt-1 text-[11px] text-diagnostic-warning">이 명세와 같은 버전의 원문을 찾지 못했습니다.</p> : <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-control border bg-surface px-2 py-1.5 text-[11px] text-text-muted">{excerpt}</pre>}</details>
}

function DefinitionList({ rows }: { rows: [string, string][] }) {
  return <dl className="mt-3 grid gap-1.5 text-xs">{rows.map(([term, value]) => <div key={term} className="grid grid-cols-[7rem_1fr] gap-2"><dt className="text-text-subtle">{term}</dt><dd className="text-text-muted">{value}</dd></div>)}</dl>
}

function named(value: NamedSpecificationRef): string { return value.resolved ? value.name : `${value.name} (이름 확인 불가)` }
function flatten(elements: readonly ReadableElement[]): ReadableElement[] { return elements.flatMap((element) => [element, ...flatten(element.children)]) }
function elementLabel(element: ReadableElement): string { return element.name ?? element.text ?? element.fields[0]?.name ?? element.model?.name ?? element.kind }
