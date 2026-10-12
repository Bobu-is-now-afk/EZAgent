'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Pause, Play, RotateCcw } from 'lucide-react'

export type WorkflowComparisonLocale = 'zh-Hant' | 'en'

const LAST_FRAME = 3
const FRAME_DURATION_MS = 3_250

const COPY = {
  'zh-Hant': {
    title: '資料可以變，格式和規則保持一致。',
    subtitle: 'AI 協助理解需求，程式按已確認規則執行。你可以設計自己的流程，也可以使用預設工具。',
    leftTitle: '每次重新生成答案', leftSubtitle: '相同需求，輸出格式可能變化',
    rightTitle: '復用固定工作流', rightSubtitle: '資料改變，仍按同一模板處理',
    prompt100: '把這張收據整理成表格：海港文具，2026-10-01，HKD 100.00',
    prompt120: '把這張收據整理成表格：海港文具，2026-10-01，HKD 120.00',
    merchantValue: '海港文具',
    fixed: '同一模板／同一規則', changed: '格式發生變化',
    date: '日期', merchant: '商戶', amount: '金額', currency: '幣種', vendor: '供應商', total: '總額', transactionDate: '交易日',
    note: '示意，非真實模型評測。實際效果取決於輸入、規則與實現。',
    staticExplanation: '左側示意相同要求可能得到不同格式；右側示意資料值改變時，已確認的模板與規則保持一致。',
    pause: '暫停', resume: '繼續', replay: '重播', collapse: '收起對比', expand: '展開對比', reduced: '已依系統設定停用動畫',
  },
  en: {
    title: 'Data can change while the format and rules stay consistent.',
    subtitle: 'AI helps interpret the request; software applies confirmed rules. Design your own workflow or use a preset tool.',
    leftTitle: 'Generate an answer each time', leftSubtitle: 'The same request may return a different format',
    rightTitle: 'Reuse a fixed workflow', rightSubtitle: 'Changed data follows the same template',
    prompt100: 'Turn this receipt into a table: Harbour Stationery, 2026-10-01, HKD 100.00',
    prompt120: 'Turn this receipt into a table: Harbour Stationery, 2026-10-01, HKD 120.00',
    merchantValue: 'Harbour Stationery',
    fixed: 'Same template / same rules', changed: 'Format changed',
    date: 'Date', merchant: 'Merchant', amount: 'Amount', currency: 'Currency', vendor: 'Vendor', total: 'Total', transactionDate: 'Transaction date',
    note: 'Illustration only, not a real model benchmark. Results depend on the input, rules, and implementation.',
    staticExplanation: 'The left illustrates format drift for an unchanged request. The right shows changed data while the confirmed template and rules stay fixed.',
    pause: 'Pause', resume: 'Continue', replay: 'Replay', collapse: 'Collapse comparison', expand: 'Expand comparison', reduced: 'Animation disabled by system preference',
  },
} as const

function MiniTable({ headers, values, highlighted = false }: { headers: string[]; values: string[]; highlighted?: boolean }) {
  return <div className="mt-1.5 min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white">
    <table className="w-full table-fixed text-left text-xs">
      <thead className={`border-b border-zinc-200 font-semibold text-zinc-600 ${highlighted ? 'bg-amber-50' : 'bg-zinc-50'}`}><tr>{headers.map((value) => <th key={value} className="break-words px-1 py-1 align-top leading-4 sm:px-2">{value}</th>)}</tr></thead>
      <tbody className="text-zinc-800"><tr>{values.map((value, index) => <td key={`${value}-${index}`} className={`break-words px-1 py-1.5 align-top leading-4 sm:px-2 ${highlighted && index === 2 ? 'bg-emerald-50 font-semibold text-emerald-800' : ''}`}>{value}</td>)}</tr></tbody>
    </table>
  </div>
}

