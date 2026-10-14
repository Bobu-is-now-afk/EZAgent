import type { Metadata } from 'next'
import { AgentEntry } from '@/components/agent/agent-entry'

export const metadata: Metadata = {
  title: '本機 AI 對話 | EZAgent',
  description: '準備本機模型後開始對話。',
}

export default function Chat() { return <AgentEntry view="normal-llm" /> }
