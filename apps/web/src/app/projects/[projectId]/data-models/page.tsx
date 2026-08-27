import { DataModelViewScreen } from '@/features/data-models/data-model-view-screen'

export default async function ProjectDataModelsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <DataModelViewScreen projectId={projectId} />
}
