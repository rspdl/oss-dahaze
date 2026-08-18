import type { Metadata } from 'next'

import { ProjectListScreen } from '@/features/projects/project-list-screen'

export const metadata: Metadata = { title: '프로젝트 · dahaze' }

export default function ProjectsPage() {
  return <ProjectListScreen />
}
