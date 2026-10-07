import type { Metadata } from 'next'
import { WorkflowBuilder } from '@/components/yolanda-review/workflow-builder'

export const metadata: Metadata = {
  title: 'Workflow Builder | EZAgent',
  description: 'Create, confirm, and save reusable workflow configurations.',
}

export default function YolandaBuilderPage() {
  return <WorkflowBuilder />
}
