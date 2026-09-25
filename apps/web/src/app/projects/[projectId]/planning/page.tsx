import { PlanningReviewScreen } from '@/features/planning/planning-screen'
import { parsePlanningSubject } from '@/features/planning/planning-subject'

export default async function ProjectPlanningPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { projectId } = await params
  const query = await searchParams
  const draft = typeof query.draft === 'string' && query.draft !== '' ? query.draft : undefined
  return <PlanningReviewScreen projectId={projectId} initialSubject={parsePlanningSubject(query)} initialDraftId={draft} />
}
