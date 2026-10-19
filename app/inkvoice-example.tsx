'use client'

import { useState } from 'react'
import { ArrowRight, FileText, RotateCcw, ShieldCheck, WandSparkles } from 'lucide-react'

type Draft = {
  seller: string
  buyer: string
  item: string
  quantity: string
  unitPrice: string
  dueDays: string
}

const sampleInput = 'Please create an invoice from Demo Studio to Sample Client for a design workshop, HKD 1,800 per day for 2 days. Payment due in 14 days.'

function parseInput(input: string): Draft | null {
  const match = input.trim().match(/^Please create an invoice from (.{1,80}?) to (.{1,80}?) for (.{1,100}?), HKD ([\d,]+(?:\.\d{1,2})?) per day for (\d{1,3}) days?\. Payment due in (\d{1,2}) days?\.$/i)
  if (!match) return null
  const price = Number(match[4].replaceAll(',', ''))
  const quantity = Number(match[5])
  const dueDays = Number(match[6])
  if (!Number.isFinite(price) || price <= 0 || price > 1_000_000 || !Number.isInteger(quantity) || quantity < 1 || quantity > 100 || dueDays < 1 || dueDays > 90) return null
  return { seller: match[1].trim(), buyer: match[2].trim(), item: match[3].trim(), unitPrice: price.toFixed(2), quantity: String(quantity), dueDays: String(dueDays) }
}

export default function InkVoiceExample({ onBack }: { onBack: () => void }) {
  const [input, setInput] = useState(sampleInput)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const quantity = Number(draft?.quantity)
  const unitPrice = Number(draft?.unitPrice)
  const dueDays = Number(draft?.dueDays)
  const validDraft = draft !== null && draft.seller.trim() && draft.buyer.trim() && draft.item.trim() && Number.isInteger(quantity) && quantity > 0 && quantity <= 100 && Number.isFinite(unitPrice) && unitPrice > 0 && unitPrice <= 1_000_000 && Number.isInteger(dueDays) && dueDays >= 1 && dueDays <= 90
  const total = validDraft ? quantity * unitPrice : null

  function fillDraft() {
    const parsed = parseInput(input)
    if (!parsed) {
      setDraft(null)
      setError('This example understands the shown invoice sentence format. Use the sample text or edit its names, item, HKD amount, quantity, and due days.')
      return
    }
    setDraft(parsed)
    setError('')
  }

  function updateDraft(field: keyof Draft, value: string) {
    setDraft((current) => current ? { ...current, [field]: value } : current)
  }

  return <>
    <div className="page-head"><div className="eyebrow">TOOL LIBRARY / EXAMPLE TOOL</div><h1>InkVoice invoice assistant</h1><p>Enter a fictional invoice request, fill an editable draft, and check every field before using it. This example is adapted from the InkVoice text input flow.</p></div>
    <div className="inkvoice-intro"><WandSparkles size={18} /><p><strong>AI input preview</strong> · This public example uses local text matching, not a live AI model. Your text stays in this browser and no invoice or payment request is sent.</p></div>
    <div className="work-grid builder-grid inkvoice-grid">
      <section className="panel form-panel">
        <div className="panel-top"><div className="panel-title"><span className="mini-icon lilac"><WandSparkles size={18} /></span><div><strong>Describe the invoice</strong><small>Plain language input · local example</small></div></div></div>
        <div className="field"><label htmlFor="inkvoice-input">AI input</label><textarea id="inkvoice-input" rows={6} maxLength={500} value={input} onChange={(event) => { setInput(event.target.value); setDraft(null); setError('') }} /><small>Try changing the fictional names, item, HKD price, quantity, or due days in the sample sentence.</small></div>
        {error && <p className="inkvoice-error" role="alert">{error}</p>}
        <div className="form-actions"><button className="button button-dark" onClick={fillDraft} disabled={!input.trim()}>Fill draft from text <ArrowRight size={15} /></button><button className="button button-light" onClick={() => { setInput(sampleInput); setDraft(null); setError('') }}><RotateCcw size={15} /> Reset example</button></div>
        {draft && <div className="inkvoice-fields"><h2>Review extracted fields</h2><p>Edit anything the text input filled incorrectly.</p><div className="field-row"><div className="field"><label htmlFor="inkvoice-seller">Seller</label><input id="inkvoice-seller" value={draft.seller} onChange={(event) => updateDraft('seller', event.target.value)} /></div><div className="field"><label htmlFor="inkvoice-buyer">Buyer</label><input id="inkvoice-buyer" value={draft.buyer} onChange={(event) => updateDraft('buyer', event.target.value)} /></div></div><div className="field"><label htmlFor="inkvoice-item">Item</label><input id="inkvoice-item" value={draft.item} onChange={(event) => updateDraft('item', event.target.value)} /></div><div className="field-row three"><div className="field"><label htmlFor="inkvoice-quantity">Days</label><input id="inkvoice-quantity" type="number" min="1" max="100" step="1" value={draft.quantity} onChange={(event) => updateDraft('quantity', event.target.value)} /></div><div className="field"><label htmlFor="inkvoice-price">HKD per day</label><input id="inkvoice-price" type="number" min="0.01" max="1000000" step="0.01" value={draft.unitPrice} onChange={(event) => updateDraft('unitPrice', event.target.value)} /></div><div className="field"><label htmlFor="inkvoice-due">Due in days</label><input id="inkvoice-due" type="number" min="1" max="90" step="1" value={draft.dueDays} onChange={(event) => updateDraft('dueDays', event.target.value)} /></div></div>{!validDraft && <p className="inkvoice-error" role="alert">Complete all fields with valid amounts and dates to see a total.</p>}</div>}
      </section>
      <section className="panel quote-panel inkvoice-preview"><div className="quote-top"><span className="quote-mark">InkVoice</span><span className="draft-stamp">SAMPLE / DRAFT</span></div><div className="quote-title"><span>INVOICE PREVIEW</span><h2>{draft?.item || 'Your invoice appears here'}</h2><p>{draft ? 'Filled from the text on this page · not issued' : 'Use the input to prepare a fictional draft.'}</p></div><div className="quote-parties"><div><small>FROM</small><strong>{draft?.seller || 'Seller not entered'}</strong></div><div><small>FOR</small><strong>{draft?.buyer || 'Buyer not entered'}</strong></div></div><div className="quote-line"><span>{draft ? `${draft.quantity} ${Number(draft.quantity) === 1 ? 'day' : 'days'}` : 'Item not entered'}<small>{draft ? `Due in ${draft.dueDays} days` : 'Due date not entered'}</small></span><strong>{total !== null ? `HKD ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</strong></div><div className="totals"><div className="total-final"><span>Draft total</span><strong>{total !== null ? `HKD ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</strong></div></div><div className="quote-gate"><p><ShieldCheck size={16} /> This is a fictional preview. No tax, banking details, or payment status is inferred.</p></div><p className="quote-disclaimer">NOT ISSUED · No PDF, invoice, or payment request is sent.</p></section>
    </div>
    <button className="next-step" onClick={onBack}><span><small>TOOL LIBRARY</small><strong>Back to example tools</strong></span><FileText size={19} /></button>
  </>
}
