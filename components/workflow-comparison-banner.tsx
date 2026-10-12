'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Pause, Play, RotateCcw } from 'lucide-react'

export type WorkflowComparisonLocale = 'zh-Hant' | 'en'

const LAST_FRAME = 4
const FRAME_DURATION_MS = 2_400

const COPY = {
  'zh-Hant': {
    eyebrow: '原理示意',
    title: '資料可以變，輸出格式不必跟著變。',
    leftTitle: '直接生成答案',
    leftSubtitle: '相同輸入，兩次生成的格式可能不同。',
    leftConclusion: '相同輸入，格式可能變化。',
    rightTitle: '復用固定工作流程',
    rightSubtitle: '資料改變，兩次輸出仍使用同一模板。',
    rightConclusion: '金額改變，模板保持一致。',
    first: '第一次', second: '第二次', input: '輸入', output: '輸出',
    merchantValue: '海港文具',
    date: '日期', merchant: '商戶', amount: '金額', vendor: '供應商', total: '總額', transactionDate: '交易日',
    note: '示意，非真實模型評測；實際效果取決於輸入、規則與實現。',
    pause: '暫停', resume: '繼續', replay: '重播', collapse: '收起對比', expand: '展開對比', collapseShort: '收起', expandShort: '展開', reduced: '已依系統設定停用動畫',
  },
  en: {
    eyebrow: 'How it works',
    title: 'Data can change without changing the output format.',
    leftTitle: 'Generate an answer directly',
    leftSubtitle: 'The same input may produce two different formats.',
    leftConclusion: 'Same input, format may change.',
    rightTitle: 'Reuse a fixed workflow',
    rightSubtitle: 'Changed data still uses the same output template.',
    rightConclusion: 'Amount changes, template stays consistent.',
    first: 'First', second: 'Second', input: 'Input', output: 'Output',
    merchantValue: 'Harbour Stationery',
    date: 'Date', merchant: 'Merchant', amount: 'Amount', vendor: 'Vendor', total: 'Total', transactionDate: 'Transaction date',
    note: 'Illustration only, not a real model benchmark; results depend on the input, rules, and implementation.',
    pause: 'Pause', resume: 'Continue', replay: 'Replay', collapse: 'Collapse comparison', expand: 'Expand comparison', collapseShort: 'Collapse', expandShort: 'Expand', reduced: 'Animation disabled by system preference',
  },
} as const

type Copy = (typeof COPY)[WorkflowComparisonLocale]

function OutputTable({ headers, values, highlightHeaders = false, highlightValueIndex }: { headers: string[]; values: string[]; highlightHeaders?: boolean; highlightValueIndex?: number }) {
  return <div className="mt-1.5 min-w-0 overflow-hidden rounded-lg bg-white/70">
    <table data-comparison-output className="w-full table-fixed text-left text-xs">
      <thead data-output-headers className={`border-b border-slate-200 font-semibold text-slate-600 transition-colors duration-500 motion-reduce:transition-none ${highlightHeaders ? 'bg-[#DDEAF5]' : 'bg-white/40'}`}>
        <tr>{headers.map((value) => <th key={value} className="break-words px-1.5 py-1.5 align-top leading-4 sm:px-2">{value}</th>)}</tr>
      </thead>
      <tbody className="text-zinc-800"><tr>{values.map((value, index) => <td key={`${value}-${index}`} className={`break-words px-1.5 py-1.5 align-top leading-4 transition-colors duration-500 motion-reduce:transition-none sm:px-2 ${highlightValueIndex === index ? 'bg-[#E4EEF7] font-semibold text-slate-950' : ''}`}>{value}</td>)}</tr></tbody>
    </table>
  </div>
}

function ComparisonRecord({ copy, order, amount, headers, values, highlightInput = false, highlightInputAmount = false, highlightHeaders = false, highlightValueIndex }: {
  copy: Copy
  order: 'first' | 'second'
  amount: '100.00' | '120.00'
  headers: string[]
  values: string[]
  highlightInput?: boolean
  highlightInputAmount?: boolean
  highlightHeaders?: boolean
  highlightValueIndex?: number
}) {
  return <section data-comparison-record={order} className="border-t border-slate-200/90 pt-3 first:border-t-0 first:pt-0">
    <h4 className="text-xs font-semibold text-slate-700">{copy[order]}</h4>
    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:items-start">
      <div>
        <p className="text-[11px] font-medium text-slate-500">{copy.input}</p>
        <p data-comparison-input className={`mt-1 rounded-md px-2 py-1.5 text-xs leading-5 text-zinc-800 transition-colors duration-500 motion-reduce:transition-none ${highlightInput ? 'bg-[#DDEAF5] ring-1 ring-inset ring-[#AFC4D8]' : 'bg-white/55'}`}>
          {copy.merchantValue} · 2026-10-01 · <span className={highlightInputAmount ? 'rounded bg-[#D5E6F3] px-0.5 font-semibold' : ''}>HKD {amount}</span>
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-slate-500">{copy.output}</p>
        <OutputTable headers={headers} values={values} highlightHeaders={highlightHeaders} highlightValueIndex={highlightValueIndex} />
      </div>
    </div>
  </section>
}

