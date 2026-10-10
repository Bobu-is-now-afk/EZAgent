'use client'

import Link from 'next/link'
import { useState } from 'react'
import { LocalAiSetup } from '@/components/local-ai-setup'
import AgentWorkspace from './agent-workspace'

export function AgentEntry({ view }: { view: 'main-stage' | 'normal-llm' }) {
  const [ready, setReady] = useState(false)
  return <main className="min-h-screen bg-white text-zinc-950">
    <div className="mx-auto max-w-4xl px-6 py-6"><Link href="/" className="mb-4 inline-block text-sm underline">回首頁</Link><details open={!ready}><summary className="mb-3 cursor-pointer text-sm font-medium">{ready ? "本機 AI 已準備好 · 查看設定" : "準備本機 AI"}</summary><LocalAiSetup onReady={setReady} showDemoLink={false} /></details></div>
    {ready ? <AgentWorkspace view={view} /> : <p className="mx-auto max-w-4xl px-6 pb-8 text-sm text-zinc-600">完成上方準備後，即可{view === 'main-stage' ? '使用示範發票' : '開始對話'}。</p>}
  </main>
}
