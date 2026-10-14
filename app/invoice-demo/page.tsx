import type { Metadata } from 'next'
import { AgentEntry } from '@/components/agent/agent-entry'

export const metadata: Metadata = {
  title: '發票整理示範 | EZAgent',
  description: '使用合成資料建立、核對並確認本機發票整理計畫。',
}

export default function InvoiceDemo() { return <AgentEntry view="main-stage" /> }
