import { PlanningVersionsScreen } from '@/features/planning/planning-versions-screen'

export default async function ProjectVersionsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return <PlanningVersionsScreen projectId={projectId} />
}
