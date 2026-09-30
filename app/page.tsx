'use client'

import { useState } from 'react'
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  FilePlus2,
  FolderKanban,
  Grid2X2,
  MessageCircle,
  Paperclip,
  Play,
  Plus,
  Sparkles,
  Wrench,
} from 'lucide-react'

type ActiveView = 'home' | 'normal-llm' | 'main-stage' | 'custom-tools' | 'preset-library'

const modules = [
  { title: 'Normal LLM', description: 'Standard offline chat environment for general Q&A and writing.', icon: MessageCircle, view: 'normal-llm' as ActiveView },
  { title: 'Build Something (Main Stage)', description: 'Orchestrate custom AI agents and local workflows using natural language.', icon: Sparkles, view: 'main-stage' as ActiveView, featured: true },
  { title: '自訂工具庫', description: 'Your saved custom agents and automated tools.', icon: FolderKanban, view: 'custom-tools' as ActiveView },
  { title: 'Preset Library', description: 'Pre-built offline workflows for repetitive work.', icon: Grid2X2, view: 'preset-library' as ActiveView },
]

function Header({ onBack, subView }: { onBack: () => void; subView: boolean }) {
  return (
    <header className="flex h-[76px] shrink-0 items-center justify-between border-b border-zinc-200/80 bg-white px-6 sm:px-10">
      <div className="flex items-center gap-3">
        {subView && <button onClick={onBack} className="mr-2 flex items-center gap-2 rounded-lg px-2 py-2 text-[13px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950"><ArrowLeft className="size-4" /> Back to Workspace</button>}
        <div className="flex size-9 items-center justify-center rounded-[10px] bg-zinc-950 text-white shadow-sm"><Bot aria-hidden="true" className="size-[19px]" strokeWidth={2.1} /></div>
        <span className="text-[17px] font-semibold tracking-[-0.02em]">EZAgent</span>
      </div>
      <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700"><span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />100% Offline Engine Active</div>
    </header>
  )
}

function NormalLlm() {
  const [prompt, setPrompt] = useState('')
  const [sent, setSent] = useState(false)
  return <section className="mx-auto flex h-[calc(100vh-76px)] w-full max-w-4xl flex-col px-6 py-10">
    <div className="mb-8"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Normal LLM</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">Offline chat</h1></div>
    <div className="flex flex-1 flex-col items-center justify-center overflow-auto rounded-2xl border border-zinc-200 bg-zinc-50/40 p-8">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-zinc-950 text-white"><MessageCircle className="size-5" /></div>
      <p className="mt-5 text-center text-lg font-medium text-zinc-900">{sent ? 'Message queued for the offline assistant.' : 'Offline Assistant Ready. How can I help you today?'}</p>
      {!sent && <p className="mt-2 text-sm text-zinc-500">Ask a question or start drafting something new.</p>}
    </div>
    <div className="mt-5 flex items-center gap-3 rounded-2xl border border-zinc-300 bg-white p-2 shadow-[0_8px_30px_-20px_rgba(24,24,27,0.35)]"><button aria-label="Attach a file" className="flex size-10 items-center justify-center rounded-xl text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950"><Paperclip className="size-[18px]" /></button><input aria-label="Message" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { setSent(true); setPrompt('') } }} placeholder="Message your offline assistant..." className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-zinc-400" /><button aria-label="Send message" onClick={() => { setSent(true); setPrompt('') }} className="flex size-10 items-center justify-center rounded-xl bg-zinc-950 text-white transition hover:bg-zinc-700"><ArrowUp className="size-[18px]" /></button></div>
  </section>
}

function MainStage() {
  const [prompt, setPrompt] = useState('You are a precise local operations assistant. Read the provided documents, apply the selected rules, and return a concise result.')
  const [ran, setRan] = useState(false)
  const pills = ['Read Local PDF', 'Filter > $10,000', 'Export to Excel']
  return <section className="mx-auto flex h-[calc(100vh-76px)] w-full max-w-[1240px] flex-col px-6 py-8 sm:px-10"><div className="mb-7 flex items-end justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Main Stage</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">Build something</h1></div><span className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-500">Draft workflow</span></div><div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[1.05fr_0.95fr]"><div className="flex min-h-0 flex-col rounded-2xl border border-zinc-200 bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Natural Language Logic Canvas</h2><p className="mt-1 text-xs text-zinc-500">Describe how your agent should behave.</p></div><button aria-label="Add logic step" className="rounded-lg border border-zinc-200 p-2 text-zinc-500 hover:bg-zinc-50"><Plus className="size-4" /></button></div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label="System prompt" className="mt-5 min-h-40 resize-none rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 text-sm leading-6 text-zinc-700 outline-none focus:border-zinc-400" /><div className="mt-5"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Logic pills</p><div className="mt-3 flex flex-wrap gap-2">{pills.map((pill) => <button key={pill} onClick={() => setPrompt((value) => `${value} ${pill}.`)} className="rounded-full border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 transition hover:border-zinc-950 hover:bg-zinc-950 hover:text-white">[ {pill} ]</button>)}</div></div></div><div className="flex min-h-0 flex-col rounded-2xl border border-zinc-200 bg-zinc-50/50 p-5"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Agent Preview / Test Harness</h2><p className="mt-1 text-xs text-zinc-500">Run your workflow against local files.</p></div><button onClick={() => setRan(true)} className="flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-zinc-700"><Play className="size-3.5 fill-current" /> Run Agent</button></div><div className="mt-5 flex flex-1 flex-col rounded-xl border border-dashed border-zinc-300 bg-white p-4 font-mono text-xs text-zinc-400"><div className="flex items-center gap-2 border-b border-zinc-100 pb-3 font-sans text-xs text-zinc-500"><span className="size-2 rounded-full bg-zinc-300" /> output console</div>{ran ? <div className="mt-4 space-y-2 text-zinc-600"><p><span className="text-emerald-600">✓</span> Agent completed successfully.</p><p>3 local documents processed.</p><p>Ready to export results.</p></div> : <p className="mt-4">Your agent output will appear here.</p>}</div></div></div></section>
}

