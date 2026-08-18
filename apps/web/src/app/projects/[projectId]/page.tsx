import { ProjectScreen } from '@/features/projects/project-screen'

/**
 * Next 16 에서 `params` 는 Promise 다. 라우트가 하는 일은 그것을 풀어 feature 에 넘기는
 * 것뿐이다 — 데이터는 클라이언트에서 세션 쿠키로 가져오므로 여기서 가져올 수 없다.
 */
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <ProjectScreen projectId={projectId} />
}
