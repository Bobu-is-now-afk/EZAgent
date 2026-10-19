'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownRight, ArrowRight, Bot, Check, ChevronRight, CircleHelp, ClipboardCheck,
  Copy, FileText, Layers3, Library, MessageSquareText, Plus, RotateCcw, Send,
  ShieldCheck, Sparkles, Trash2, WandSparkles, X,
} from 'lucide-react'

type View = 'overview' | 'chat' | 'builder' | 'documents' | 'library'
type ChatMessage = { id: number; role: 'user' | 'assistant'; text: string; scripted?: boolean }
type SavedTool = { id: number; name: string; goal: string; pills: string[] }

const examples = [
  {
    title: 'Find the quote source',
    prompt: 'Which sample record can be used to prepare a quotation?',
    answer: 'Order W-01 is the selected source. It requests a quotation for two workshop days next month. Order W-02 and Receipt R-01 are context only. The buyer, exact date, unit price, currency, and tax still need a person to enter and confirm them.',
  },
  {
    title: 'Check missing details',
    prompt: 'What is missing before the W-01 quotation can be confirmed?',
    answer: 'The W-01 request does not provide the seller, buyer, exact service date, unit price, currency, or tax rate. The draft should stay unconfirmed until a person supplies and checks these fields.',
  },
  {
    title: 'Review the receipt',
    prompt: 'Can Receipt R-01 be treated as payment proof?',
    answer: 'No. Receipt R-01 is a fictional context record with no payment evidence. This preview does not issue a receipt or confirm payment.',
  },
] as const

const sourceRecords = [
  { id: 'W-01', kind: 'Order', title: 'Two workshop days', detail: 'Create a quote for two workshop days next month. Buyer, exact date, unit price, currency, and tax are missing.', tag: 'Selected quote source' },
  { id: 'W-02', kind: 'Order', title: 'Workshop materials pack', detail: 'Request one workshop materials pack. Buyer and price are missing.', tag: 'Context only' },
  { id: 'R-01', kind: 'Receipt', title: 'Payment record', detail: 'Sample payment record has no payment proof. Do not issue a receipt.', tag: 'Context only · no payment evidence' },
] as const

const pillOptions = ['Select source', 'Flag missing fields', 'Calculate totals', 'Require human review']
const navItems: { id: View; label: string; icon: typeof Bot }[] = [
  { id: 'overview', label: 'Overview', icon: Layers3 },
  { id: 'chat', label: 'Chat', icon: MessageSquareText },
  { id: 'builder', label: 'Agent Builder', icon: WandSparkles },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'library', label: 'Tool Library', icon: Library },
]

function parseMoneyToCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null
  const [whole, fraction = ''] = value.trim().split('.')
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(result) ? result : null
}

