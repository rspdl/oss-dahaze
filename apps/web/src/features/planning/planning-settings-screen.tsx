'use client'

import {
  useCompileProject,
  useGetPlanningState,
  useListPlanningMetadataHistory,
  usePatchPlanningMetadata,
  useUndoPlanningMetadata,
  type PlanningMetadataRevisionResponse,
  type PlanningStateResponse,
  type ProjectCompileResponse,
} from '@dahaze/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { ErrorState, Skeleton, toast } from '@dahaze/ui'

import { RequireSession } from '../auth/require-session'
import { errorMessage } from '../../shared/api/errors'
import { AppShell, Crumb } from '../../shared/ui/app-shell'
import { toMetadataCatalog } from './metadata-catalog'
import { MetadataEditor } from './metadata-editor'

/**
 * 설정. 사용 환경과 샘플 데이터.
 *
 * 둘 다 RSPDL 밖에 사는 dahaze 의 값이다 — 화면 크기와 가상 데이터는 명세가 아니다. 그래서
 * 컴파일러 게이트를 지나지 않고 바로 저장·되돌리기 한다. 자주 바꾸는 값이 아니라 판단할
 * 항목 사이에 둘 이유가 없다.
 */
export function PlanningSettingsScreen({ projectId }: { projectId: string }) {
  return <AppShell breadcrumb={<Crumb>설정</Crumb>}><RequireSession><SettingsLoader projectId={projectId} /></RequireSession></AppShell>
}

function SettingsLoader({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const state = useGetPlanningState<PlanningStateResponse>(projectId)
  const compilation = useCompileProject<ProjectCompileResponse>(projectId)
  const history = useListPlanningMetadataHistory<PlanningMetadataRevisionResponse[]>(projectId, { limit: 100 })
  const patchMetadata = usePatchPlanningMetadata()
  const undoMetadata = useUndoPlanningMetadata()

  if (state.isPending || history.isPending) return <div className="flex flex-col gap-3"><Skeleton className="h-8 w-32" /><Skeleton className="mt-6 h-64 w-full" /></div>
  if (state.error !== null || history.error !== null) return <ErrorState title="설정을 불러오지 못했습니다" description={errorMessage(state.error ?? history.error)} />

  const refresh = () => queryClient.invalidateQueries()
  const revision = state.data.revision

  return <div className="w-full max-w-4xl pb-10">
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">설정</h1>
      <p className="mt-1.5 text-sm text-text-muted">사용 환경과 샘플 데이터는 명세가 아니라 화면을 그리고 체험하는 데 쓰는 값입니다. 저장하면 바로 반영되고 되돌릴 수 있습니다.</p>
    </header>
    <div className="border-t">
      <MetadataEditor metadata={state.data.metadata} metadataRevision={state.data.metadata_revision} catalog={toMetadataCatalog(compilation.data)} history={history.data} busy={patchMetadata.isPending || undoMetadata.isPending} onSave={async (metadata, summary) => { try { const result = await patchMetadata.mutateAsync({ projectId, data: { expected_revision: revision, environments: metadata.environments, sample_data: metadata.sample_data, summary } }); await refresh(); toast.success('환경과 샘플 데이터를 저장했습니다'); return result.metadata_revision } catch (error) { toast.error('메타데이터를 저장하지 못했습니다', { description: errorMessage(error) }); return null } }} onUndo={(targetRevision) => undoMetadata.mutate({ projectId, data: { expected_revision: revision, target_revision: targetRevision } }, { onSuccess: async () => { await refresh(); toast.success('메타데이터 전체를 선택한 리비전으로 되돌렸습니다') }, onError: (error) => toast.error('되돌리지 못했습니다', { description: errorMessage(error) }) })} />
    </div>
  </div>
}
