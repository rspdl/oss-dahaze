import { FlowViewScreen } from '@/features/boards/flow-view-screen'

export default async function ProjectScreenFlowPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <FlowViewScreen projectId={projectId} />
}