export function WorkflowComparisonBanner({ locale = 'zh-Hant' }: { locale?: WorkflowComparisonLocale }) {
  const c = COPY[locale]
  const titleId = useId()
  const rootRef = useRef<HTMLElement>(null)
  const [frame, setFrame] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const [userPaused, setUserPaused] = useState(false)
  const [inView, setInView] = useState(true)
  const [pageVisible, setPageVisible] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => { setReducedMotion(media.matches); if (media.matches) setFrame(LAST_FRAME) }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const update = () => setPageVisible(document.visibilityState === 'visible')
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  useEffect(() => {
    const element = rootRef.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.08 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (collapsed || userPaused || reducedMotion || !inView || !pageVisible) return
    const timer = window.setInterval(() => setFrame((value) => value >= LAST_FRAME ? 0 : value + 1), FRAME_DURATION_MS)
    return () => window.clearInterval(timer)
  }, [collapsed, inView, pageVisible, reducedMotion, userPaused])

  const second = frame >= 2
  const showOutput = frame === 1 || frame === 3
  const leftHeaders = second ? [c.vendor, c.total, c.transactionDate] : [c.date, c.merchant, c.amount]
  const leftValues = second ? [c.merchantValue, '100.00', '01/10/2026'] : ['2026-10-01', c.merchantValue, '100.00']
  const rightAmount = second ? '120.00' : '100.00'

  return <section ref={rootRef} data-workflow-comparison data-frame={frame} aria-labelledby={titleId} className="rounded-2xl border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-stone-100 p-3 shadow-[0_12px_36px_-30px_rgba(24,24,27,0.45)] sm:p-4">
    <p className="sr-only">{c.staticExplanation}</p>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1"><h2 id={titleId} className="text-base font-semibold tracking-[-0.02em] text-zinc-950 sm:text-lg">{c.title}</h2>{!collapsed && <p className="mt-1 max-w-3xl text-xs leading-4 text-zinc-600 sm:text-sm sm:leading-5">{c.subtitle}</p>}</div>
      <button type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={collapsed ? c.expand : c.collapse} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 outline-none hover:border-zinc-500 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2">{collapsed ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronUp aria-hidden="true" className="size-4" />}<span className="hidden sm:inline">{collapsed ? c.expand : c.collapse}</span></button>
    </div>
    {!collapsed && <>
      <div aria-hidden="true" className="mt-3 grid gap-2 md:grid-cols-2">
        <article className="min-w-0 rounded-xl border border-zinc-200 bg-white/90 p-2.5 sm:p-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold">{c.leftTitle}</h3><p className="mt-0.5 text-[11px] text-zinc-500">{c.leftSubtitle}</p></div>{second && showOutput && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-900">{c.changed}</span>}</div>
          {showOutput ? <MiniTable headers={leftHeaders} values={leftValues} highlighted={second} /> : <p className="mt-1.5 rounded-lg bg-zinc-100 p-2 text-xs leading-4 text-zinc-700">{c.prompt100}</p>}
        </article>
        <article className="min-w-0 rounded-xl border border-zinc-300 bg-white/90 p-2.5 ring-1 ring-zinc-200 sm:p-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold">{c.rightTitle}</h3><p className="mt-0.5 text-[11px] text-zinc-500">{c.rightSubtitle}</p></div><span className="rounded-full bg-zinc-950 px-2 py-1 text-[10px] font-semibold text-white">{c.fixed}</span></div>
          {showOutput ? <MiniTable headers={[c.date, c.merchant, c.amount, c.currency]} values={['2026-10-01', c.merchantValue, rightAmount, 'HKD']} highlighted={second} /> : <p className="mt-1.5 rounded-lg bg-zinc-100 p-2 text-xs leading-4 text-zinc-700">{second ? c.prompt120 : c.prompt100}</p>}
        </article>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-2">
        <p className="max-w-2xl text-[11px] leading-4 text-zinc-500">{c.note}</p>
        <div className="flex flex-wrap items-center gap-2">
          {reducedMotion && <span className="text-[11px] text-zinc-500">{c.reduced}</span>}
          <button type="button" disabled={reducedMotion} onClick={() => setUserPaused((value) => !value)} aria-pressed={userPaused} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-semibold outline-none hover:border-zinc-500 focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-50">{userPaused ? <Play aria-hidden="true" className="size-3.5" /> : <Pause aria-hidden="true" className="size-3.5" />}{userPaused ? c.resume : c.pause}</button>
          <button type="button" disabled={reducedMotion} onClick={() => { setFrame(0); setUserPaused(false) }} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 text-xs font-semibold outline-none hover:border-zinc-500 focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"><RotateCcw aria-hidden="true" className="size-3.5" />{c.replay}</button>
        </div>
      </div>
    </>}
  </section>
}
