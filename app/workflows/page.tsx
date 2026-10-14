import type { Metadata } from 'next'
import { WorkflowBuilder } from '@/components/yolanda-review/workflow-builder'

export const metadata: Metadata = {
  title: 'Workflow Library | EZAgent',
  description: 'Open workflow configurations saved in this browser.',
}

export default function WorkflowLibraryPage() {
  return <WorkflowBuilder initialView="library" />
}
