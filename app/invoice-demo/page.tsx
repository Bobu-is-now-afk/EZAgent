import type { Metadata } from 'next'
import { AgentEntry } from '@/components/agent/agent-entry'

export const metadata: Metadata = {
  title: '發票整理示範 | EZAgent',
  description: '使用合成資料預覽發票整理；線上示範僅在服務狀態允許時開放。',
}

export default function InvoiceDemo() { return <AgentEntry view="main-stage" /> }