export function WorkflowComparisonBanner({ locale = 'zh-Hant' }: { locale?: WorkflowComparisonLocale }) {
  const copy = COPY[locale]
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

  const leftHeaders = [copy.date, copy.merchant, copy.amount]
  const changedLeftHeaders = [copy.vendor, copy.total, copy.transactionDate]
  const rightHeaders = [copy.date, copy.merchant, copy.amount]

  return <section ref={rootRef} data-workflow-comparison data-frame={frame} aria-labelledby={titleId} className="overflow-hidden rounded-2xl border border-slate-200 bg-[#F3F6F9]">
    <div className="flex items-start justify-between gap-3 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{copy.eyebrow}</p>
        <h2 id={titleId} className="mt-1 text-base font-semibold tracking-[-0.02em] text-zinc-950 sm:text-lg">{copy.title}</h2>
      </div>
      <button type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={collapsed ? copy.expand : copy.collapse} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white/80 px-3 text-xs font-semibold text-slate-700 outline-none hover:border-slate-500 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2">
        {collapsed ? <ChevronDown aria-hidden="true" className="size-4" /> : <ChevronUp aria-hidden="true" className="size-4" />}
        <span className="sm:hidden">{collapsed ? copy.expandShort : copy.collapseShort}</span><span className="hidden sm:inline">{collapsed ? copy.expand : copy.collapse}</span>
      </button>
    </div>
    {!collapsed && <>
      <div className="grid border-t border-slate-200 md:grid-cols-2 md:divide-x md:divide-slate-200">
        <article data-comparison-side="left" className="min-w-0 px-4 py-4 sm:px-5">
          <h3 className="text-sm font-semibold text-zinc-950">{copy.leftTitle}</h3>
          <p className="mt-0.5 text-xs leading-5 text-slate-600">{copy.leftSubtitle}</p>
          <div className="mt-3 space-y-3">
            <ComparisonRecord copy={copy} order="first" amount="100.00" headers={leftHeaders} values={['2026-10-01', copy.merchantValue, 'HKD 100.00']} highlightInput={frame === 0} />
            <ComparisonRecord copy={copy} order="second" amount="100.00" headers={changedLeftHeaders} values={[copy.merchantValue, 'HKD 100.00', '01/10/2026']} highlightInput={frame === 0} highlightHeaders={frame === 1} highlightValueIndex={frame === 1 ? 2 : undefined} />
          </div>
          <p className="mt-3 border-t border-slate-200 pt-3 text-xs font-semibold text-slate-800">{copy.leftConclusion}</p>
        </article>
        <article data-comparison-side="right" className="min-w-0 border-t border-slate-200 px-4 py-4 sm:px-5 md:border-t-0">
          <h3 className="text-sm font-semibold text-zinc-950">{copy.rightTitle}</h3>
          <p className="mt-0.5 text-xs leading-5 text-slate-600">{copy.rightSubtitle}</p>
          <div className="mt-3 space-y-3">
            <ComparisonRecord copy={copy} order="first" amount="100.00" headers={rightHeaders} values={['2026-10-01', copy.merchantValue, 'HKD 100.00']} highlightHeaders={frame === 3} />
            <ComparisonRecord copy={copy} order="second" amount="120.00" headers={rightHeaders} values={['2026-10-01', copy.merchantValue, 'HKD 120.00']} highlightInput={frame === 2} highlightInputAmount={frame === 2} highlightHeaders={frame === 3} highlightValueIndex={frame === 2 ? 2 : undefined} />
          </div>
          <p className="mt-3 border-t border-slate-200 pt-3 text-xs font-semibold text-slate-800">{copy.rightConclusion}</p>
        </article>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-300 bg-white px-4 py-2.5 sm:px-5">
        <p className="max-w-2xl text-[11px] leading-4 text-slate-500">{copy.note}</p>
        <div className="flex flex-wrap items-center gap-1">
          {reducedMotion && <span className="mr-1 text-[11px] text-slate-500">{copy.reduced}</span>}
          <button type="button" disabled={reducedMotion} onClick={() => setUserPaused((value) => !value)} aria-pressed={userPaused} className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-slate-700 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-50">{userPaused ? <Play aria-hidden="true" className="size-3.5" /> : <Pause aria-hidden="true" className="size-3.5" />}{userPaused ? copy.resume : copy.pause}</button>
          <button type="button" disabled={reducedMotion} onClick={() => { setFrame(0); setUserPaused(false) }} className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs text-slate-600 underline-offset-4 outline-none hover:bg-slate-100 hover:underline focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"><RotateCcw aria-hidden="true" className="size-3.5" />{copy.replay}</button>
        </div>
      </div>
    </>}
  </section>
}
