'use client'

import { useRef, useState } from 'react'
import { ArrowRight, Calculator, Copy, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'
import AccountingIntake, { type IntakeEntry } from './accounting-intake'

type Entry = { id: number; date: string; type: 'income' | 'expense'; description: string; amount: string }
type Currency = 'HKD' | 'USD' | 'TWD'

const initialEntries = (): Entry[] => [
  { id: 1, date: '2026-10-03', type: 'income', description: 'Workshop fee', amount: '3600.00' },
  { id: 2, date: '2026-10-08', type: 'income', description: 'Materials fee', amount: '650.00' },
  { id: 3, date: '2026-10-10', type: 'expense', description: 'Venue hire', amount: '900.00' },
  { id: 4, date: '2026-10-12', type: 'expense', description: 'Workshop supplies', amount: '240.00' },
]

function parseCents(value: string): number | null {
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(value.trim())) return null
  const [whole, fraction = ''] = value.trim().split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= 100_000_000 ? cents : null
}

function money(cents: number, currency: Currency) {
  const sign = cents < 0 ? '−' : ''
  return sign + currency + ' ' + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function AccountingExample({ onBack }: { onBack: () => void }) {
  const [title, setTitle] = useState('Sample workshop activity')
  const [period, setPeriod] = useState('2026-10')
  const [currency, setCurrency] = useState<Currency>('HKD')
  const [entries, setEntries] = useState<Entry[]>(initialEntries)
  const [copied, setCopied] = useState(false)
  const nextId = useRef(5)
  const validPeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(period)

  const included = entries.filter((entry) => validPeriod && entry.date.startsWith(period) && entry.description.trim() && parseCents(entry.amount) !== null)
  const incomeCents = included.filter((entry) => entry.type === 'income').reduce((sum, entry) => sum + parseCents(entry.amount)!, 0)
  const expenseCents = included.filter((entry) => entry.type === 'expense').reduce((sum, entry) => sum + parseCents(entry.amount)!, 0)
  const netCents = incomeCents - expenseCents
  const incomplete = entries.filter((entry) => !entry.date || (validPeriod && entry.date.startsWith(period) && (!entry.description.trim() || parseCents(entry.amount) === null))).length
  const outside = entries.filter((entry) => validPeriod && entry.date && !entry.date.startsWith(period)).length

  function updateEntry(id: number, patch: Partial<Entry>) {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry))
  }
  function addEntry(type: Entry['type']) {
    setEntries((current) => [...current, { id: nextId.current++, date: validPeriod ? period + '-15' : '', type, description: '', amount: '' }])
  }
  function addIntakeEntry(entry: IntakeEntry) {
    setEntries((current) => [...current, { id: nextId.current++, ...entry }])
  }
  function reset() { setTitle('Sample workshop activity'); setPeriod('2026-10'); setCurrency('HKD'); setEntries(initialEntries()); setCopied(false) }
  async function copySummary() {
    const rows = included.map((entry) => [entry.date, entry.type, entry.description, money(parseCents(entry.amount)!, currency)].join(' | '))
    const summary = ['SAMPLE CASH ACTIVITY STATEMENT — NOT AUDITED', title, 'Period: ' + (validPeriod ? period : '[invalid month]'), ...rows, 'Income: ' + money(incomeCents, currency), 'Expenses: ' + money(expenseCents, currency), 'Net cash activity: ' + money(netCents, currency), 'Excluded: ' + incomplete + ' incomplete; ' + outside + ' outside month.'].join('\n')
    try { await navigator.clipboard.writeText(summary); setCopied(true) } catch { setCopied(false) }
  }

  return <div className="as-workspace">
    <div className="as-heading"><div><span className="eyebrow">TOOL LIBRARY / EXAMPLE TOOL</span><h1>Accounting Statement Generator</h1><p>Enter income and expenses to build a simple monthly cash activity statement.</p></div><button className="button button-light" onClick={onBack}>Back to example tools <ArrowRight size={15} /></button></div>
    <div className="as-note"><ShieldCheck size={17} /><p><strong>Fictional sample.</strong> This is a cash activity summary of the entries below. It is not an audited statement, tax return, or bank reconciliation. Data stays in this browser session.</p></div>
    <div className="as-layout">
      <section className="as-editor">
        <div className="as-editor-title"><Calculator size={18} /><div><strong>Statement setup</strong><small>Edit the sample transactions</small></div></div>
        <div className="as-fields"><label>Statement name<input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} /></label><label>Month (YYYY-MM)<input inputMode="numeric" maxLength={7} value={period} onChange={(event) => setPeriod(event.target.value)} placeholder="2026-10" /></label><label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}><option value="HKD">HKD</option><option value="USD">USD</option><option value="TWD">TWD</option></select></label></div>
        {!validPeriod && <p className="as-period-error" role="alert">Enter a month as YYYY-MM to generate the statement.</p>}<AccountingIntake month={period} onAdd={addIntakeEntry} /><div className="as-entries-head"><div><span className="eyebrow">TRANSACTIONS</span><h2>Income & expenses</h2></div><span>{included.length} in period</span></div>
        <div className="as-entry-list">{entries.map((entry, index) => <div className="as-entry" key={entry.id}><div className="as-entry-top"><span>ENTRY {String(index + 1).padStart(2, '0')}</span><button aria-label={'Remove entry ' + (index + 1)} onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}><Trash2 size={15} /></button></div><div className="as-entry-grid"><label>Date<input type="date" value={entry.date} onChange={(event) => updateEntry(entry.id, { date: event.target.value })} /></label><label>Type<select value={entry.type} onChange={(event) => updateEntry(entry.id, { type: event.target.value as Entry['type'] })}><option value="income">Income</option><option value="expense">Expense</option></select></label><label className="as-description">Description<input value={entry.description} maxLength={90} onChange={(event) => updateEntry(entry.id, { description: event.target.value })} placeholder="What was this for?" /></label><label>Amount<input inputMode="decimal" value={entry.amount} onChange={(event) => updateEntry(entry.id, { amount: event.target.value })} placeholder="0.00" /></label></div>{entry.date && !entry.date.startsWith(period) && <small className="as-entry-hint">Outside selected month · excluded from statement</small>}{entry.date.startsWith(period) && (!entry.description.trim() || parseCents(entry.amount) === null) && <small className="as-entry-hint">Enter a description and a valid amount to include this entry.</small>}</div>)}</div>
        <div className="as-add-actions"><button onClick={() => addEntry('income')}><Plus size={15} /> Add income</button><button onClick={() => addEntry('expense')}><Plus size={15} /> Add expense</button></div>
        <button className="as-reset" onClick={reset}><RotateCcw size={14} /> Reset fictional example</button>
      </section>
      <section className="as-preview-area"><div className="as-preview-actions"><button onClick={copySummary} disabled={!included.length}><Copy size={15} /> {copied ? 'Copied' : 'Copy summary'}</button><button onClick={() => window.print()}>Print / Save PDF</button></div><div className="as-sheet"><div className="as-sheet-top"><span>EZAGENT / EXAMPLE TOOL</span><strong>SAMPLE</strong></div><h2>Cash activity statement</h2><p>{title || 'Untitled statement'}</p><div className="as-period">For the month of {period || '—'} · {currency}</div><div className="as-summary"><div><span>Income</span><strong>{money(incomeCents, currency)}</strong></div><div><span>Expenses</span><strong>{money(expenseCents, currency)}</strong></div><div className="as-net"><span>Net cash activity</span><strong>{money(netCents, currency)}</strong></div></div><h3>Included entries</h3><div className="as-table"><div className="as-table-row head"><span>DATE</span><span>DESCRIPTION</span><span>TYPE</span><span>AMOUNT</span></div>{included.map((entry) => <div className="as-table-row" key={entry.id}><span>{entry.date}</span><span>{entry.description}</span><span>{entry.type}</span><strong>{money(parseCents(entry.amount)!, currency)}</strong></div>)}{included.length === 0 && <p className="as-empty">No complete entries in this month.</p>}</div>{(incomplete > 0 || outside > 0) && <p className="as-excluded">{incomplete} incomplete and {outside} outside-month entries excluded.</p>}<div className="as-sheet-footer">Fictional example · Entered cash activity only · Not audited</div></div></section>
    </div>
  </div>
}
