'use client'

import { useMemo, useState } from 'react'
import { BookOpen, Copy, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import {
  AGENT_PERSONAS,
  LOGIC_PILL_KINDS,
  PROMPT_TEMPLATES,
  buildAgentPrompt,
  financePresetPills,
  generateLogicPills,
  pillsForTemplate,
  type LogicPill,
  type LogicPillKind,
} from '@/lib/yolanda-review/logic-pills'
import type { Assumptions } from '@/lib/yolanda-review/types'

const inputClass = 'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10'
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold outline-none transition active:translate-y-px focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45'
const categoryOrder = ['All', 'General', 'Finance', 'Operations', 'Product', 'Service'] as const

export function LogicPillStudio({ assumptions }: { assumptions: Assumptions }) {
  const financeTemplate = PROMPT_TEMPLATES.find((template) => template.id === 'finance-reconciliation')!
  const [category, setCategory] = useState<(typeof categoryOrder)[number]>('All')
  const [templateId, setTemplateId] = useState(financeTemplate.id)
  const [personaId, setPersonaId] = useState('operations-owner')
  const [objective, setObjective] = useState(financeTemplate.objective)
  const [description, setDescription] = useState('')
  const [pills, setPills] = useState<LogicPill[]>(() => financePresetPills(assumptions))
  const [notice, setNotice] = useState('Finance reconciliation preset loaded from the current execution settings.')
  const prompt = useMemo(() => buildAgentPrompt({ personaId, templateId, objective, pills }), [personaId, templateId, objective, pills])
  const visibleTemplates = category === 'All' ? PROMPT_TEMPLATES : PROMPT_TEMPLATES.filter((template) => template.category === category)

  function loadTemplate(id: string) {
    const template = PROMPT_TEMPLATES.find((item) => item.id === id)
    if (!template) return
    const next = id === 'finance-reconciliation' ? financePresetPills(assumptions) : pillsForTemplate(id)
    const userCreated = pills.filter((pill) => pill.source !== 'preset')
    const includedPreset = next.slice(0, Math.max(0, 20 - userCreated.length))
    setTemplateId(id)
    setObjective(template.objective)
    setPills([...includedPreset, ...userCreated])
    setNotice(includedPreset.length === next.length
      ? `${template.name} loaded. User-created pills were retained; review every pill before using the prompt.`
      : `${template.name} loaded with ${includedPreset.length} preset pills because all user-created pills were retained within the 20-pill limit.`)
  }

  function addGeneratedPills() {
    const generated = generateLogicPills(description, pills.map((pill) => pill.id))
    if (!generated.length) {
      setNotice('Describe at least one rule or requirement before generating pills.')
      return
    }
    const room = Math.max(0, 20 - pills.length)
    if (!room) {
      setNotice('This prototype supports up to 20 Logic Pills.')
      return
    }
    setPills((current) => [...current, ...generated.slice(0, room)])
    setDescription('')
    setNotice(`${Math.min(generated.length, room)} local rule-based pills added. No model was called.`)
  }

  function addBlankPill() {
    if (pills.length >= 20) {
      setNotice('This prototype supports up to 20 Logic Pills.')
      return
    }
    setPills((current) => [...current, { id: `manual-${Date.now()}`, kind: 'rule', title: 'New rule', instruction: '', enabled: true, source: 'manual' }])
    setNotice('Blank pill added. Add an instruction before using the prompt.')
  }

  function updatePill(id: string, patch: Partial<LogicPill>) {
    setPills((current) => current.map((pill) => pill.id === id ? { ...pill, ...patch } : pill))
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setNotice('Prompt copied to the clipboard. Copying does not run an agent or send data.')
    } catch {
      setNotice('Clipboard access was refused. Select the prompt preview and copy it manually.')
    }
  }

  return <section aria-labelledby="logic-studio-title" className="rounded-2xl border border-zinc-300 bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">01 · Logic design</p>
        <h2 id="logic-studio-title" className="mt-1 text-lg font-semibold">Logic Pills &amp; prompt templates</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-600">Build reusable agent instructions from plain language. This local prototype writes prompts only; it does not run an agent or change the reconciliation calculation.</p>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">Local rules, not AI generation</div>
    </div>

    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
      <div className="space-y-5">
        <div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="text-xs font-medium text-zinc-600">Template category
              <select aria-label="Template category" value={category} onChange={(event) => setCategory(event.target.value as (typeof categoryOrder)[number])} className={`${inputClass} min-w-44`}>
                {categoryOrder.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <span className="text-xs text-zinc-500">Broad starter templates included</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {visibleTemplates.map((template) => <button key={template.id} type="button" aria-pressed={template.id === templateId} onClick={() => loadTemplate(template.id)} className={`rounded-xl border p-3 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-950 ${template.id === templateId ? 'border-zinc-950 bg-zinc-950 text-white' : 'border-zinc-200 bg-zinc-50 hover:border-zinc-400'}`}>
              <span className="text-xs font-semibold">{template.category}</span>
              <span className="mt-1 block text-sm font-semibold">{template.name}</span>
              <span className={`mt-1 block text-xs leading-5 ${template.id === templateId ? 'text-zinc-300' : 'text-zinc-500'}`}>{template.description}</span>
            </button>)}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-zinc-700">Who is writing this workflow?</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {AGENT_PERSONAS.map((persona) => <button key={persona.id} type="button" aria-pressed={persona.id === personaId} onClick={() => setPersonaId(persona.id)} className={`rounded-xl border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 ${persona.id === personaId ? 'border-sky-700 bg-sky-50' : 'border-zinc-200'}`}>
              <span className="block text-sm font-semibold">{persona.name}</span><span className="mt-1 block text-xs leading-5 text-zinc-500">{persona.description}</span>
            </button>)}
          </div>
        </div>

        <label className="block text-xs font-medium text-zinc-600">Workflow objective
          <textarea aria-label="Workflow objective" value={objective} maxLength={500} onChange={(event) => setObjective(event.target.value)} className={`${inputClass} min-h-20 resize-y`} />
        </label>

        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <label className="block text-xs font-medium text-zinc-700">Describe your workflow in plain language
            <textarea aria-label="Describe your workflow in plain language" value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} placeholder="Example: Read the registration form; flag duplicate emails for human review; return missing fields and the next permitted action." className={`${inputClass} min-h-28 resize-y bg-white`} />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={addGeneratedPills} className={`${buttonClass} bg-zinc-950 text-white`}><Sparkles className="size-4" /> Generate pills</button>
            <button type="button" onClick={addBlankPill} className={`${buttonClass} border border-zinc-300 bg-white`}><Plus className="size-4" /> Add blank pill</button>
            <button type="button" onClick={() => { setCategory('Finance'); loadTemplate('finance-reconciliation') }} className={`${buttonClass} border border-zinc-300 bg-white`}><RotateCcw className="size-4" /> Sync finance preset</button>
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">The generator splits your text into editable clauses and classifies them with visible keyword rules. It does not infer hidden intent.</p>
        </div>
      </div>

      <div className="self-start rounded-xl border border-zinc-300 bg-[#faf9f6] p-4 xl:sticky xl:top-4">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-zinc-500">PROMPT PREVIEW</p><h3 className="mt-1 font-semibold">Reusable instruction</h3></div><BookOpen className="size-5 text-zinc-500" /></div>
        <textarea aria-label="Generated prompt preview" readOnly value={prompt} className="mt-3 min-h-[420px] w-full resize-y rounded-lg border border-zinc-300 bg-white p-3 font-mono text-xs leading-5 text-zinc-800 outline-none focus:ring-2 focus:ring-zinc-950" />
        <button type="button" onClick={copyPrompt} className={`${buttonClass} mt-3 w-full bg-zinc-950 text-white`}><Copy className="size-4" /> Copy prompt</button>
        <p className="mt-2 text-xs leading-5 text-zinc-500">Review before reuse. A prompt is not authentication, authorization, policy enforcement, or execution proof.</p>
        <div className="mt-4 border-t border-zinc-200 pt-4"><p className="text-sm font-semibold">Custom template service</p><p className="mt-1 text-xs leading-5 text-zinc-500">Planned membership feature. Billing, publishing, shared libraries, and personalized templates are not implemented.</p><button type="button" disabled className={`${buttonClass} mt-2 border border-zinc-300 bg-white`}>Membership templates coming later</button></div>
      </div>
    </div>

    <div className="mt-6 border-t border-zinc-200 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Editable Logic Pills</h3><p className="mt-1 text-xs text-zinc-500">{pills.filter((pill) => pill.enabled).length} active of {pills.length}. Maximum 20 in this prototype.</p></div><span role="status" className="text-xs text-zinc-600">{notice}</span></div>
      {pills.length ? <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {pills.map((pill, index) => <article key={pill.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700"><input type="checkbox" checked={pill.enabled} onChange={(event) => updatePill(pill.id, { enabled: event.target.checked })} /> Active</label>
            <div className="flex items-center gap-2"><span className="text-[11px] font-medium text-zinc-500">{pill.source}</span><button type="button" aria-label={`Delete ${pill.title || `Logic Pill ${index + 1}`}`} onClick={() => setPills((current) => current.filter((item) => item.id !== pill.id))} className="rounded-md p-2 text-red-700 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-700"><Trash2 className="size-4" /></button></div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
            <label className="text-xs font-medium text-zinc-600">Type<select aria-label={`Logic Pill ${index + 1} type`} value={pill.kind} onChange={(event) => updatePill(pill.id, { kind: event.target.value as LogicPillKind })} className={inputClass}>{LOGIC_PILL_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></label>
            <label className="text-xs font-medium text-zinc-600">Title<input aria-label={`Logic Pill ${index + 1} title`} value={pill.title} maxLength={60} onChange={(event) => updatePill(pill.id, { title: event.target.value })} className={inputClass} /></label>
          </div>
          <label className="mt-3 block text-xs font-medium text-zinc-600">Instruction<textarea aria-label={`Logic Pill ${index + 1} instruction`} value={pill.instruction} maxLength={500} onChange={(event) => updatePill(pill.id, { instruction: event.target.value })} className={`${inputClass} min-h-24 resize-y`} /></label>
        </article>)}
      </div> : <div className="mt-4 rounded-xl border border-dashed border-zinc-300 p-6 text-center"><p className="text-sm font-semibold">No Logic Pills yet</p><p className="mt-1 text-xs text-zinc-500">Load a template, describe a workflow, or add a blank pill.</p></div>}
    </div>
  </section>
}
