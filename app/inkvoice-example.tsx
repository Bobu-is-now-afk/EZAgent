'use client'

import { useRef, useState } from 'react'
import { ArrowRight, Plus, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'

type DocType = 'quotation' | 'invoice' | 'receipt'
type Currency = 'HKD' | 'TWD' | 'USD'
type Template = 'minimal' | 'modern' | 'azure' | 'accent'
type Item = { id: number; name: string; description: string; quantity: string; price: string }
type Party = { name: string; email: string; phone: string; address: string }
type Doc = {
  type: DocType; number: string; currency: Currency; issueDate: string; dueDate: string
  seller: Party; buyer: Party; items: Item[]; taxMode: 'none' | 'excluded' | 'included'
  discountType: 'none' | 'percent' | 'fixed'; discountValue: string; deposit: string; notes: string
}

const sampleInput = 'Please create an invoice from Demo Studio to Sample Client for a design workshop, HKD 1,800 per day for 2 days. Payment due in 14 days.'
const emptyParty = (): Party => ({ name: '', email: '', phone: '', address: '' })
const initialDoc = (): Doc => ({
  type: 'invoice', number: 'SAMPLE-INV-001', currency: 'HKD', issueDate: '', dueDate: '',
  seller: { ...emptyParty(), name: 'Demo Studio' }, buyer: { ...emptyParty(), name: 'Sample Client' },
  items: [{ id: 1, name: 'Design workshop', description: 'Fictional service', quantity: '2', price: '1800' }],
  taxMode: 'none', discountType: 'none', discountValue: '', deposit: '',
  notes: 'Sample draft for review only. No payment request is sent.',
})

function parseInput(input: string) {
  const match = input.trim().match(/^Please create an invoice from (.{1,80}?) to (.{1,80}?) for (.{1,100}?), HKD ([\d,]+(?:\.\d{1,2})?) per day for (\d{1,3}) days?\. Payment due in (\d{1,2}) days?\.$/i)
  if (!match) return null
  const price = Number(match[4].replaceAll(',', ''))
  const quantity = Number(match[5])
  const dueDays = Number(match[6])
  if (!match[1].trim() || !match[2].trim() || !match[3].trim() || !Number.isFinite(price) || price <= 0 || price > 1_000_000 || quantity < 1 || quantity > 100 || dueDays < 1 || dueDays > 90) return null
  return { seller: match[1].trim(), buyer: match[2].trim(), item: match[3].trim(), price, quantity, dueDays }
}

function dateOffset(days: number) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

function money(value: number, currency: Currency) {
  return currency + ' ' + value.toLocaleString('en-US', { minimumFractionDigits: currency === 'TWD' ? 0 : 2, maximumFractionDigits: currency === 'TWD' ? 0 : 2 })
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="iv-field"><span>{label}</span>{children}</label>
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="iv-section"><h2>{title}<span /></h2>{children}</section>
}

export default function InkVoiceExample({ onBack }: { onBack: () => void }) {
  const [doc, setDoc] = useState<Doc>(initialDoc)
  const [input, setInput] = useState(sampleInput)
  const [error, setError] = useState('')
  const [template, setTemplate] = useState<Template>('minimal')
  const [filled, setFilled] = useState(false)
  const nextId = useRef(2)
  const update = (patch: Partial<Doc>) => setDoc((current) => ({ ...current, ...patch }))
  const updateParty = (which: 'seller' | 'buyer', field: keyof Party, value: string) => setDoc((current) => ({ ...current, [which]: { ...current[which], [field]: value } }))
  const updateItem = (id: number, patch: Partial<Item>) => setDoc((current) => ({ ...current, items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item) }))
  const subtotal = doc.items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.price) || 0), 0)
  const discountValue = Math.max(0, Number(doc.discountValue) || 0)
  const discount = doc.discountType === 'percent' ? subtotal * Math.min(100, discountValue) / 100 : doc.discountType === 'fixed' ? Math.min(subtotal, discountValue) : 0
  const base = subtotal - discount
  const tax = doc.taxMode === 'excluded' ? base * 0.05 : doc.taxMode === 'included' ? base - base / 1.05 : 0
  const total = doc.taxMode === 'excluded' ? base + tax : base
  const deposit = total * Math.min(100, Math.max(0, Number(doc.deposit) || 0)) / 100
  const title = doc.type === 'quotation' ? 'QUOTATION' : doc.type === 'receipt' ? 'RECEIPT' : 'INVOICE'

  function fillFromText() {
    const parsed = parseInput(input)
    if (!parsed) { setError('This local example understands the shown sentence format. Change its fictional names, item, HKD amount, quantity, or due days.'); return }
    update({ type: 'invoice', number: 'SAMPLE-INV-001', currency: 'HKD', issueDate: dateOffset(0), dueDate: dateOffset(parsed.dueDays), seller: { ...doc.seller, name: parsed.seller }, buyer: { ...doc.buyer, name: parsed.buyer }, items: [{ id: nextId.current++, name: parsed.item, description: 'Filled from the sample text', quantity: String(parsed.quantity), price: String(parsed.price) }] })
    setError('')
    setFilled(true)
  }
  function reset() { setDoc(initialDoc()); setInput(sampleInput); setError(''); setFilled(false); setTemplate('minimal') }
  function changeType(type: DocType) { update({ type, number: 'SAMPLE-' + (type === 'quotation' ? 'QUO' : type === 'receipt' ? 'RCT' : 'INV') + '-001' }) }

  return <div className="iv-workspace">
    <div className="iv-heading"><div><span className="eyebrow">TOOL LIBRARY / EXAMPLE TOOL</span><h1>InkVoice</h1><p>Build a fictional quotation or invoice from editable fields and review the document beside them.</p></div><button className="button button-light" onClick={onBack}>Back to example tools <ArrowRight size={15} /></button></div>
    <div className="iv-note"><ShieldCheck size={17} /><span><strong>Text autofill example.</strong> The text box uses local pattern matching, not a live model. This tool uses fictional data in this browser; no invoice, receipt, or payment request is sent.</span></div>
    <div className="iv-layout">
      <div className="iv-form-column">
        <Section title="Text autofill example"><Field label="Enter a request and fill the form"><textarea id="iv-input" rows={5} maxLength={500} value={input} onChange={(event) => { setInput(event.target.value); setError('') }} /></Field><p className="iv-hint">Prepared example · Local autofill, no live AI request.</p>{error && <p className="iv-error" role="alert">{error}</p>}<div className="iv-actions"><button className="button button-dark" onClick={fillFromText} disabled={!input.trim()}>Fill invoice</button>{filled && <span className="iv-success">Review the filled fields below.</span>}</div></Section>
        <div className="iv-segment" role="group" aria-label="Document type">{(['quotation', 'invoice', 'receipt'] as const).map((type) => <button key={type} className={doc.type === type ? 'active' : ''} onClick={() => changeType(type)}>{type === 'quotation' ? 'Quotation' : type === 'receipt' ? 'Receipt' : 'Invoice'}</button>)}</div>
        <Section title="Document details"><div className="iv-two"><Field label="Document number"><input value={doc.number} maxLength={40} onChange={(event) => update({ number: event.target.value })} /></Field><Field label="Currency"><select value={doc.currency} onChange={(event) => update({ currency: event.target.value as Currency })}><option value="HKD">HKD</option><option value="TWD">TWD</option><option value="USD">USD</option></select></Field><Field label="Issue date"><input type="date" value={doc.issueDate} onChange={(event) => update({ issueDate: event.target.value })} /></Field><Field label={doc.type === 'quotation' ? 'Valid until' : doc.type === 'receipt' ? 'Payment date' : 'Payment due'}><input type="date" value={doc.dueDate} onChange={(event) => update({ dueDate: event.target.value })} /></Field></div></Section>
        <Section title="Your details (seller)"><div className="iv-two"><Field label="Name / studio"><input value={doc.seller.name} onChange={(event) => updateParty('seller', 'name', event.target.value)} /></Field><Field label="Email"><input type="email" value={doc.seller.email} onChange={(event) => updateParty('seller', 'email', event.target.value)} /></Field><Field label="Phone"><input value={doc.seller.phone} onChange={(event) => updateParty('seller', 'phone', event.target.value)} /></Field><Field label="Address"><input value={doc.seller.address} onChange={(event) => updateParty('seller', 'address', event.target.value)} /></Field></div></Section>
        <Section title="Client details"><div className="iv-two"><Field label="Client name"><input value={doc.buyer.name} onChange={(event) => updateParty('buyer', 'name', event.target.value)} /></Field><Field label="Contact"><input value={doc.buyer.email} onChange={(event) => updateParty('buyer', 'email', event.target.value)} /></Field><Field label="Phone"><input value={doc.buyer.phone} onChange={(event) => updateParty('buyer', 'phone', event.target.value)} /></Field><Field label="Address"><input value={doc.buyer.address} onChange={(event) => updateParty('buyer', 'address', event.target.value)} /></Field></div></Section>
        <Section title="Line items"><div className="iv-item-list">{doc.items.map((item, index) => <div className="iv-item" key={item.id}><div className="iv-item-head"><span>{String(index + 1).padStart(2, '0')}</span><button aria-label={'Remove item ' + (index + 1)} onClick={() => update({ items: doc.items.length === 1 ? [{ id: nextId.current++, name: '', description: '', quantity: '1', price: '' }] : doc.items.filter((entry) => entry.id !== item.id) })}><Trash2 size={15} /></button></div><Field label="Item"><input value={item.name} onChange={(event) => updateItem(item.id, { name: event.target.value })} /></Field><Field label="Description"><textarea rows={2} value={item.description} onChange={(event) => updateItem(item.id, { description: event.target.value })} /></Field><div className="iv-two"><Field label="Quantity"><input type="number" min="0" max="100" step="1" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: event.target.value })} /></Field><Field label={'Unit price (' + doc.currency + ')'}><input type="number" min="0" max="1000000" step="0.01" value={item.price} onChange={(event) => updateItem(item.id, { price: event.target.value })} /></Field></div><strong className="iv-item-total">{money((Number(item.quantity) || 0) * (Number(item.price) || 0), doc.currency)}</strong></div>)}</div><button className="iv-add" onClick={() => update({ items: [...doc.items, { id: nextId.current++, name: '', description: '', quantity: '1', price: '' }] })}><Plus size={15} /> Add item</button></Section>
        <Section title="Tax · discount · deposit"><div className="iv-two"><Field label="Tax"><select value={doc.taxMode} onChange={(event) => update({ taxMode: event.target.value as Doc['taxMode'] })}><option value="none">No sales tax</option><option value="excluded">Add 5% tax</option><option value="included">5% included</option></select></Field><Field label="Discount"><select value={doc.discountType} onChange={(event) => update({ discountType: event.target.value as Doc['discountType'], discountValue: '' })}><option value="none">No discount</option><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select></Field>{doc.discountType !== 'none' && <Field label={doc.discountType === 'percent' ? 'Discount %' : 'Discount ' + doc.currency}><input type="number" min="0" max={doc.discountType === 'percent' ? '100' : undefined} value={doc.discountValue} onChange={(event) => update({ discountValue: event.target.value })} /></Field>}<Field label="Deposit %"><input type="number" min="0" max="100" value={doc.deposit} onChange={(event) => update({ deposit: event.target.value })} /></Field></div></Section>
        <Section title="Notes & terms"><Field label="Notes shown on the draft"><textarea rows={4} value={doc.notes} onChange={(event) => update({ notes: event.target.value })} /></Field></Section>
        <div className="iv-form-footer"><span>Session preview · No customer data is saved.</span><button onClick={reset}><RotateCcw size={14} /> Reset example</button></div>
      </div>
      <div className="iv-preview-column"><div className="iv-template-picker" role="group" aria-label="Document template">{([['minimal', 'Minimal'], ['modern', 'Modern'], ['azure', 'Azure'], ['accent', 'Accent']] as const).map(([id, label]) => <button key={id} className={template === id ? 'active' : ''} onClick={() => setTemplate(id)}><span className={'iv-swatch ' + id} /><span><strong>{label}</strong><small>Sample</small></span></button>)}</div><button className="iv-print" onClick={() => window.print()}>Print / Save PDF draft</button><div className={'iv-sheet ' + template}><div className="iv-sheet-top"><div><h2>{title}</h2><span>SAMPLE / DRAFT</span></div><strong>{doc.seller.name || 'Seller name'}</strong></div><div className="iv-sheet-rule" /><div className="iv-sheet-meta"><div><small>NUMBER</small><strong>{doc.number || '—'}</strong></div><div><small>ISSUE DATE</small><strong>{doc.issueDate || '—'}</strong></div><div><small>{doc.type === 'quotation' ? 'VALID UNTIL' : 'DUE DATE'}</small><strong>{doc.dueDate || '—'}</strong></div></div><div className="iv-sheet-parties"><div><small>FROM</small><strong>{doc.seller.name || '—'}</strong><span>{doc.seller.email}</span><span>{doc.seller.address}</span></div><div><small>TO</small><strong>{doc.buyer.name || '—'}</strong><span>{doc.buyer.email}</span><span>{doc.buyer.address}</span></div></div><div className="iv-sheet-table"><div className="iv-sheet-row head"><span>#</span><span>ITEM</span><span>QTY</span><span>PRICE</span><span>AMOUNT</span></div>{doc.items.map((item, index) => <div className="iv-sheet-row" key={item.id}><span>{String(index + 1).padStart(2, '0')}</span><span><strong>{item.name || '—'}</strong><small>{item.description}</small></span><span>{item.quantity || '—'}</span><span>{money(Number(item.price) || 0, doc.currency)}</span><span>{money((Number(item.quantity) || 0) * (Number(item.price) || 0), doc.currency)}</span></div>)}</div><div className="iv-sheet-totals"><div><span>Subtotal</span><strong>{money(subtotal, doc.currency)}</strong></div>{discount > 0 && <div><span>Discount</span><strong>− {money(discount, doc.currency)}</strong></div>}{doc.taxMode !== 'none' && <div><span>Tax 5% {doc.taxMode === 'included' ? '(included)' : ''}</span><strong>{money(tax, doc.currency)}</strong></div>}<div className="final"><span>Total</span><strong>{money(total, doc.currency)}</strong></div>{deposit > 0 && <div><span>Deposit {doc.deposit}%</span><strong>{money(deposit, doc.currency)}</strong></div>}</div><div className="iv-sheet-notes"><small>NOTES & TERMS</small><p>{doc.notes || '—'}</p></div><div className="iv-sheet-footer">Fictional sample · Not issued · No payment verified</div></div></div>
    </div>
  </div>
}
