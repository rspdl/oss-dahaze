import { IaViewScreen } from '@/features/boards/ia-view-screen'

export default async function ProjectIaPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <IaViewScreen projectId={projectId} />
}
