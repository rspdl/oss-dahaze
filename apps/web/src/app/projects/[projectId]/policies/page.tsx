import { PolicyReviewScreen } from '@/features/policies/policy-review-screen'

export default async function ProjectPoliciesPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <PolicyReviewScreen projectId={projectId} />
}
