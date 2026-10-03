import type { Metadata } from 'next'
import { ReviewWorkbench } from '@/components/yolanda-review/review-workbench'

export const metadata: Metadata = {
  title: 'Review & Approval | EZAgent',
  description: 'Human review and version approval workspace for EZAgent.',
}

export default function YolandaReviewPage() {
  return <ReviewWorkbench />
}
