'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { LocalAiSetup } from '@/components/local-ai-setup'
import { HostedDemoGate, type HostedDemoInfo } from '@/components/demo/hosted-demo-gate'
import { WorkflowComparisonBanner } from '@/components/workflow-comparison-banner'
import { isHostedDemoHostname } from '@/lib/demo-host'
import AgentWorkspace from './agent-workspace'

function HostedInvoiceHeader({ demo }: { demo: HostedDemoInfo }) {
  return <>
    <div className="mb-5"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Hosted invoice demo · Mac mini</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] sm:text-[28px]">發票整理示範</h1><p className="mt-2 text-sm text-zinc-600">載入 CSV／TXT → 建立計畫 → 核對並確認 → 執行 → 檢視結果。確認前不會開始處理。</p></div>
    <aside role="note" aria-label="線上示範資料說明" className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
      <p className="font-semibold">線上示範 · 僅限合成資料</p>
      <p className="mt-1">選取的 CSV／TXT 會送到 Mac mini 上的 EZAgent 示範服務。請勿上傳真實客戶文件、個人資料或機密資料；前端提示不取代服務端存取控制或資料隔離。</p>
      <p className="mt-1 text-xs">目前沒有自助刪除功能。資料保留與備份方式請參閱示範資料政策；Run、來源及結果可能留在服務端。</p>
      {demo.dataPolicyUrl && <a href={demo.dataPolicyUrl} className="mt-1 inline-block text-xs font-semibold underline underline-offset-2">開啟示範資料政策</a>}
      {demo.requestLimits && <p className="mt-1 text-xs">每次最多 {Math.floor(demo.requestLimits.maxRequestBytes / 1024)} KiB；模型同時處理上限 {demo.requestLimits.maxConcurrentModelCalls}；每位訪客每日上限 {demo.requestLimits.maxCallsPerVisitorPerUtcDay} 次。計畫採受限佇列處理，執行仍需你確認。</p>}
    </aside>
    <WorkflowComparisonBanner locale="zh-Hant" />
    <div className="mx-auto mt-7 max-w-4xl border-t border-zinc-200 pt-6"><h2 data-invoice-operation-title className="text-xl font-semibold tracking-[-0.02em]">開始發票整理</h2></div>
  </>
}

export function AgentEntry({ view }: { view: 'main-stage' | 'normal-llm' }) {
  const [ready, setReady] = useState(false)
  const [hostedDemo, setHostedDemo] = useState<boolean | null>(null)
  const [authorizedDemo, setAuthorizedDemo] = useState<HostedDemoInfo | null>(null)
  useEffect(() => { setHostedDemo(isHostedDemoHostname(window.location.hostname)) }, [])
  const authorizeHostedDemo = useCallback((info: HostedDemoInfo) => setAuthorizedDemo(info), [])

  const localContent = <>
    {view === 'main-stage' ? <>
      <div className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Invoice demo · 合成資料</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] sm:text-[28px]">發票整理示範</h1>
        <p className="mt-2 text-sm text-zinc-600">載入 CSV／TXT → 建立計畫 → 核對並確認 → 執行 → 檢視結果。確認前不會開始處理。</p>
        <p className="mt-3 text-sm text-zinc-600">想查看獨立審批流程？<Link href="/yolanda-review" className="ml-1 font-semibold text-zinc-900 underline underline-offset-4 hover:text-zinc-600 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950">開啟審批示範</Link><span className="ml-2 text-xs text-zinc-500">合成資料示範，不會接續目前 Run。</span></p>
      </div>
      <WorkflowComparisonBanner locale="zh-Hant" />
      <div className="mx-auto mt-7 max-w-4xl border-t border-zinc-200 pt-6"><h2 data-invoice-operation-title className="text-xl font-semibold tracking-[-0.02em]">開始發票整理</h2></div>
    </> : <div className="mb-5"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">對話工作區</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em]">本機 AI 對話</h1><p className="mt-2 text-sm text-zinc-600">準備本機模型後開始對話；訊息會交由這部電腦上的本機 AI 服務處理。</p></div>}
    <details open={!ready} className={view === 'main-stage' ? 'mx-auto mt-4 max-w-4xl' : ''}><summary className="mb-3 cursor-pointer text-sm font-medium">{ready ? '本機 AI 已準備好 · 查看或更換模型' : '準備本機 AI'}</summary><LocalAiSetup onReady={setReady} showDemoLink={false} /></details>
  </>

  return <main className="min-h-screen bg-white text-zinc-950">
    <div className={`mx-auto px-6 py-6 ${view === 'main-stage' ? 'max-w-[1840px]' : 'max-w-4xl'}`}>
      <nav aria-label="主要導覽" className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"><Link href="/" className="rounded underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950">回首頁</Link><span aria-hidden="true" className="text-zinc-400">/</span><span aria-current="page" className="font-medium text-zinc-700">{hostedDemo === null ? '檢查服務狀態…' : view === 'main-stage' ? '發票示範' : hostedDemo ? '線上聊天說明' : '本機 AI 對話'}</span></nav>
      {hostedDemo === null
        ? <p role="status" className="mx-auto max-w-3xl rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">正在判斷服務環境…</p>
        : hostedDemo
          ? view === 'normal-llm'
            ? <section className="mx-auto max-w-3xl rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-950"><h1 className="text-xl font-semibold">線上示範不提供聊天</h1><p className="mt-2 text-sm leading-6">聊天只在已準備本機 AI 的本機版提供。此線上頁不會接受或傳送聊天訊息；本機模型準備 API 也不會在遠端執行。</p></section>
            : authorizedDemo
              ? <HostedInvoiceHeader demo={authorizedDemo} />
              : <HostedDemoGate onAuthorized={authorizeHostedDemo} />
          : localContent}
    </div>
    {hostedDemo === true && view === 'main-stage' && authorizedDemo && <AgentWorkspace view="main-stage" hostedDemo={authorizedDemo} />}
    {hostedDemo === false && (ready ? <AgentWorkspace view={view} /> : <p role="status" className="mx-auto max-w-4xl px-6 pb-8 text-sm text-zinc-600">完成上方準備後，即可{view === 'main-stage' ? '載入示範發票並建立計畫' : '開始對話'}。模型尚未就緒時，工作區會保持關閉。</p>)}
  </main>
}
