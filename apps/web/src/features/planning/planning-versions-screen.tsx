'use client'

import { useState } from 'react'
import {
  useCaptureProjectSnapshot,
  useGetPlanningState,
  useGetProjectSnapshot,
  useListProjectSnapshots,
  useRestoreProjectSnapshot,
  type PlanningStateResponse,
  type ProjectSnapshotResponse,
  type ProjectSnapshotSummaryResponse,
} from '@dahaze/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { Button, ErrorState, Skeleton, cn, toast } from '@dahaze/ui'

import { RequireSession } from '../auth/require-session'
import { errorMessage } from '../../shared/api/errors'
import { formatDateTime } from '../../shared/format'
import { AppShell, Crumb } from '../../shared/ui/app-shell'
import { HandoffInspector } from './handoff-inspector'

/**
 * 버전·전달. 확정된 프로젝트 상태를 되돌리고 개발자에게 넘기는 곳이다.
 *
 * 검토 화면에서 떼어 낸 이유: 버전과 전달본은 판단이 **끝난 뒤**의 일이다. 판단할 항목 옆에
 * 두면 "복원" 버튼이 "채택" 버튼과 같은 무게로 보이는데, 복원은 프로젝트 전체를 바꾼다.
 *
 * 복원은 과거를 지우지 않고 그 상태를 새 버전으로 만든다. 전달본은 만든 뒤 바뀌지 않는다.
 * 두 요청 모두 지금 기준 버전과 원문 해시를 실어 보내, 그 사이 다른 곳에서 바뀌었으면 서버가
 * 거절하게 한다.
 */
export function PlanningVersionsScreen({ projectId }: { projectId: string }) {
  return <AppShell breadcrumb={<Crumb>버전·전달</Crumb>}><RequireSession><VersionsLoader projectId={projectId} /></RequireSession></AppShell>
}

function VersionsLoader({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const state = useGetPlanningState<PlanningStateResponse>(projectId)
  const snapshots = useListProjectSnapshots<ProjectSnapshotSummaryResponse[]>(projectId, { limit: 50, offset: 0 })
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null)
  const [compareVersion, setCompareVersion] = useState<number | null>(null)
  const [summary, setSummary] = useState('')
  const selected = useGetProjectSnapshot<ProjectSnapshotResponse>(projectId, selectedVersion ?? 0, { query: { enabled: selectedVersion !== null } })
  const compare = useGetProjectSnapshot<ProjectSnapshotResponse>(projectId, compareVersion ?? 0, { query: { enabled: compareVersion !== null } })
  const capture = useCaptureProjectSnapshot()
  const restore = useRestoreProjectSnapshot()

  if (state.isPending || snapshots.isPending) return <div className="flex flex-col gap-3"><Skeleton className="h-8 w-40" /><Skeleton className="h-4 w-72" /><Skeleton className="mt-6 h-48 w-full" /></div>
  if (state.error !== null || snapshots.error !== null) return <ErrorState title="버전을 불러오지 못했습니다" description={errorMessage(state.error ?? snapshots.error)} />

  const current = state.data
  const list = snapshots.data
  const refresh = () => queryClient.invalidateQueries()
  const expected = { expected_planning_revision: current.revision, expected_project_revision: current.project_revision, expected_source_hash: current.source_hash }
  const busy = capture.isPending || restore.isPending

  return <div className="w-full max-w-4xl pb-10">
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">버전·전달</h1>
      <p className="mt-1.5 text-sm text-text-muted">현재 프로젝트 버전 {current.project_revision}. 복원하면 과거를 지우지 않고 그 상태를 새 버전으로 만듭니다.</p>
    </header>

    <section aria-label="개발 전달본 만들기" className="border-y py-5">
      <h2 className="text-sm font-semibold">개발 전달본 만들기</h2>
      <p className="mt-1 text-xs text-text-muted">현재 명세와 결정, 사용 환경을 한 버전으로 고정합니다. 만든 뒤에는 바뀌지 않습니다.</p>
      <div className="mt-3 flex gap-2">
        <input aria-label="전달본 요약" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="이번 전달본의 변경 요약" className="h-9 min-w-0 flex-1 rounded-control border bg-surface px-3 text-sm placeholder:text-text-subtle focus-visible:border-accent" />
        <Button disabled={busy} onClick={() => capture.mutate({ projectId, data: { ...expected, summary: summary || null } }, { onSuccess: async (snapshot) => { setSelectedVersion(snapshot.snapshot_version); setSummary(''); await refresh(); toast.success('현재 상태로 전달본을 만들었습니다') }, onError: (error) => toast.error('전달본을 만들지 못했습니다', { description: errorMessage(error) }) })}>현재 상태로 만들기</Button>
      </div>
    </section>

    <section aria-label="프로젝트 버전" className="py-5">
      <h2 className="text-sm font-semibold">프로젝트 버전</h2>
      {list.length === 0 ? <p className="mt-3 text-sm text-text-muted">아직 기록된 버전이 없습니다.</p> : <ul className="mt-3 divide-y border-y">{list.map((snapshot) => <li key={snapshot.snapshot_version} className={cn('flex items-center gap-3 py-2.5', selectedVersion === snapshot.snapshot_version && 'bg-accent-subtle')}>
        <button type="button" onClick={() => { setSelectedVersion(snapshot.snapshot_version); if (compareVersion === snapshot.snapshot_version) setCompareVersion(null) }} className="min-w-0 flex-1 px-2 text-left">
          <span className="block text-sm font-medium">스냅샷 {snapshot.snapshot_version}</span>
          <span className="block truncate text-xs text-text-subtle">{snapshot.change_kind} · {formatDateTime(snapshot.created_at)} · {snapshot.source_hash.slice(0, 10)}</span>
        </button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => restore.mutate({ projectId, revision: snapshot.snapshot_version, data: expected }, { onSuccess: async () => { await refresh(); toast.success('선택한 버전을 새 프로젝트 버전으로 복원했습니다') }, onError: (error) => toast.error('버전을 복원하지 못했습니다', { description: errorMessage(error) }) })}>복원</Button>
      </li>)}</ul>}
    </section>

    {selected.data === undefined ? null : <section aria-label="선택한 버전" className="border-t py-5">
      <label className="block text-xs">비교 버전 <select value={compareVersion ?? ''} onChange={(event) => setCompareVersion(event.target.value === '' ? null : Number(event.target.value))} className="ml-2 rounded border bg-surface px-2 py-1"><option value="">선택 안 함</option>{list.filter((entry) => entry.snapshot_version !== selectedVersion).map((entry) => <option key={entry.snapshot_version} value={entry.snapshot_version}>스냅샷 {entry.snapshot_version}</option>)}</select></label>
      <HandoffInspector snapshot={selected.data} compare={compare.data} />
    </section>}
  </div>
}
