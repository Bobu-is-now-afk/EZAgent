import type { Metadata } from 'next'
import { AgentEntry } from '@/components/agent/agent-entry'

export const metadata: Metadata = {
  title: '聊天入口 | EZAgent',
  description: '本機版提供聊天；線上示範目前不提供聊天。',
}

export default function Chat() { return <AgentEntry view="normal-llm" /> }
