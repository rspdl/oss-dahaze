import { PlanningWorkspaceScreen } from '@/features/planning/planning-screen'

export default async function ProjectPlanningPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return <PlanningWorkspaceScreen projectId={projectId} />
}