function formatMoney(cents: number, currency: string): string {
  return `${currency || '—'} ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function Page() {
  const [view, setView] = useState<View>('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatText, setChatText] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const chatTimer = useRef<number | null>(null)
  const chatRequest = useRef(0)
  const [goal, setGoal] = useState('Prepare a reviewable quotation from sample Order W-01')
  const [toolName, setToolName] = useState('Workshop quotation assistant')
  const [pills, setPills] = useState<string[]>(['Select source', 'Flag missing fields', 'Require human review'])
  const [planVisible, setPlanVisible] = useState(false)
  const [runVisible, setRunVisible] = useState(false)
  const [savedTools, setSavedTools] = useState<SavedTool[]>([])
  const [editingToolId, setEditingToolId] = useState<number | null>(null)
  const [seller, setSeller] = useState('')
  const [buyer, setBuyer] = useState('')
  const [serviceDate, setServiceDate] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [quantity, setQuantity] = useState('2')
  const [currency, setCurrency] = useState('')
  const [taxRate, setTaxRate] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [copied, setCopied] = useState(false)

  const qty = Number(quantity)
  const priceCents = parseMoneyToCents(unitPrice)
  const tax = Number(taxRate)
  const validAmount = Number.isSafeInteger(qty) && qty > 0 && qty <= 100 && priceCents !== null && priceCents > 0 && priceCents <= 100000000
  const validTax = taxRate !== '' && Number.isFinite(tax) && tax >= 0 && tax <= 100
  const subtotalCents = validAmount ? qty * priceCents! : 0
  const taxCents = validAmount && validTax ? Math.round(subtotalCents * tax / 100) : 0
  const totalCents = subtotalCents + taxCents
  const missing = [!seller.trim() && 'Seller', !buyer.trim() && 'Buyer', !serviceDate && 'Service date', !currency && 'Currency', !validAmount && 'Valid quantity and unit price', !validTax && 'Tax rate'].filter(Boolean)
  const canConfirm = missing.length === 0
  const previewText = useMemo(() => `SAMPLE · DRAFT — NOT ISSUED\nQuotation source: Order W-01\nSeller: ${seller || '[missing]'}\nBuyer: ${buyer || '[missing]'}\nService date: ${serviceDate || '[missing]'}\nWorkshop days: ${quantity}\nUnit price: ${currency || '[currency]'} ${unitPrice || '[missing]'}\nSubtotal: ${formatMoney(subtotalCents, currency)}\nTax (${taxRate || '—'}%): ${formatMoney(taxCents, currency)}\nTotal: ${formatMoney(totalCents, currency)}\nNo payment requested.`, [seller, buyer, serviceDate, quantity, currency, unitPrice, subtotalCents, taxRate, taxCents, totalCents])

  useEffect(() => { setConfirmed(false) }, [seller, buyer, serviceDate, unitPrice, quantity, currency, taxRate])
  useEffect(() => () => { if (chatTimer.current) clearTimeout(chatTimer.current) }, [])

  function navigate(next: View) { setView(next); setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  function sendChat(prompt = chatText) {
    const trimmed = prompt.trim()
    if (!trimmed || chatBusy) return
    setChatText('')
    const match = examples.find((item) => item.prompt.toLowerCase() === trimmed.toLowerCase())
    const id = Date.now()
    setMessages((current) => [...current, { id, role: 'user', text: trimmed }])
    setChatBusy(true)
    const request = ++chatRequest.current
    chatTimer.current = window.setTimeout(() => {
      if (request !== chatRequest.current) return
      chatTimer.current = null
      setMessages((current) => [...current, {
        id: id + 1, role: 'assistant', scripted: true,
        text: match ? match.answer : 'This public preview has scripted answers for the three sample prompts above. Your text was not sent to a model. Choose a sample prompt to explore the workflow.',
      }])
      setChatBusy(false)
    }, 600)
  }

  function clearChat() {
    chatRequest.current += 1
    if (chatTimer.current) clearTimeout(chatTimer.current)
    chatTimer.current = null
    setMessages([])
    setChatBusy(false)
  }
  function togglePill(pill: string) { setPills((current) => current.includes(pill) ? current.filter((item) => item !== pill) : [...current, pill]) }
  function saveTool() {
    const name = toolName.trim()
    if (!name || !goal.trim() || pills.length === 0) return
    if (editingToolId !== null) {
      setSavedTools((current) => current.map((tool) => tool.id === editingToolId ? { ...tool, name, goal: goal.trim(), pills: [...pills] } : tool))
    } else {
      setSavedTools((current) => [...current, { id: Date.now(), name, goal: goal.trim(), pills: [...pills] }])
    }
    setEditingToolId(null)
    navigate('library')
  }
  function openTool(tool: SavedTool) { setEditingToolId(tool.id); setToolName(tool.name); setGoal(tool.goal); setPills(tool.pills); setPlanVisible(true); setRunVisible(false); navigate('builder') }
  function createTool() { setEditingToolId(null); setToolName('Workshop quotation assistant'); setGoal('Prepare a reviewable quotation from sample Order W-01'); setPills(['Select source', 'Flag missing fields', 'Require human review']); setPlanVisible(false); setRunVisible(false); navigate('builder') }
  async function copyPreview() {
    if (!confirmed) return
    try { await navigator.clipboard.writeText(previewText); setCopied(true); window.setTimeout(() => setCopied(false), 1800) } catch { setCopied(false) }
  }

  return <div className="product-shell">
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <button className="brand" onClick={() => navigate('overview')} aria-label="EZAgent overview"><span className="brand-symbol"><Sparkles size={20} strokeWidth={2.2} /></span><span><strong>EZAgent</strong><small>PRODUCT PREVIEW</small></span></button>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => navigate(id)} aria-current={view === id ? 'page' : undefined}><Icon size={18} strokeWidth={1.9} /><span>{label}</span>{view === id && <ChevronRight size={15} className="nav-chevron" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="status-dot" /> HACKATHON PREVIEW<p>Fictional records and scripted sample responses. No customer data is used.</p></div><a href="https://ezagent-judge-demo.vercel.app/" target="_blank" rel="noreferrer" className="sidebar-link">Open guided demo <ArrowDownRight size={15} /></a></div>
    </aside>
    {menuOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <main className="main-panel">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Layers3 size={20} /></button><div className="crumb"><span>Workspace</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.id === view)?.label}</strong></div><div className="topbar-right"><span className="preview-pill"><span className="status-dot" /> Synthetic preview</span><span className="topbar-avatar">EZ</span></div></header>
      <div className="content">
        {view === 'overview' && <>
          <div className="eyebrow">EZAGENT / HACKATHON PRODUCT PREVIEW</div><h1>Build a workflow.<br /><span className="heading-muted">Keep the human in control.</span></h1><p className="lede">Explore a web preview of an AI agent workspace. Follow one fictional workshop request from conversation to a reviewable quotation draft.</p>
          <div className="journey-banner"><div className="journey-icon"><Sparkles size={24} /></div><div><strong>Start with the workshop scenario</strong><p>Three sample records, one selected order, and a quotation that requires your review.</p></div><button className="button button-dark" onClick={() => navigate('chat')}>Start the walkthrough <ArrowRight size={16} /></button></div>
          <div className="section-heading"><div><span className="eyebrow">THE WORKSPACE</span><h2>One connected journey</h2></div><span className="muted-small">Choose any step to explore</span></div>
          <div className="feature-grid">{[
            { step: '01', title: 'Understand the request', description: 'Ask about the fictional records and identify what is still missing.', icon: MessageSquareText, target: 'chat' as View, accent: 'peach' },
            { step: '02', title: 'Design the agent', description: 'Turn an instruction into visible steps and a reusable tool draft.', icon: WandSparkles, target: 'builder' as View, accent: 'lilac' },
            { step: '03', title: 'Review the document', description: 'Enter missing details, recalculate totals, and confirm a sample draft.', icon: FileText, target: 'documents' as View, accent: 'mint' },
            { step: '04', title: 'Reuse your setup', description: 'Reopen tools saved in this browser session and refine their rules.', icon: Library, target: 'library' as View, accent: 'sky' },
          ].map((card) => <button key={card.step} className="feature-card" onClick={() => navigate(card.target)}><span className={`feature-icon ${card.accent}`}><card.icon size={22} /></span><span className="feature-step">{card.step} / 04</span><strong>{card.title}</strong><p>{card.description}</p><span className="feature-link">Explore <ArrowRight size={15} /></span></button>)}</div>
          <div className="overview-foot"><ShieldCheck size={20} /><p><strong>Clear boundaries.</strong> This site uses fictional data. Scripted answers are labeled; the quotation is a draft and cannot be issued or sent. Live Mac mini inference is not enabled on this preview.</p></div>
        </>}

        {view === 'chat' && <>
          <PageHead number="01" label="CHAT" title="Understand the request" description="Ask about the fixed workshop records. Select a sample prompt to see a scripted answer, or enter your own text to see the preview boundary." />
          <div className="work-grid chat-grid"><section className="panel chat-panel"><div className="panel-top"><div className="panel-title"><span className="mini-icon peach"><MessageSquareText size={18} /></span><div><strong>Workspace chat</strong><small>Scripted sample responses</small></div></div><button className="text-button" onClick={clearChat}><RotateCcw size={14} /> Clear</button></div><div className="messages" aria-live="polite">{messages.length === 0 ? <div className="empty-chat"><div className="empty-symbol"><Sparkles size={26} /></div><h3>Start with a sample question</h3><p>These answers are prewritten for the fictional workshop scenario. No model request is sent.</p></div> : messages.map((message) => <div key={message.id} className={`message ${message.role}`}><span className="message-role">{message.role === 'user' ? 'You' : 'EZAgent preview'} {message.scripted && <em>Scripted sample</em>}</span><p>{message.text}</p></div>)}{chatBusy && <div className="message assistant"><span className="message-role">EZAgent preview</span><p>Displaying sample response<span className="typing-dots">…</span></p></div>}</div><div className="chat-compose"><label htmlFor="chat-input" className="sr-only">Your message</label><input id="chat-input" value={chatText} onChange={(event) => setChatText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') sendChat() }} placeholder="Ask about the workshop records…" /><button aria-label="Send message" onClick={() => sendChat()} disabled={!chatText.trim() || chatBusy}><Send size={17} /></button></div></section><aside className="side-stack"><section className="panel side-panel"><span className="eyebrow">TRY A SAMPLE</span><h3>Suggested questions</h3><div className="sample-list">{examples.map((item) => <button key={item.prompt} onClick={() => sendChat(item.prompt)} disabled={chatBusy}><span><strong>{item.title}</strong><small>{item.prompt}</small></span><ArrowRight size={16} /></button>)}</div></section><section className="note-card"><CircleHelp size={19} /><div><strong>About this preview</strong><p>Live model replies are not available here yet. The sample prompts demonstrate intended behavior without claiming that an AI processed your input.</p></div></section></aside></div>
          <NextStep onClick={() => navigate('builder')} label="Next: turn the request into a tool" />
        </>}

        {view === 'builder' && <>
          <PageHead number="02" label="AGENT BUILDER" title="Make the work repeatable" description="Describe the goal, select the rules, and inspect a deterministic plan. Saved tools live only in this browser session." />
          <div className="work-grid builder-grid"><section className="panel form-panel"><div className="panel-top"><div className="panel-title"><span className="mini-icon lilac"><WandSparkles size={18} /></span><div><strong>Tool definition</strong><small>Editable preview</small></div></div></div><div className="field"><label htmlFor="tool-name">Tool name</label><input id="tool-name" value={toolName} onChange={(event) => setToolName(event.target.value)} maxLength={70} /></div><div className="field"><label htmlFor="goal">What should this tool do?</label><textarea id="goal" rows={5} value={goal} onChange={(event) => { setGoal(event.target.value); setPlanVisible(false); setRunVisible(false) }} maxLength={500} /><small>For this preview, the sample run is limited to Order W-01.</small></div><div className="field"><label>Logic steps <span className="field-hint">Choose at least one</span></label><div className="pill-list">{pillOptions.map((pill) => <button key={pill} type="button" className={`logic-pill ${pills.includes(pill) ? 'selected' : ''}`} aria-pressed={pills.includes(pill)} onClick={() => { togglePill(pill); setPlanVisible(false); setRunVisible(false) }}>{pills.includes(pill) ? <Check size={14} /> : <Plus size={14} />}{pill}</button>)}</div></div><div className="form-actions"><button className="button button-dark" disabled={!goal.trim() || !toolName.trim() || pills.length === 0} onClick={() => { setPlanVisible(true); setRunVisible(false) }}>Preview plan <ArrowRight size={15} /></button><button className="button button-light" disabled={!planVisible} onClick={saveTool}>{editingToolId === null ? 'Save tool for this session' : 'Update this session tool'}</button></div></section><section className="panel plan-panel"><div className="panel-top"><div className="panel-title"><span className="mini-icon mint"><ClipboardCheck size={18} /></span><div><strong>Review plan</strong><small>Deterministic preview, no agents started</small></div></div></div>{!planVisible ? <div className="plan-empty"><Layers3 size={31} /><h3>Your plan appears here</h3><p>Adjust the goal and rules, then select Preview plan.</p></div> : <div className="plan-content"><div className="plan-summary"><span className="tiny-label">GOAL</span><strong>{goal}</strong></div><div className="plan-steps">{pills.map((pill, index) => <div key={`${pill}-${index}`} className="plan-step"><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{pill}</strong><small>{pill === 'Select source' ? 'Use W-01 only; W-02 and R-01 stay context.' : pill === 'Flag missing fields' ? 'Identify buyer, date, price, currency and tax as missing.' : pill === 'Calculate totals' ? 'Use entered values; do not infer a price.' : 'Keep the draft behind a human confirmation gate.'}</small></div></div>)}</div><div className="plan-run"><button className="button button-dark" onClick={() => setRunVisible(true)}>Preview fixed sample <ArrowRight size={15} /></button><small>Uses the on-page W-01 fixture only.</small></div>{runVisible && <div className="run-result"><span className="result-badge"><Check size={14} /> Fixed sample evaluated</span><p>{pills.map((pill) => pill === 'Select source' ? 'Selected source: W-01. W-02 and R-01 remain context only.' : pill === 'Flag missing fields' ? 'The sample is missing buyer, exact date, unit price, currency, tax, and seller identity.' : pill === 'Calculate totals' ? 'A total cannot be calculated until a person enters the unit price, currency, and tax in Documents.' : 'A person must inspect and confirm the draft before copying it.').join(' ')} No file, agent, or model was run.</p><button className="text-button" onClick={() => navigate('documents')}>Open document review <ArrowRight size={14} /></button></div>}</div>}</section></div>
          <NextStep onClick={() => navigate('documents')} label="Next: review the quotation" />
        </>}

        {view === 'documents' && <>
          <PageHead number="03" label="DOCUMENTS" title="Review before anything leaves" description="Use Order W-01 to prepare one fictional quotation. Enter missing information yourself; no document is issued or sent." />
          <div className="record-row">{sourceRecords.map((record) => <article key={record.id} className={`record-card ${record.id === 'W-01' ? 'record-selected' : ''}`}><div className="record-heading"><span className="record-id">{record.id}</span><span className="record-kind">{record.kind}</span></div><h3>{record.title}</h3><p>{record.detail}</p><span className="record-tag">{record.tag}</span></article>)}</div>
          <div className="work-grid document-grid"><section className="panel form-panel"><div className="panel-top"><div className="panel-title"><span className="mini-icon mint"><FileText size={18} /></span><div><strong>Quotation details</strong><small>Source: sample Order W-01 only</small></div></div></div><div className="field-row"><div className="field"><label htmlFor="seller">Seller <Required /></label><input id="seller" value={seller} onChange={(event) => setSeller(event.target.value)} placeholder="Enter fictional seller" maxLength={90} /></div><div className="field"><label htmlFor="buyer">Buyer <Required /></label><input id="buyer" value={buyer} onChange={(event) => setBuyer(event.target.value)} placeholder="Enter fictional buyer" maxLength={90} /></div></div><div className="field-row"><div className="field"><label htmlFor="service-date">Service date <Required /></label><input id="service-date" type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} /></div><div className="field"><label htmlFor="currency">Currency <Required /></label><select id="currency" value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="">Select currency</option><option value="HKD">HKD</option><option value="USD">USD</option></select></div></div><div className="field-row three"><div className="field"><label htmlFor="quantity">Workshop days <Required /></label><input id="quantity" type="number" min="1" max="100" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div><div className="field"><label htmlFor="unit-price">Unit price <Required /></label><input id="unit-price" inputMode="decimal" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} placeholder="e.g. 1500.00" /></div><div className="field"><label htmlFor="tax-rate">Tax rate % <Required /></label><input id="tax-rate" type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(event) => setTaxRate(event.target.value)} placeholder="e.g. 0" /></div></div><div className="source-note"><ShieldCheck size={17} /><p>The source only provides the workshop description and two days. Seller, buyer, exact date, new price, currency and tax are not inferred.</p></div></section><section className="panel quote-panel"><div className="quote-top"><span className="quote-mark">EZ<span>Agent</span></span><span className="draft-stamp">SAMPLE / DRAFT</span></div><div className="quote-title"><span>QUOTATION PREVIEW</span><h2>Workshop services</h2><p>Prepared from Order W-01 · not issued</p></div><div className="quote-parties"><div><small>FROM</small><strong>{seller || 'Seller not entered'}</strong></div><div><small>FOR</small><strong>{buyer || 'Buyer not entered'}</strong></div></div><div className="quote-line"><span>{quantity || '—'} workshop {quantity === '1' ? 'day' : 'days'} <small>Service date: {serviceDate || 'to be confirmed'}</small></span><strong>{validAmount ? formatMoney(subtotalCents, currency) : '—'}</strong></div><div className="totals"><div><span>Subtotal</span><strong>{validAmount ? formatMoney(subtotalCents, currency) : '—'}</strong></div><div><span>Tax {validTax ? `(${tax}%)` : ''}</span><strong>{validAmount && validTax ? formatMoney(taxCents, currency) : '—'}</strong></div><div className="total-final"><span>Draft total</span><strong>{canConfirm ? formatMoney(totalCents, currency) : '—'}</strong></div></div><div className="quote-gate">{confirmed ? <p className="gate-success"><Check size={16} /> Reviewed for this browser session. Still a sample draft.</p> : <p><ShieldCheck size={16} /> {missing.length ? `Needs review: ${missing.join(', ')}.` : 'All required fields entered. Check the preview, then confirm.'}</p>}</div><div className="quote-actions"><button className="button button-dark" disabled={!canConfirm} onClick={() => setConfirmed(true)}><Check size={15} /> Confirm sample draft</button><button className="button button-light" disabled={!confirmed} onClick={copyPreview}><Copy size={15} /> {copied ? 'Copied' : 'Copy draft text'}</button></div><p className="quote-disclaimer">NOT FOR PAYMENT · No receipt, invoice or customer document is sent.</p></section></div>
          <NextStep onClick={() => navigate('library')} label="Next: explore reusable tools" />
        </>}

        {view === 'library' && <>
          <PageHead number="04" label="TOOL LIBRARY" title="Keep useful patterns close" description="Browse fixed example workflows and reopen tools you designed in this session. This preview resets when the page reloads." />
          <div className="section-heading compact"><div><span className="eyebrow">YOUR SESSION</span><h2>Saved tools</h2></div><button className="button button-light" onClick={createTool}><Plus size={15} /> Create a tool</button></div>
          {savedTools.length ? <div className="library-grid">{savedTools.map((tool) => <article key={tool.id} className="library-card"><span className="feature-icon lilac"><WandSparkles size={20} /></span><span className="tiny-label">SESSION TOOL</span><h3>{tool.name}</h3><p>{tool.goal}</p><div className="library-pills">{tool.pills.map((pill) => <span key={pill}>{pill}</span>)}</div><div className="library-actions"><button onClick={() => openTool(tool)}>Open & edit <ArrowRight size={14} /></button><button aria-label={`Delete ${tool.name}`} onClick={() => setSavedTools((current) => current.filter((item) => item.id !== tool.id))}><Trash2 size={16} /></button></div></article>)}</div> : <div className="library-empty"><Library size={27} /><strong>No tools saved yet</strong><p>Design a workflow in Agent Builder and save it for this session.</p><button className="button button-dark" onClick={createTool}>Open Agent Builder <ArrowRight size={15} /></button></div>}
          <div className="section-heading"><div><span className="eyebrow">STARTING POINTS</span><h2>Example patterns</h2></div></div><div className="library-grid"><article className="library-card"><span className="feature-icon mint"><FileText size={20} /></span><span className="tiny-label">FIXED EXAMPLE</span><h3>Workshop quotation review</h3><p>Select W-01, identify missing fields, and prepare a sample quotation for human review.</p><div className="library-actions"><button onClick={() => navigate('documents')}>Explore documents <ArrowRight size={14} /></button></div></article><article className="library-card"><span className="feature-icon peach"><MessageSquareText size={20} /></span><span className="tiny-label">FIXED EXAMPLE</span><h3>Source boundary check</h3><p>Compare W-01 against context-only W-02 and R-01 using clearly labeled sample replies.</p><div className="library-actions"><button onClick={() => navigate('chat')}>Explore chat <ArrowRight size={14} /></button></div></article></div>
          <div className="overview-foot"><ShieldCheck size={20} /><p><strong>Nothing is deployed from this page.</strong> Session tools are temporary UI state; they do not create background agents, access local files, or persist after reload.</p></div>
        </>}
      </div>
    </main>
  </div>
}

function Required() { return <span className="required" aria-label="required">*</span> }
function PageHead({ number, label, title, description }: { number: string; label: string; title: string; description: string }) { return <div className="page-head"><div className="eyebrow">{number} / {label}</div><h1>{title}</h1><p>{description}</p></div> }
function NextStep({ onClick, label }: { onClick: () => void; label: string }) { return <button className="next-step" onClick={onClick}><span><small>CONTINUE THE WALKTHROUGH</small><strong>{label}</strong></span><ArrowRight size={19} /></button> }
