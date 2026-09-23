import { PlanningWorkspaceScreen } from '@/features/planning/planning-screen'
import { parsePlanningSubject } from '@/features/planning/planning-subject'

export default async function ProjectPlanningPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { projectId } = await params
  return <PlanningWorkspaceScreen projectId={projectId} initialSubject={parsePlanningSubject(await searchParams)} />
}
