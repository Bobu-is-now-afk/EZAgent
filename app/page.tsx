'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Bot, FileText, MessageCircle, Sparkles } from 'lucide-react'
import { LocalAiSetup } from '@/components/local-ai-setup'

export default function Page() {
  const [locale, setLocale] = useState<'zh-Hant' | 'en'>('zh-Hant')
  const en = locale === 'en'
  const cards = [
    { href: '/invoice-demo', icon: FileText, title: en ? 'Try invoice processing' : '試用發票整理', description: en ? 'Load sample invoices, review a plan and download CSV. No file browsing needed.' : '載入示範發票、確認計畫、下載 CSV。不需尋找檔案。' },
    { href: '/chat', icon: MessageCircle, title: en ? 'Local AI chat' : '本機 AI 對話', description: en ? 'Ask questions and draft text using your prepared local model.' : '使用準備好的本機模型問問題、草擬文字。' },
    { href: '/yolanda-builder', icon: Sparkles, title: en ? 'Design a workflow · Preview' : '設計流程 · 預覽', description: en ? 'Yolanda builder uses local rules and sample previews. General AI agents are not connected.' : 'Yolanda builder 使用本機規則與示範預覽；尚未接入通用 AI Agent。' },
  ]
  return <main lang={locale} className="min-h-screen bg-white text-zinc-950">
    <header className="flex min-h-[76px] items-center justify-between border-b border-zinc-200 px-6 sm:px-10"><Link href="/" className="flex items-center gap-3 font-semibold"><Bot aria-hidden="true" className="size-6" />EZAgent</Link><div className="flex gap-2">{(['zh-Hant', 'en'] as const).map((value) => <button key={value} type="button" aria-pressed={locale === value} onClick={() => setLocale(value)} className="min-h-11 rounded-lg border border-zinc-200 px-3 text-sm">{value === 'en' ? 'EN' : '繁中'}</button>)}</div></header>
    <section className="mx-auto max-w-[960px] px-6 py-10 sm:py-14">
      <h1 className="text-3xl font-semibold tracking-tight">{en ? 'Prepare AI, then try your first task.' : '準備 AI，試做第一個任務。'}</h1>
      <p className="mb-7 mt-3 text-sm text-zinc-600">{en ? 'A local-first desktop helper. Start with synthetic sample invoices.' : '以本機處理為主的桌面助手。先用合成發票資料試一次。'}</p>
      <LocalAiSetup locale={locale} />
      <div className="mt-7 grid gap-4 sm:grid-cols-3">{cards.map(({ href, icon: Icon, title, description }) => <Link key={href} href={href} className="rounded-xl border border-zinc-200 p-5 transition hover:border-zinc-500 focus-visible:outline-2 focus-visible:outline-zinc-950"><Icon aria-hidden="true" className="size-6" /><h2 className="mt-5 font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-zinc-600">{description}</p></Link>)}</div>
      <p className="mt-7 text-xs leading-6 text-zinc-500">{en ? 'Invoice demo supports CSV/TXT only. PDF, XLSX and a packaged desktop installer are not available yet. This is not a clinical or insurance tool, and no personal-data compliance assessment is claimed.' : '發票示範僅支援 CSV／TXT。PDF、XLSX 與桌面安裝包尚未完成。不提供臨床或保險業務工具，也不代表已通過個資法規評估。'}</p>
    </section>
  </main>
}
