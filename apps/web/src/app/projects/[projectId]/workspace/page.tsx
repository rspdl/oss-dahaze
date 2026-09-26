import { WorkspaceScreen } from '@/features/workspace/workspace-screen'

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <WorkspaceScreen projectId={projectId} />
}
