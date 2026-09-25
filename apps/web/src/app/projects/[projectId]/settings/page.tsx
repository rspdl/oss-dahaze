import { PlanningSettingsScreen } from '@/features/planning/planning-settings-screen'

export default async function ProjectSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return <PlanningSettingsScreen projectId={projectId} />
}
