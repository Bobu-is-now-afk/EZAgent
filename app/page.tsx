'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Bot, FileText, MessageCircle, Sparkles } from 'lucide-react'
import { LocalAiSetup } from '@/components/local-ai-setup'

const GUIDE_STORAGE_KEY = 'ezagent:first-use-guide:v1:handled'

function isLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '::1'
    || normalized === '0.0.0.0'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

const COPY = {
  'zh-Hant': {
    workspace: 'EZAgent 工作區', title: '你今天想做什麼？', subtitle: '先查看本機 AI 狀態，再選擇要開始的工作。',
    guide: '第一次使用？先和本機 AI 聊一句，再試試把重複工作變成工具。',
    guideHelp: '真實對話需要先完成本機 AI 準備；工作流程的配置與預覽不受影響。',
    chatFirst: '先體驗對話', skip: '跳過，直接體驗工具',
    chat: '本機 AI 對話', chatDescription: '使用準備好的本機模型問問題、草擬文字。', chatAction: '開始對話',
    builder: '設計工作流程', builderDescription: '把重複工作的要求整理成可復用規則。', featured: '推薦', builderAction: '建立工作流程',
    preset: '試用預設發票工具', presetDescription: '使用合成資料建立計畫、核對後再執行整理示範。', onlinePreset: '線上發票示範 · Mac mini', onlinePresetDescription: '只用合成資料；提交的 CSV／TXT 會送到 Mac mini 上的示範服務。', invoiceAction: '開始發票示範',
    boundary: '發票示範僅支援 CSV／TXT。配置、儲存或預演不代表已執行業務工作。',
    language: '語言',
  },
  en: {
    workspace: 'EZAgent Workspace', title: 'What would you like to do today?', subtitle: 'Check local AI status, then choose where to start.',
    guide: 'First time here? Chat with local AI, then turn repetitive work into a tool.',
    guideHelp: 'Real chat requires local AI setup first. Workflow configuration and preview remain available without it.',
    chatFirst: 'Try chat first', skip: 'Skip to tools',
    chat: 'Local AI chat', chatDescription: 'Ask questions and draft text with your prepared local model.', chatAction: 'Start a chat',
    builder: 'Design a workflow', builderDescription: 'Turn repetitive work requirements into reusable rules.', featured: 'Featured', builderAction: 'Create a workflow',
    preset: 'Try the invoice demo', presetDescription: 'Build a plan with synthetic data, review it, then run the demo.', onlinePreset: 'Online invoice demo · Mac mini', onlinePresetDescription: 'Synthetic data only. Submitted CSV/TXT files are sent to the demo service on the Mac mini.', invoiceAction: 'Start invoice demo',
    boundary: 'The invoice demo supports CSV/TXT only. Configuring, saving, or previewing a workflow does not mean business work has run.',
    language: 'Language',
  },
} as const

const cardClass = 'group flex min-h-[168px] flex-col rounded-xl border border-zinc-200 bg-white p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-400 hover:shadow-[0_10px_30px_-18px_rgba(24,24,27,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none sm:min-h-[176px] sm:p-5'

