'use client'

import Link from 'next/link'
import { useState } from 'react'
import { LocalAiSetup } from '@/components/local-ai-setup'
import { WorkflowComparisonBanner } from '@/components/workflow-comparison-banner'
import AgentWorkspace from './agent-workspace'

export function AgentEntry({ view }: { view: 'main-stage' | 'normal-llm' }) {
  const [ready, setReady] = useState(false)
  return <main className="min-h-screen bg-white text-zinc-950">
    <div className={`mx-auto px-6 py-6 ${view === 'main-stage' ? 'max-w-[1840px]' : 'max-w-4xl'}`}>
      <Link href="/" className="mb-4 inline-block text-sm underline">回首頁</Link>
      {view === 'main-stage' && <><div className="mb-5"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Invoice demo</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] sm:text-[28px]">發票整理示範</h1><p className="mt-2 text-sm text-zinc-600">使用合成資料核對計畫；確認前不會開始處理。</p></div><WorkflowComparisonBanner locale="zh-Hant" /></>}
      <details open={!ready} className={view === 'main-stage' ? 'mx-auto mt-5 max-w-4xl' : ''}><summary className="mb-3 cursor-pointer text-sm font-medium">{ready ? "本機 AI 已準備好 · 查看設定" : "準備本機 AI"}</summary><LocalAiSetup onReady={setReady} showDemoLink={false} /></details>
    </div>
    {ready ? <AgentWorkspace view={view} showMainStageHeader={false} /> : <p className="mx-auto max-w-4xl px-6 pb-8 text-sm text-zinc-600">完成上方準備後，即可{view === 'main-stage' ? '使用示範發票' : '開始對話'}。</p>}
  </main>
}
