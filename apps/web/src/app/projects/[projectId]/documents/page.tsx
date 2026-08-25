import { DocumentsViewScreen } from '@/features/documents/documents-view-screen'

export default async function ProjectDocumentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  return <DocumentsViewScreen projectId={projectId} />
}