export default function Page() {
  const [locale, setLocale] = useState<'zh-Hant' | 'en'>('zh-Hant')
  const [showGuide, setShowGuide] = useState(false)
  const [hostedDemo, setHostedDemo] = useState(false)
  const toolsRef = useRef<HTMLElement>(null)
  const c = COPY[locale]

  useEffect(() => {
    try { setShowGuide(window.localStorage.getItem(GUIDE_STORAGE_KEY) !== 'true') }
    catch { setShowGuide(true) }
    setHostedDemo(!isLocalHostname(window.location.hostname))
  }, [])

  function markGuideHandled() {
    setShowGuide(false)
    try { window.localStorage.setItem(GUIDE_STORAGE_KEY, 'true') } catch { /* The page remains usable without storage. */ }
  }

  function skipToTools() {
    markGuideHandled()
    window.setTimeout(() => {
      toolsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      toolsRef.current?.focus({ preventScroll: true })
    }, 0)
  }

  return <main lang={locale} className="min-h-[100dvh] bg-white text-zinc-950">
    <header className="flex min-h-[64px] items-center justify-between border-b border-zinc-200/80 px-5 sm:px-10">
      <Link href="/" className="flex items-center gap-3 rounded-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2"><span className="flex size-9 items-center justify-center rounded-[10px] bg-zinc-950 text-white"><Bot aria-hidden="true" className="size-[19px]" /></span>EZAgent</Link>
      <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-1" aria-label={c.language}>
        {(['zh-Hant', 'en'] as const).map((value) => <button key={value} type="button" aria-pressed={locale === value} onClick={() => setLocale(value)} className={`min-h-9 rounded-lg px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 ${locale === value ? 'bg-zinc-950 text-white' : 'text-zinc-600'}`}>{value === 'en' ? 'EN' : '繁中'}</button>)}
      </div>
    </header>

    <section className="mx-auto flex w-full max-w-[880px] flex-col items-center px-5 pb-8 pt-8 sm:px-6 sm:pb-10 sm:pt-10">
      <div className="text-center"><p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">{c.workspace}</p><h1 className="text-balance text-[clamp(2rem,4vw,2.75rem)] font-semibold tracking-[-0.045em]">{c.title}</h1><p className="mt-2 text-[15px] text-zinc-500">{c.subtitle}</p></div>

      {showGuide && <aside aria-label={c.guide} className="mt-5 w-full rounded-xl border border-sky-200 bg-sky-50 p-3 sm:flex sm:items-center sm:justify-between sm:gap-4 sm:p-3.5">
        <div><p className="text-sm font-semibold text-sky-950">{c.guide}</p><p className="mt-1 text-xs leading-5 text-sky-900/80">{c.guideHelp}</p></div>
        <div className="mt-2 flex shrink-0 flex-wrap gap-2 sm:mt-0"><Link href="/chat" onClick={markGuideHandled} className="inline-flex min-h-10 items-center rounded-lg bg-zinc-950 px-4 text-xs font-semibold text-white outline-none hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2">{c.chatFirst}</Link><button type="button" onClick={skipToTools} className="min-h-10 rounded-lg border border-zinc-300 bg-white px-4 text-xs font-semibold outline-none hover:border-zinc-500 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2">{c.skip}</button></div>
      </aside>}

      <div className="mt-5 grid w-full items-stretch gap-3 sm:grid-cols-2">
        <LocalAiSetup locale={locale} compact showDemoLink={false} />
        <Link href="/chat" className={cardClass}>
          <span className="flex size-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 transition-colors group-hover:bg-zinc-950 group-hover:text-white"><MessageCircle aria-hidden="true" className="size-[19px]" /></span><h2 className="mt-4 text-[17px] font-semibold tracking-[-0.025em]">{c.chat}</h2><p className="mt-1 text-[13px] leading-5 text-zinc-500">{c.chatDescription}</p><span className="mt-auto pt-3 text-xs font-semibold text-zinc-800">{c.chatAction} <span aria-hidden="true">→</span></span>
        </Link>
      </div>

      <section ref={toolsRef} tabIndex={-1} aria-label={locale === 'en' ? 'Tool entries' : '工具入口'} className="mt-3 grid w-full scroll-mt-6 gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-4 sm:grid-cols-2">
        <Link href="/yolanda-builder" className={`${cardClass} border-zinc-400 ring-1 ring-zinc-200`}>
          <span className="flex items-start justify-between"><span className="flex size-10 items-center justify-center rounded-lg bg-zinc-950 text-white"><Sparkles aria-hidden="true" className="size-[19px]" /></span><span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{c.featured}</span></span><h2 className="mt-4 text-[17px] font-semibold tracking-[-0.025em]">{c.builder}</h2><p className="mt-1 text-[13px] leading-5 text-zinc-500">{c.builderDescription}</p><span className="mt-auto pt-3 text-xs font-semibold text-zinc-800">{c.builderAction} <span aria-hidden="true">→</span></span>
        </Link>
        <Link href="/invoice-demo" className={cardClass}>
          <span className="flex size-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 transition-colors group-hover:bg-zinc-950 group-hover:text-white"><FileText aria-hidden="true" className="size-[19px]" /></span><h2 className="mt-4 text-[17px] font-semibold tracking-[-0.025em]">{hostedDemo ? c.onlinePreset : c.preset}</h2><p className="mt-1 text-[13px] leading-5 text-zinc-500">{hostedDemo ? c.onlinePresetDescription : c.presetDescription}</p><span className="mt-auto pt-3 text-xs font-semibold text-zinc-800">{c.invoiceAction} <span aria-hidden="true">→</span></span>
        </Link>
      </section>
      <p className="mt-3 w-full text-sm text-zinc-600">{locale === 'en' ? 'Already have a saved workflow?' : '已有儲存的工作流程？'} <Link href="/workflows" className="font-semibold text-zinc-900 underline underline-offset-4 hover:text-zinc-600 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950">{locale === 'en' ? 'Open workflow library' : '開啟工作流庫'}</Link></p>
      <p className="mt-4 w-full text-xs leading-5 text-zinc-500">{c.boundary}</p>
    </section>
  </main>
}
