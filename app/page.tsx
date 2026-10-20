'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownRight, ArrowRight, Bot, Check, CircleHelp, ClipboardCheck,
  FileText, Layers3, Library, MessageSquareText, Plus, RotateCcw, Send,
  ShieldCheck, Sparkles, Trash2, WandSparkles,
} from 'lucide-react'
import InkVoiceExample from './inkvoice-example'
import AccountingExample from './accounting-example'

type View = 'overview' | 'chat' | 'builder' | 'library' | 'inkvoice' | 'accounting'
type ChatMessage = { id: number; role: 'user' | 'assistant'; text: string; source: 'live' | 'sample' | 'status' }
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

const pillOptions = ['Select source', 'Flag missing fields', 'Calculate totals', 'Require human review']
const navItems: { id: View; label: string; icon: typeof Bot }[] = [
  { id: 'overview', label: 'Overview', icon: Layers3 },
  { id: 'chat', label: 'Chat', icon: MessageSquareText },
  { id: 'builder', label: 'Agent Builder', icon: WandSparkles },
  { id: 'library', label: 'Tool Library', icon: Library },
]

export default function Page() {
  const [view, setView] = useState<View>('overview')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatText, setChatText] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const chatTimer = useRef<number | null>(null)
  const chatAbort = useRef<AbortController | null>(null)
  const chatRequest = useRef(0)
  const [goal, setGoal] = useState('Prepare a reviewable quotation from sample Order W-01')
  const [toolName, setToolName] = useState('Workshop quotation assistant')
  const [pills, setPills] = useState<string[]>(['Select source', 'Flag missing fields', 'Require human review'])
  const [planVisible, setPlanVisible] = useState(false)
  const [runVisible, setRunVisible] = useState(false)
  const [savedTools, setSavedTools] = useState<SavedTool[]>([])
  const [editingToolId, setEditingToolId] = useState<number | null>(null)
  useEffect(() => () => { if (chatTimer.current) clearTimeout(chatTimer.current); chatAbort.current?.abort() }, [])

  function navigate(next: View) { setView(next); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  async function sendChat(prompt = chatText, sample = false) {
    const trimmed = prompt.trim()
    if (!trimmed || trimmed.length > 1200 || chatBusy) return
    setChatText('')
    const match = sample ? examples.find((item) => item.prompt === trimmed) : null
    const id = Date.now()
    setMessages((current) => [...current, { id, role: 'user', text: trimmed, source: sample ? 'sample' : 'live' }])
    setChatBusy(true)
    const request = ++chatRequest.current
    if (match) {
      chatTimer.current = window.setTimeout(() => {
        if (request !== chatRequest.current) return
        chatTimer.current = null
        setMessages((current) => [...current, { id: id + 1, role: 'assistant', text: match.answer, source: 'sample' }])
        setChatBusy(false)
      }, 450)
      return
    }
    const controller = new AbortController()
    chatAbort.current = controller
    try {
      const history = messages.filter((message) => message.source === 'live').slice(-7).map((message) => ({ role: message.role, content: message.text }))
      const response = await fetch('/api/live-chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [...history, { role: 'user', content: trimmed }] }), signal: controller.signal })
      if (request !== chatRequest.current) return
      const result = await response.json() as { answer?: string }
      if (!response.ok || typeof result.answer !== 'string') {
        setMessages((current) => [...current, { id: id + 1, role: 'assistant', source: 'status', text: response.status === 429 ? 'The live model is busy. Please try again in a moment.' : 'The live Mac mini connection is unavailable right now. The sample prompts remain available below.' }])
      } else {
        setMessages((current) => [...current, { id: id + 1, role: 'assistant', source: 'live', text: result.answer! }])
      }
    } catch {
      if (request === chatRequest.current) setMessages((current) => [...current, { id: id + 1, role: 'assistant', source: 'status', text: 'The live Mac mini connection is unavailable right now. Please try later or open a scripted sample below.' }])
    } finally {
      if (request === chatRequest.current) { setChatBusy(false); chatAbort.current = null }
    }
  }

  function clearChat() {
    chatRequest.current += 1
    if (chatTimer.current) clearTimeout(chatTimer.current)
    chatAbort.current?.abort()
    chatAbort.current = null
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
  return <div className="product-shell">
    <header className="top-header">
      <div className="header-left">
        {view !== 'overview' && <button className="back-button" onClick={() => navigate('overview')}><ArrowRight size={16} /> Back to Workspace</button>}
        <button className="brand" onClick={() => navigate('overview')} aria-label="EZAgent overview"><span className="brand-symbol"><Bot size={20} strokeWidth={2.1} /></span><strong>EZAgent</strong></button>
      </div>
      <div className="header-right"><span className="preview-pill"><span className="status-dot" /> EZAgent Product Web Preview</span></div>
    </header>
    {view !== 'overview' && <nav className="module-nav" aria-label="Workspace modules">{navItems.filter((item) => item.id !== 'overview').map(({ id, label }) => <button key={id} className={view === id || ((view === 'inkvoice' || view === 'accounting') && id === 'library') ? 'active' : ''} onClick={() => navigate(id)} aria-current={view === id || ((view === 'inkvoice' || view === 'accounting') && id === 'library') ? 'page' : undefined}>{label}</button>)}</nav>}
    <main className="main-panel">
      <div className={`content ${view === 'overview' ? 'home-wrap' : ''} ${view === 'inkvoice' ? 'iv-content' : ''}`}>
        {view === 'overview' && <section className="home-content">
          <div className="home-heading"><div className="eyebrow">EZAGENT PRODUCT WEB PREVIEW</div><h1>What would you like to do today?</h1><p>Explore the interactive web version of EZAgent. This Hackathon preview uses fictional records. Free-text Chat uses a live Mac mini model when the connection is online; suggested answers and agent plans are scripted examples.</p></div>
          <div className="feature-grid">{[
            { step: '01', title: 'Chat', description: 'Ask the live model or explore scripted sample answers.', icon: MessageSquareText, target: 'chat' as View },
            { step: '02', title: 'Agent Builder', description: 'Shape a repeatable workflow with logic steps and a reviewable plan.', icon: Sparkles, target: 'builder' as View, featured: true },
            { step: '03', title: 'Tool Library', description: 'Open InkVoice and the Accounting Statement Generator, or refine your saved tools.', icon: Library, target: 'library' as View },
          ].map((card) => <button key={card.step} className={`feature-card ${card.featured ? 'featured' : ''}`} onClick={() => navigate(card.target)}><div className="card-top"><span className="feature-icon"><card.icon size={20} strokeWidth={1.9} /></span>{card.featured && <span className="featured-badge">Featured</span>}</div><strong>{card.title}</strong><p>{card.description}</p>{card.target === 'library' && <span className="card-helper">Example tools are ready to explore. Your session tools appear here after you save one.</span>}</button>)}</div>
          <div className="home-footer"><p><strong>Product Web Preview:</strong> browser tools are interactive. Free-text Chat connects to the Mac mini only while the temporary gateway is online. Suggested answers and agent plans are examples. This site does not issue documents or send payment requests.</p><a href="https://ezagent-judge-demo.vercel.app/" target="_blank" rel="noreferrer">Open simulated judge demo <ArrowDownRight size={15} /></a></div>
        </section>}

        {view === 'chat' && <>
          <PageHead number="01" label="CHAT" title="Understand the request" description="Enter your own text for a live qwen3.5:9b reply, or select a suggested question for a scripted sample. Use fictional information only." />
          <div className="work-grid chat-grid"><section className="panel chat-panel"><div className="panel-top"><div className="panel-title"><span className="mini-icon peach"><MessageSquareText size={18} /></span><div><strong>Workspace chat</strong><small>Live Chat + scripted samples</small></div></div><button className="text-button" onClick={clearChat}><RotateCcw size={14} /> Clear</button></div><div className="messages" aria-live="polite">{messages.length === 0 ? <div className="empty-chat"><div className="empty-symbol"><Sparkles size={26} /></div><h3>Ask the live model</h3><p>Type your own question to contact qwen3.5:9b on the Mac mini. Suggested questions display prewritten samples.</p></div> : messages.map((message) => <div key={message.id} className={`message ${message.role}`}><span className="message-role">{message.role === 'user' ? 'You' : 'EZAgent preview'} {message.source === 'sample' && <em>Scripted sample</em>}{message.source === 'live' && <em>Live model</em>}{message.source === 'status' && <em>Connection status</em>}</span><p>{message.text}</p></div>)}{chatBusy && <div className="message assistant"><span className="message-role">EZAgent preview</span><p>Waiting for response<span className="typing-dots">…</span></p></div>}</div><div className="chat-compose"><label htmlFor="chat-input" className="sr-only">Your message</label><input id="chat-input" value={chatText} maxLength={1200} onChange={(event) => setChatText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') sendChat() }} placeholder="Ask about the workshop records…" /><button aria-label="Send message" onClick={() => sendChat()} disabled={!chatText.trim() || chatBusy}><Send size={17} /></button></div></section><aside className="side-stack"><section className="panel side-panel"><span className="eyebrow">TRY A SAMPLE</span><h3>Suggested questions</h3><div className="sample-list">{examples.map((item) => <button key={item.prompt} onClick={() => sendChat(item.prompt, true)} disabled={chatBusy}><span><strong>{item.title}</strong><small>{item.prompt}</small></span><ArrowRight size={16} /></button>)}</div></section><section className="note-card"><CircleHelp size={19} /><div><strong>About this preview</strong><p>Your own text is sent through Vercel and a temporary secured tunnel to qwen3.5:9b on a Mac mini. Replies can be slow or unavailable. Suggested questions always show labelled scripted samples. Do not enter personal or confidential data.</p></div></section></aside></div>
          <NextStep onClick={() => navigate('builder')} label="Next: turn the request into a tool" />
        </>}

        {view === 'builder' && <>
          <PageHead number="02" label="AGENT BUILDER" title="Make the work repeatable" description="Describe the goal, select the rules, and inspect a deterministic plan. Saved tools live only in this browser session." />
          <div className="work-grid builder-grid"><section className="panel form-panel"><div className="panel-top"><div className="panel-title"><span className="mini-icon lilac"><WandSparkles size={18} /></span><div><strong>Tool definition</strong><small>Editable preview</small></div></div></div><div className="field"><label htmlFor="tool-name">Tool name</label><input id="tool-name" value={toolName} onChange={(event) => setToolName(event.target.value)} maxLength={70} /></div><div className="field"><label htmlFor="goal">What should this tool do?</label><textarea id="goal" rows={5} value={goal} onChange={(event) => { setGoal(event.target.value); setPlanVisible(false); setRunVisible(false) }} maxLength={500} /><small>For this preview, the sample run is limited to Order W-01.</small></div><div className="field"><label>Logic steps <span className="field-hint">Choose at least one</span></label><div className="pill-list">{pillOptions.map((pill) => <button key={pill} type="button" className={`logic-pill ${pills.includes(pill) ? 'selected' : ''}`} aria-pressed={pills.includes(pill)} onClick={() => { togglePill(pill); setPlanVisible(false); setRunVisible(false) }}>{pills.includes(pill) ? <Check size={14} /> : <Plus size={14} />}{pill}</button>)}</div></div><div className="form-actions"><button className="button button-dark" disabled={!goal.trim() || !toolName.trim() || pills.length === 0} onClick={() => { setPlanVisible(true); setRunVisible(false) }}>Preview plan <ArrowRight size={15} /></button><button className="button button-light" disabled={!planVisible} onClick={saveTool}>{editingToolId === null ? 'Save tool for this session' : 'Update this session tool'}</button></div></section><section className="panel plan-panel"><div className="panel-top"><div className="panel-title"><span className="mini-icon mint"><ClipboardCheck size={18} /></span><div><strong>Review plan</strong><small>Deterministic preview, no agents started</small></div></div></div>{!planVisible ? <div className="plan-empty"><Layers3 size={31} /><h3>Your plan appears here</h3><p>Adjust the goal and rules, then select Preview plan.</p></div> : <div className="plan-content"><div className="plan-summary"><span className="tiny-label">GOAL</span><strong>{goal}</strong></div><div className="plan-steps">{pills.map((pill, index) => <div key={`${pill}-${index}`} className="plan-step"><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{pill}</strong><small>{pill === 'Select source' ? 'Use W-01 only; W-02 and R-01 stay context.' : pill === 'Flag missing fields' ? 'Identify buyer, date, price, currency and tax as missing.' : pill === 'Calculate totals' ? 'Use entered values; do not infer a price.' : 'Keep the draft behind a human confirmation gate.'}</small></div></div>)}</div><div className="plan-run"><button className="button button-dark" onClick={() => setRunVisible(true)}>Preview fixed sample <ArrowRight size={15} /></button><small>Uses the on-page W-01 fixture only.</small></div>{runVisible && <div className="run-result"><span className="result-badge"><Check size={14} /> Fixed sample evaluated</span><p>{pills.map((pill) => pill === 'Select source' ? 'Selected source: W-01. W-02 and R-01 remain context only.' : pill === 'Flag missing fields' ? 'The sample is missing buyer, exact date, unit price, currency, tax, and seller identity.' : pill === 'Calculate totals' ? 'A total needs an entered price, currency, and tax rate in a document tool.' : 'A person must inspect and confirm the draft before copying it.').join(' ')} No file, agent, or model was run.</p><button className="text-button" onClick={() => navigate('library')}>Browse example tools <ArrowRight size={14} /></button></div>}</div>}</section></div>
          <NextStep onClick={() => navigate('library')} label="Next: explore example tools" />
        </>}

        {view === 'library' && <>
          <PageHead number="03" label="TOOL LIBRARY" title="Keep useful patterns close" description="Explore ready-to-use examples and reopen tools you designed in this session. This preview resets when the page reloads." />
          <div className="section-heading compact"><div><span className="eyebrow">YOUR SESSION</span><h2>Saved tools</h2></div><button className="button button-light" onClick={createTool}><Plus size={15} /> Create a tool</button></div>
          {savedTools.length ? <div className="library-grid">{savedTools.map((tool) => <article key={tool.id} className="library-card"><span className="feature-icon lilac"><WandSparkles size={20} /></span><span className="tiny-label">SESSION TOOL</span><h3>{tool.name}</h3><p>{tool.goal}</p><div className="library-pills">{tool.pills.map((pill) => <span key={pill}>{pill}</span>)}</div><div className="library-actions"><button onClick={() => openTool(tool)}>Open & edit <ArrowRight size={14} /></button><button aria-label={`Delete ${tool.name}`} onClick={() => setSavedTools((current) => current.filter((item) => item.id !== tool.id))}><Trash2 size={16} /></button></div></article>)}</div> : <div className="library-empty"><Library size={27} /><strong>No tools saved yet</strong><p>Design a workflow in Agent Builder and save it for this session.</p><button className="button button-dark" onClick={createTool}>Open Agent Builder <ArrowRight size={15} /></button></div>}
          <div className="section-heading"><div><span className="eyebrow">STARTING POINTS</span><h2>Example tools</h2></div></div><div className="library-grid"><article className="library-card"><span className="feature-icon mint"><FileText size={20} /></span><span className="tiny-label">INTERACTIVE EXAMPLE</span><h3>Accounting Statement Generator</h3><p>Edit fictional income and expenses to generate a simple statement with a live total.</p><div className="library-actions"><button onClick={() => navigate('accounting')}>Open accounting tool <ArrowRight size={14} /></button></div></article><article className="library-card"><span className="feature-icon peach"><WandSparkles size={20} /></span><span className="tiny-label">TEXT INPUT EXAMPLE</span><h3>InkVoice</h3><p>Prepare a fictional quotation or invoice with editable fields and a live document preview.</p><div className="library-actions"><button onClick={() => navigate('inkvoice')}>Open InkVoice <ArrowRight size={14} /></button></div></article></div>
          <div className="overview-foot"><ShieldCheck size={20} /><p><strong>Nothing is deployed from this page.</strong> Session tools are temporary UI state; they do not create background agents, access local files, or persist after reload.</p></div>
        </>}
        {view === 'inkvoice' && <InkVoiceExample onBack={() => navigate('library')} />}
        {view === 'accounting' && <AccountingExample onBack={() => navigate('library')} />}
      </div>
    </main>
  </div>
}

function PageHead({ number, label, title, description }: { number: string; label: string; title: string; description: string }) { return <div className="page-head"><div className="eyebrow">{number} / {label}</div><h1>{title}</h1><p>{description}</p></div> }
function NextStep({ onClick, label }: { onClick: () => void; label: string }) { return <button className="next-step" onClick={onClick}><span><small>CONTINUE THE WALKTHROUGH</small><strong>{label}</strong></span><ArrowRight size={19} /></button> }