function CustomTools({ onBuild }: { onBuild: () => void }) { return <section className="mx-auto flex h-[calc(100vh-76px)] max-w-4xl flex-col items-center justify-center px-6 text-center"><div className="flex size-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600"><Wrench className="size-6" /></div><h1 className="mt-6 text-2xl font-semibold tracking-[-0.04em]">自訂工具庫</h1><p className="mt-3 text-sm text-zinc-500">You haven&apos;t built anything yet, go build some.</p><button onClick={onBuild} className="mt-7 rounded-lg bg-zinc-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-700">Build Something</button></section> }

function Presets() { const presets = [['Easy Invoice Generator', 'Extract and compile local PDF invoices automatically.'], ['Easy Income Statement Recorder', 'Log income receipts offline directly into Excel ledgers.']] as const; return <section className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-10"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Preset Library</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">Official Preset Workflows</h1><div className="mt-9 grid gap-4 sm:grid-cols-2">{presets.map(([title, description]) => <article key={title} className="rounded-2xl border border-zinc-200 p-6"><div className="flex size-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700"><FilePlus2 className="size-5" /></div><h2 className="mt-6 text-base font-semibold">{title}</h2><p className="mt-2 min-h-10 text-sm leading-5 text-zinc-500">{description}</p><button className="mt-6 flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-xs font-semibold text-zinc-800 transition hover:border-zinc-950 hover:bg-zinc-950 hover:text-white">Launch Workflow <ArrowUp className="size-3.5 rotate-45" /></button></article>)}</div></section> }

export default function Page() {
  const [activeView, setActiveView] = useState<ActiveView>('home')
  const subView = activeView !== 'home'
  return <main className="min-h-screen bg-white text-zinc-950"><Header subView={subView} onBack={() => setActiveView('home')} />{activeView === 'home' && <section className="mx-auto flex max-w-[880px] flex-col items-center px-6 pb-20 pt-[clamp(5.5rem,14vh,9rem)]"><div className="text-center"><p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Workspace</p><h1 className="text-balance text-[clamp(2rem,4vw,2.75rem)] font-semibold tracking-[-0.045em]">What would you like to do today?</h1><p className="mt-3 text-[15px] text-zinc-500">Select a module to begin.</p></div><div className="mt-12 grid w-full grid-cols-1 gap-4 sm:grid-cols-2">{modules.map((module) => { const Icon = module.icon; return <button key={module.title} onClick={() => setActiveView(module.view)} className={`group relative flex min-h-[224px] flex-col rounded-xl border bg-white p-6 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-[0_10px_30px_-18px_rgba(24,24,27,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 ${module.featured ? 'border-zinc-400 ring-1 ring-zinc-200' : 'border-zinc-200'}`}><div className="flex items-start justify-between"><div className={`flex size-10 items-center justify-center rounded-lg ${module.featured ? 'bg-zinc-950 text-white' : 'bg-zinc-100 text-zinc-600'} transition-colors group-hover:bg-zinc-950 group-hover:text-white`}><Icon aria-hidden="true" className="size-[19px]" strokeWidth={1.8} /></div>{module.featured && <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Featured</span>}</div><h2 className="mt-7 text-[17px] font-semibold tracking-[-0.025em] text-zinc-900">{module.title}</h2><p className="mt-2 max-w-[330px] text-[13px] leading-5 text-zinc-500">{module.description}</p>{module.view === 'custom-tools' && <div className="mt-auto flex items-center gap-2 pt-5 text-[11px] font-medium text-zinc-400"><Wrench className="size-3.5" />Nothing in here yet. Click to build something.</div>}</button> })}</div></section>}{activeView === 'normal-llm' && <NormalLlm />}{activeView === 'main-stage' && <MainStage />}{activeView === 'custom-tools' && <CustomTools onBuild={() => setActiveView('main-stage')} />}{activeView === 'preset-library' && <Presets />}</main>
}
