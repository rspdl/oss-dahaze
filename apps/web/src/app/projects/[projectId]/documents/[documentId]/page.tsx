import { DocumentWorkbenchScreen } from '@/features/documents/document-workbench'

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ projectId: string; documentId: string }>
}) {
  const { projectId, documentId } = await params
  return <DocumentWorkbenchScreen projectId={projectId} documentId={documentId} />
}
