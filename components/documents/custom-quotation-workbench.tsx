'use client'

import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Printer, RotateCcw, ShieldAlert } from 'lucide-react'
import Link from 'next/link'
import {
  calculateTotals,
  fieldSources,
  formatMoney,
  getMissingFields,
  initialDraft,
  QUOTATION_SOURCE,
  sourceAfterUserEdit,
  sourceSummaryBadge,
  suggestFromSource,
  SUPPORTED_CURRENCIES,
  toMinorUnits,
  type QuotationDraft,
} from '@/lib/documents/quotation'

const currencies = SUPPORTED_CURRENCIES

function SourceLabel({ kind }: { kind: 'user' | 'concept-suggestion' | 'missing' }) {
  const label = kind === 'concept-suggestion' ? 'Concept suggestion · confirm' : kind === 'user' ? 'Entered by you' : 'Not provided'
  return <span className="text-xs text-zinc-500">{label}</span>
}

function Field({ label, source, children }: { label: string; source: 'user' | 'concept-suggestion' | 'missing'; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-medium text-zinc-800"><span className="flex flex-wrap items-center justify-between gap-2">{label}<SourceLabel kind={source} /></span>{children}</label>
}

const inputClass = 'min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus-visible:ring-2 focus-visible:ring-zinc-950'

function PrintableQuotation({ draft, totalMinor }: { draft: QuotationDraft; totalMinor: number }) {
  const subtotalMinor = calculateTotals(draft)?.subtotalMinor ?? 0
  const taxMinor = calculateTotals(draft)?.taxMinor ?? 0
  return <article id="quotation-print-root" className="border border-zinc-200 bg-white p-5 text-zinc-950 shadow-sm">
    <p className="text-xs font-bold tracking-[0.18em] text-zinc-500">SAMPLE · QUOTATION</p>
    <h1 className="mt-4 text-2xl font-semibold">Quotation</h1>
    <div className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><p className="text-xs text-zinc-500">FROM</p><p className="mt-1 font-medium">{draft.sellerName}</p></div><div><p className="text-xs text-zinc-500">TO</p><p className="mt-1 font-medium">{draft.buyerName}</p></div></div>
    <p className="mt-4 text-xs text-zinc-500">Valid until · {draft.validUntil} · Currency · {draft.currency}</p>
    <div className="mt-5 border-y border-zinc-200 py-3 text-sm"><div className="flex justify-between gap-3"><span>{draft.description} × {draft.quantity}</span><span>{formatMoney(subtotalMinor, draft.currency)}</span></div></div>
    <div className="ml-auto mt-3 max-w-48 space-y-1 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{formatMoney(subtotalMinor, draft.currency)}</span></div><div className="flex justify-between"><span>Tax</span><span>{formatMoney(taxMinor, draft.currency)}</span></div><div className="flex justify-between border-t border-zinc-300 pt-2 font-bold"><span>Total</span><span>{formatMoney(totalMinor, draft.currency)}</span></div></div>
    <p className="mt-6 border-t border-zinc-200 pt-3 text-xs text-zinc-500">Synthetic demonstration · Draft only · Not issued · No payment requested</p>
  </article>
}

export function CustomQuotationWorkbench() {
  const [source, setSource] = useState(QUOTATION_SOURCE)
  const [draft, setDraft] = useState<QuotationDraft | null>(null)
  const [provenance, setProvenance] = useState({ ...fieldSources })
  const [printHost, setPrintHost] = useState<HTMLElement | null>(null)
  useEffect(() => setPrintHost(document.body), [])
  const missing = useMemo(() => draft ? getMissingFields(draft) : [], [draft])
  const totals = useMemo(() => draft ? calculateTotals(draft) : null, [draft])

  function update<K extends keyof QuotationDraft>(key: K, value: QuotationDraft[K]) {
    setDraft((current) => current ? { ...current, [key]: value, confirmed: key === 'confirmed' ? Boolean(value) : false } : current)
    if (key !== 'confirmed') setProvenance((current) => ({ ...current, [key]: sourceAfterUserEdit(String(value)) }))
  }

  function createDraft() {
    const suggested = suggestFromSource(source)
    setDraft({ ...initialDraft, ...suggested })
    setProvenance({ ...fieldSources, description: suggested.description ? 'concept-suggestion' : 'missing', quantity: suggested.quantity ? 'concept-suggestion' : 'missing' })
  }

  function startOver() {
    setDraft(null)
    setProvenance({ ...fieldSources })
  }

  const canReview = Boolean(draft && missing.length === 0 && totals)

  return <>
  <main id="quotation-app-ui" className="min-h-screen bg-zinc-50 text-zinc-950">
    <header className="flex min-h-[72px] items-center justify-between border-b border-zinc-200 bg-white px-5 sm:px-8">
      <Link href="/" className="flex min-h-11 items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-950"><ArrowLeft aria-hidden="true" className="size-4" />EZAgent</Link>
      <span className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600">Quotation workbench · local demo</span>
    </header>

    <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-10">
      <div className="mb-7 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Custom work → quotation draft</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Turn a work request into a reviewable quote.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">A small concept simulation creates editable draft fields from synthetic wording. It never supplies price, exact dates, identity, tax or approval.</p>
      </div>

      <div role="note" className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <ShieldAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        <p><strong>Concept simulation.</strong> No model is called, and this draft is not issued or sent. Suggestions remain unconfirmed until you review every required field. Draft stays in this tab; refreshing or leaving clears it.</p>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <section aria-labelledby="input-title" className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Step 1 · Source</p><h2 id="input-title" className="mt-1 text-lg font-semibold">Describe the work</h2></div>
            {draft && <button type="button" onClick={startOver} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-zinc-600 hover:bg-zinc-100"><RotateCcw aria-hidden="true" className="size-4" />Start over (clears unsaved fields)</button>}
          </div>
          <label htmlFor="work-source" className="mt-5 block text-sm font-medium">Custom-work request</label>
          <textarea id="work-source" value={source} readOnly={Boolean(draft)} onChange={(event) => setSource(event.target.value)} rows={3} className={`${inputClass} mt-2 resize-y py-3 read-only:bg-zinc-50 read-only:text-zinc-500`} placeholder="Describe the work; leave unknown facts out." />
          {draft && <p className="mt-2 text-xs leading-5 text-zinc-500">Source text is locked while this draft is open. Choose Start over to clear unsaved fields before editing it.</p>}
          <p className="mt-2 text-xs leading-5 text-zinc-500">Synthetic example. The demo parser only recognizes the exact sample sentence; all other wording stays as source until you edit the draft.</p>
          {!draft ? <button type="button" onClick={createDraft} disabled={!source.trim()} className="mt-5 min-h-11 rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40">Create editable draft</button> : <div className="mt-5 rounded-lg bg-zinc-50 p-4 text-sm">
            <p className="font-medium">Source preserved</p><blockquote className="mt-2 border-l-2 border-zinc-300 pl-3 text-zinc-600">{source}</blockquote>
            <div className="mt-3 flex flex-wrap gap-2"><span className="rounded-full bg-white px-2.5 py-1 text-xs text-zinc-600">{sourceSummaryBadge('description', provenance.description)}</span><span className="rounded-full bg-white px-2.5 py-1 text-xs text-zinc-600">{sourceSummaryBadge('quantity', provenance.quantity)}</span><span className="rounded-full bg-white px-2.5 py-1 text-xs text-zinc-600">{sourceSummaryBadge('unitPrice', provenance.unitPrice)}</span></div>
          </div>}

          {draft && <div className="mt-7 border-t border-zinc-200 pt-6">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Step 2 · Edit</p><h2 className="mt-1 text-lg font-semibold">Quotation details</h2></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Seller name" source={provenance.sellerName}><input aria-label="Seller name" value={draft.sellerName} onChange={(e) => update('sellerName', e.target.value)} className={inputClass} autoComplete="organization" /></Field>
              <Field label="Buyer name" source={provenance.buyerName}><input aria-label="Buyer name" value={draft.buyerName} onChange={(e) => update('buyerName', e.target.value)} className={inputClass} autoComplete="organization" /></Field>
              <Field label="Valid until (YYYY-MM-DD)" source={provenance.validUntil}><input aria-label="Valid until" inputMode="numeric" placeholder="YYYY-MM-DD" value={draft.validUntil} onChange={(e) => update('validUntil', e.target.value)} className={inputClass} /></Field>
              <Field label="Currency" source={provenance.currency}><select aria-label="Currency" value={draft.currency} onChange={(e) => update('currency', e.target.value)} className={inputClass}><option value="">Select currency</option>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></Field>
              <Field label="Item description" source={provenance.description}><input aria-label="Item description" value={draft.description} onChange={(e) => update('description', e.target.value)} className={inputClass} /></Field>
              <Field label="Quantity (whole units)" source={provenance.quantity}><input aria-label="Quantity" inputMode="numeric" value={draft.quantity} onChange={(e) => update('quantity', e.target.value)} className={inputClass} /></Field>
              <Field label="Unit price" source={provenance.unitPrice}><input aria-label="Unit price" inputMode="decimal" value={draft.unitPrice} onChange={(e) => update('unitPrice', e.target.value)} className={inputClass} placeholder="Enter amount" /></Field>
              <Field label="Tax treatment" source={provenance.taxMode}><select aria-label="Tax treatment" value={draft.taxMode} onChange={(e) => update('taxMode', e.target.value as QuotationDraft['taxMode'])} className={inputClass}><option value="">Select treatment</option><option value="none">No tax (confirmed)</option><option value="rate">Tax rate</option></select></Field>
              {draft.taxMode === 'rate' && <Field label="Tax rate (%)" source={provenance.taxRate}><input aria-label="Tax rate" inputMode="decimal" value={draft.taxRate} onChange={(e) => update('taxRate', e.target.value)} className={inputClass} placeholder="0 to 100" /></Field>}
            </div>
          </div>}
        </section>

        <section aria-labelledby="review-title" className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Step 3 · Review</p>
          <h2 id="review-title" className="mt-1 text-lg font-semibold">Check before preview</h2>
          {!draft ? <p className="mt-5 rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600">Create a draft to see its missing fields and quotation preview.</p> : <>
            {missing.length > 0 ? <div role="alert" className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4">
              <p className="font-semibold text-amber-950">Review blocked · {missing.length} required {missing.length === 1 ? 'field' : 'fields'} missing</p>
              <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-amber-950">{missing.map((field) => <li key={field}>{field}</li>)}</ul>
              <p className="mt-3 text-xs leading-5 text-amber-900">Enter or explicitly confirm each value. No price, date, identity or tax assumption has been filled in.</p>
            </div> : <div className="mt-5 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950"><p className="font-semibold">Required fields complete</p><p className="mt-1">Totals use integer minor units and round tax to the nearest minor unit.</p></div>}

              {totals && draft.currency && <div className="mt-5 rounded-xl border border-zinc-200 p-4">
              <h3 className="text-sm font-semibold">Deterministic totals</h3>
                <dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between gap-4"><dt className="text-zinc-600">Subtotal</dt><dd>{formatMoney(totals.subtotalMinor, draft.currency)}</dd></div><div className="flex justify-between gap-4"><dt className="text-zinc-600">Tax</dt><dd>{formatMoney(totals.taxMinor, draft.currency)}</dd></div><div className="flex justify-between gap-4 border-t border-zinc-200 pt-2 font-semibold"><dt>Total</dt><dd>{formatMoney(totals.totalMinor, draft.currency)}</dd></div></dl>
            </div>}

            <label className={`mt-5 flex items-start gap-3 rounded-lg border p-3 text-sm ${canReview ? 'border-zinc-300' : 'border-zinc-200 bg-zinc-50 text-zinc-400'}`}>
              <input type="checkbox" aria-label="I reviewed every field and its source" checked={draft.confirmed} disabled={!canReview} onChange={(e) => update('confirmed', e.target.checked)} className="mt-0.5 size-4 accent-zinc-950" />
              <span>I reviewed every field, its source and the calculated total.</span>
            </label>

            <div className="mt-6 border-t border-zinc-200 pt-5">
              <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Document preview</h3><span className="rounded bg-zinc-950 px-2 py-1 text-xs font-bold tracking-wider text-white">SAMPLE</span></div>
              <article aria-label="Quotation sample preview" className="mt-4 border border-zinc-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-bold tracking-[0.18em] text-zinc-500">SAMPLE · {missing.length ? 'INCOMPLETE DRAFT' : draft.confirmed ? 'QUOTATION' : 'REVIEW PENDING'}</p>
                <h4 className="mt-4 text-2xl font-semibold">Quotation</h4>
                <div className="mt-5 grid grid-cols-2 gap-4 text-sm"><div><p className="text-xs text-zinc-500">FROM</p><p className="mt-1 font-medium">{draft.sellerName || <span className="text-amber-800">Missing seller</span>}</p></div><div><p className="text-xs text-zinc-500">TO</p><p className="mt-1 font-medium">{draft.buyerName || <span className="text-amber-800">Missing buyer</span>}</p></div></div>
                <p className="mt-4 text-xs text-zinc-500">Valid until · {draft.validUntil || 'Missing date'} · Currency · {draft.currency || 'Missing currency'}</p>
                <div className="mt-5 border-y border-zinc-200 py-3 text-sm"><div className="flex justify-between gap-3"><span>{draft.description || 'Missing item description'} × {draft.quantity || 'Missing quantity'}</span><span>{totals && draft.currency ? formatMoney(totals.subtotalMinor, draft.currency) : toMinorUnits(draft.unitPrice) === null ? 'Invalid or missing price' : 'Totals unavailable until all fields are valid'}</span></div></div>
                <div className="ml-auto mt-3 max-w-48 space-y-1 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{totals && draft.currency ? formatMoney(totals.subtotalMinor, draft.currency) : '—'}</span></div><div className="flex justify-between"><span>Tax</span><span>{totals && draft.currency ? formatMoney(totals.taxMinor, draft.currency) : '—'}</span></div><div className="flex justify-between border-t border-zinc-300 pt-2 font-bold"><span>Total</span><span>{totals && draft.currency ? formatMoney(totals.totalMinor, draft.currency) : '—'}</span></div></div>
                <p className="mt-6 border-t border-zinc-200 pt-3 text-xs text-zinc-500">Synthetic demonstration · Draft only · Not issued · No payment requested</p>
              </article>
              <button type="button" onClick={() => window.print()} disabled={!draft.confirmed} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 print:hidden"><Printer aria-hidden="true" className="size-4" />Print SAMPLE preview</button>
              <p className="mt-3 text-xs leading-5 text-zinc-500">{draft.confirmed ? 'Printing creates only this synthetic SAMPLE. It does not issue a real quotation, allocate a number, send a document or request payment.' : 'Printing is locked until the review is confirmed. It does not issue a real quotation, allocate a number, send a document or request payment.'}</p>
            </div>
          </>}
        </section>
      </div>
      <p className="mt-6 flex items-center gap-2 text-xs text-zinc-500"><ShieldAlert aria-hidden="true" className="size-4" />No real business identity or customer data is included in this synthetic fixture.</p>
    </div>
    <style jsx global>{`@media screen { #quotation-print-root { display: none !important; } } @media print { @page { size: A4; margin: 12mm; } html, body { margin: 0 !important; padding: 0 !important; background: white !important; } body > :not(#quotation-print-root) { display: none !important; } body > #quotation-print-root { display: block !important; position: static !important; width: auto !important; margin: 0 !important; border: 0 !important; box-shadow: none !important; break-inside: avoid-page; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
  </main>
  {printHost && draft?.confirmed && totals && createPortal(<PrintableQuotation draft={draft} totalMinor={totals.totalMinor} />, printHost)}
  </>
}
