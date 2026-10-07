'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, Download, FolderOpen, Plus, Save, Sparkles, Trash2, Upload } from 'lucide-react'
import {
  addWorkflowRule,
  allWorkflowItems,
  answerWorkflowQuestion,
  buildWorkflowPrompt,
  canApplyCandidate,
  confirmWorkflow,
  confirmWorkflowItem,
  isWorkflowConfirmed,
  mergeOrganizedRequirement,
  organizeRequirement,
  parseWorkflowBackup,
  removeWorkflowItem,
  renameWorkflow,
  summarizeWorkflow,
  updateWorkflowItem,
  workflowValidationErrors,
  type WorkflowConfig,
  type WorkflowLocale,
  type WorkflowSection,
} from '@/lib/yolanda-review/workflow-config'
import { getSavedWorkflow, listSavedWorkflows, saveWorkflowVersion } from '@/lib/yolanda-review/workflow-storage'
import type { WorkflowSummary } from '@/lib/yolanda-review/workflow-config'

const inputClass = 'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-950 outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10'
const primaryButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white outline-none transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-300'
const secondaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2'

const COPY = {
  'zh-Hant': {
    title: '建立工作流程', subtitle: '告訴助手你想處理什麼，再確認它理解的規則。', localOnly: '本機規則整理，不是 AI 理解或執行', savedDrafts: '開啟本機草稿',
    steps: ['描述任務', '確認規則', '命名與儲存'], requirement: '你想重複處理什麼工作？', organize: '整理成步驟', reorganize: '重新整理', examples: '從範例開始',
    receiptExample: '幫我整理每個月的收據，提取日期、商戶和金額。缺少資訊時先問我，最後產生一份表格。',
    registrationExample: '整理新使用者登記資料，檢查必要欄位，發現重複電郵時交給人工確認。',
    invoiceExample: '改善發票收件流程，檢查必要欄位，遇到例外時分派給負責人。',
    summary: '任務摘要', edit: '修改', delete: '刪除', cancel: '取消', saveEdit: '儲存修改', confirm: '確認', addRule: '新增規則', confirmContinue: '確認並繼續', back: '返回修改需求',
    sections: { input: '使用資料', extract: '提取內容', process: '處理方式', exception: '遇到問題怎麼辦', output: '輸出結果' },
    sources: { 'user-request': '使用者明確要求', 'system-inference': '系統推測', 'user-edit': '使用者已修改' }, pending: '待確認', confirmed: '已確認', questions: '待確認事項', answer: '你的答案', applyAnswer: '確認答案', noQuestions: '沒有未解決的關鍵問題。',
    ruleText: '規則內容', ruleCategory: '規則分類', add: '加入規則', configurationStatus: '配置狀態', executionStatus: '執行能力', configReady: '目前版本已確認', configDraft: '草稿，仍需確認', notConnected: '能力未接入',
    workflowName: '工作流程名稱', saveWorkflow: '儲存工作流程', savedLocal: '已儲存到本機。工具庫入口尚未接入。', unsaved: '有尚未儲存的變更', advanced: '進階設定', prompt: '派生提示詞', configJson: '配置 JSON', backup: '下載配置備份', restore: '匯入配置備份',
    fixedLimits: '儲存不會執行工作、傳送訊息、覆寫檔案或擴大存取權限。', noDrafts: '尚無本機工作流程。', open: '開啟', storageUnavailable: '無法使用本機工作流程儲存。', imported: '配置已匯入；原確認與執行狀態已清除。',
  },
  en: {
    title: 'Create workflow', subtitle: 'Describe what you want to handle, then confirm the rules it understood.', localOnly: 'Local rule organizer, not AI understanding or execution', savedDrafts: 'Open local drafts',
    steps: ['Describe task', 'Confirm rules', 'Name & save'], requirement: 'What repeated work do you want to handle?', organize: 'Organize into steps', reorganize: 'Organize again', examples: 'Start from an example',
    receiptExample: 'Organize my monthly receipts. Extract the date, merchant, and amount. Ask me when information is missing, then create a table.',
    registrationExample: 'Organize new user registrations, check required fields, and send duplicate emails to human review.',
    invoiceExample: 'Improve invoice intake, check required fields, and assign exceptions to an accountable owner.',
    summary: 'Task summary', edit: 'Edit', delete: 'Delete', cancel: 'Cancel', saveEdit: 'Save edit', confirm: 'Confirm', addRule: 'Add rule', confirmContinue: 'Confirm & continue', back: 'Back to requirement',
    sections: { input: 'Information used', extract: 'Content to extract', process: 'Processing rules', exception: 'When something goes wrong', output: 'Result format' },
    sources: { 'user-request': 'Explicit user request', 'system-inference': 'System inference', 'user-edit': 'User edited' }, pending: 'Pending confirmation', confirmed: 'Confirmed', questions: 'Questions to resolve', answer: 'Your answer', applyAnswer: 'Confirm answer', noQuestions: 'No unresolved critical questions.',
    ruleText: 'Rule text', ruleCategory: 'Rule category', add: 'Add rule', configurationStatus: 'Configuration status', executionStatus: 'Execution capability', configReady: 'Current version confirmed', configDraft: 'Draft, confirmation required', notConnected: 'Capability not connected',
    workflowName: 'Workflow name', saveWorkflow: 'Save workflow', savedLocal: 'Saved locally. The library entry is not connected yet.', unsaved: 'Unsaved changes', advanced: 'Advanced settings', prompt: 'Derived prompt', configJson: 'Configuration JSON', backup: 'Download backup', restore: 'Import backup',
    fixedLimits: 'Saving does not run work, send messages, overwrite files, or expand access.', noDrafts: 'No local workflows yet.', open: 'Open', storageUnavailable: 'Local workflow storage is unavailable.', imported: 'Configuration imported; previous confirmation and execution status were cleared.',
  },
} as const

const sectionOrder: WorkflowSection[] = ['input', 'extract', 'process', 'exception', 'output']

function downloadJson(config: WorkflowConfig) {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `ezagent-workflow-${config.workflowId}-v${config.revision}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function WorkflowBuilder() {
  const [locale, setLocale] = useState<WorkflowLocale>('zh-Hant')
  const c = COPY[locale]
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [requirement, setRequirement] = useState('')
  const [config, setConfig] = useState<WorkflowConfig>()
  const configRef = useRef<WorkflowConfig | undefined>(undefined)
  const [editingId, setEditingId] = useState<string>()
  const [editText, setEditText] = useState('')
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)
  const [newSection, setNewSection] = useState<WorkflowSection>('process')
  const [newRule, setNewRule] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [savedRevision, setSavedRevision] = useState<number>()
  const [savedWorkflows, setSavedWorkflows] = useState<WorkflowSummary[]>([])
  const [showSaved, setShowSaved] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [organizing, setOrganizing] = useState(false)
  const activeRequestId = useRef('')

  useEffect(() => { configRef.current = config }, [config])
  useEffect(() => {
    listSavedWorkflows().then(setSavedWorkflows).catch(() => setNotice(c.storageUnavailable))
  }, [c.storageUnavailable])

  const summary = useMemo(() => config ? summarizeWorkflow(config) : undefined, [config])
  const preparedConfig = useMemo(() => {
    if (!config || !nameDraft.trim()) return config
    return renameWorkflow(config, nameDraft)
  }, [config, nameDraft])
  const prompt = useMemo(() => preparedConfig ? buildWorkflowPrompt(preparedConfig, locale) : '', [preparedConfig, locale])
  const isSaved = Boolean(config && savedRevision === config.revision && nameDraft === config.name)

  async function organize() {
    setError('')
    setNotice('')
    const base = configRef.current
    const sourceRevision = base?.revision ?? 0
    const requestId = globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}`
    activeRequestId.current = requestId
    setOrganizing(true)
    try {
      await Promise.resolve()
      const candidate = organizeRequirement(requirement, base?.workflowId, locale)
      const latest = configRef.current
      if (base) {
        if (!latest || !canApplyCandidate(requestId, activeRequestId.current, sourceRevision, latest.revision)) return
        const merged = mergeOrganizedRequirement(latest, candidate)
        setConfig(merged)
        setNameDraft(merged.name)
      } else {
        if (requestId !== activeRequestId.current || configRef.current) return
        setConfig(candidate)
        setNameDraft(candidate.name)
      }
      setStep(2)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not organize this requirement.')
    } finally {
      if (requestId === activeRequestId.current) setOrganizing(false)
    }
  }

  function applyConfig(next: WorkflowConfig) {
    setConfig(next)
    setError('')
    setNotice('')
  }

  function saveItem(id: string) {
    if (!config) return
    try {
      applyConfig(updateWorkflowItem(config, id, editText))
      setEditingId(undefined)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update the rule.') }
  }

  function addRule() {
    if (!config) return
    try {
      applyConfig(addWorkflowRule(config, newSection, newRule))
      setNewRule('')
      setAdding(false)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not add the rule.') }
  }

  function proceed() {
    if (!config) return
    try {
      const confirmed = confirmWorkflow(config)
      applyConfig(confirmed)
      setNameDraft(confirmed.name)
      setStep(3)
    } catch {
      setError(workflowValidationErrors(config, locale).join(' '))
    }
  }

  async function saveCurrent() {
    if (!config) return
    try {
      const named = renameWorkflow(config, nameDraft)
      if (!isWorkflowConfirmed(named)) throw new Error(locale === 'zh-Hant' ? '請先確認目前版本的全部規則。' : 'Confirm every rule in the current version first.')
      await saveWorkflowVersion(named)
      setConfig(named)
      setSavedRevision(named.revision)
      setSavedWorkflows(await listSavedWorkflows())
      setNotice(c.savedLocal)
      setError('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.storageUnavailable) }
  }

  async function openSaved(workflowId: string) {
    try {
      const saved = await getSavedWorkflow(workflowId)
      if (!saved) throw new Error('Workflow not found.')
      setConfig(saved)
      setRequirement(saved.goal)
      setNameDraft(saved.name)
      setSavedRevision(saved.revision)
      setStep(3)
      setShowSaved(false)
      setError('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.storageUnavailable) }
  }

  async function importBackup(file?: File) {
    if (!file) return
    try {
      const imported = parseWorkflowBackup(await file.text())
      setConfig(imported)
      setRequirement(imported.goal)
      setNameDraft(imported.name)
      setSavedRevision(undefined)
      setStep(2)
      setNotice(c.imported)
      setError('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not import this backup.') }
  }

  return <main lang={locale === 'zh-Hant' ? 'zh-Hant' : 'en'} className="min-h-[100dvh] bg-[#f5f3ee] text-zinc-950">
    <header className="border-b border-zinc-300 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">EZAgent · Workflow Builder</p><h1 className="mt-1 text-xl font-semibold">{c.title}</h1></div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-950">{c.localOnly}</span>
          <button type="button" onClick={() => setShowSaved((value) => !value)} className={secondaryButton}><FolderOpen className="size-4" />{c.savedDrafts}</button>
          <div className="inline-flex rounded-xl border border-zinc-300 bg-white p-1" aria-label="Language">
            {(['en', 'zh-Hant'] as const).map((value) => <button key={value} type="button" aria-pressed={locale === value} onClick={() => setLocale(value)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${locale === value ? 'bg-zinc-950 text-white' : 'text-zinc-600'}`}>{value === 'en' ? 'EN' : '繁中'}</button>)}
          </div>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
      {showSaved && <section aria-label={c.savedDrafts} className="mb-6 rounded-2xl border border-zinc-300 bg-white p-5">
        <h2 className="font-semibold">{c.savedDrafts}</h2>
        {savedWorkflows.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{savedWorkflows.map((value) => <button key={value.workflowId} type="button" onClick={() => openSaved(value.workflowId)} className="rounded-xl border border-zinc-200 p-3 text-left outline-none hover:border-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-950"><span className="font-medium">{value.name}</span><span className="mt-1 block text-xs text-zinc-500">v{value.revision} · {value.ruleCount} {locale === 'zh-Hant' ? '項規則' : 'rules'}</span></button>)}</div> : <p className="mt-2 text-sm text-zinc-600">{c.noDrafts}</p>}
      </section>}

      <nav aria-label="Workflow steps" className="mb-7 grid gap-2 sm:grid-cols-3">{c.steps.map((label, index) => {
        const number = index + 1
        const active = step === number
        const complete = step > number
        return <div key={label} aria-current={active ? 'step' : undefined} className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${active ? 'border-zinc-950 bg-white' : 'border-zinc-300 bg-transparent text-zinc-500'}`}><span className={`grid size-7 place-items-center rounded-full text-xs font-semibold ${active || complete ? 'bg-zinc-950 text-white' : 'border border-zinc-300'}`}>{complete ? <Check className="size-4" /> : number}</span><span className="text-sm font-semibold">{label}</span></div>
      })}</nav>

      {(error || notice) && <div role={error ? 'alert' : 'status'} className={`mb-5 rounded-xl border px-4 py-3 text-sm ${error ? 'border-red-300 bg-red-50 text-red-900' : 'border-emerald-300 bg-emerald-50 text-emerald-950'}`}>{error || notice}</div>}

      {step === 1 && <section data-builder-step="describe" className="rounded-2xl border border-zinc-300 bg-white p-5 sm:p-7">
        <div className="max-w-3xl"><h2 className="text-2xl font-semibold">{c.title}</h2><p className="mt-2 text-sm leading-6 text-zinc-600">{c.subtitle}</p>
          <label className="mt-7 block text-sm font-semibold">{c.requirement}<textarea aria-label={c.requirement} value={requirement} onChange={(event) => setRequirement(event.target.value)} maxLength={2000} className={`${inputClass} mt-2 min-h-40 resize-y`} /></label>
          <button type="button" onClick={organize} disabled={organizing || !requirement.trim()} className={`${primaryButton} mt-4`}><Sparkles className="size-4" />{config ? c.reorganize : c.organize}</button>
        </div>
        <div className="mt-8 border-t border-zinc-200 pt-6"><h3 className="text-sm font-semibold">{c.examples}</h3><div className="mt-3 grid gap-3 md:grid-cols-3">{[c.receiptExample, c.registrationExample, c.invoiceExample].map((example) => <button key={example} type="button" onClick={() => setRequirement(example)} className="rounded-xl border border-zinc-200 p-4 text-left text-sm leading-6 text-zinc-700 outline-none hover:border-zinc-400 focus-visible:ring-2 focus-visible:ring-zinc-950">{example}</button>)}</div></div>
      </section>}

      {step === 2 && config && <section data-builder-step="confirm" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <div className="rounded-2xl border border-zinc-300 bg-white p-5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{c.summary}</p><p className="mt-2 text-lg font-semibold leading-7">{config.goal}</p><p className="mt-2 text-xs text-zinc-500">v{config.revision} · {allWorkflowItems(config).length} rules</p></div>
          {sectionOrder.map((section) => {
            const values = allWorkflowItems(config).filter((value) => value.section === section)
            if (!values.length) return null
            return <section key={section} className="rounded-2xl border border-zinc-300 bg-white p-5"><h3 className="font-semibold">{c.sections[section]}</h3><div className="mt-3 space-y-3">{values.map((value) => <article key={value.id} data-workflow-item={value.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              {editingId === value.id ? <div><label className="text-xs font-medium text-zinc-600">{c.ruleText}<textarea aria-label={`${c.ruleText} ${value.id}`} value={editText} onChange={(event) => setEditText(event.target.value)} className={`${inputClass} mt-1 min-h-24 resize-y`} /></label><div className="mt-3 flex gap-2"><button type="button" onClick={() => saveItem(value.id)} className={primaryButton}>{c.saveEdit}</button><button type="button" onClick={() => setEditingId(undefined)} className={secondaryButton}>{c.cancel}</button></div></div> : <div className="flex items-start justify-between gap-4"><div><p className="text-sm leading-6">{value.text}</p><p className="mt-2 text-xs text-zinc-500">{c.sources[value.source]} · {value.confirmation === 'confirmed' ? c.confirmed : c.pending}</p></div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" onClick={() => { setEditingId(value.id); setEditText(value.text) }} className={secondaryButton}>{c.edit}</button>{value.confirmation === 'pending' && <button type="button" onClick={() => applyConfig(confirmWorkflowItem(config, value.id))} className={secondaryButton}>{c.confirm}</button>}<button type="button" aria-label={`${c.delete} ${value.text}`} onClick={() => applyConfig(removeWorkflowItem(config, value.id))} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-red-200 bg-white px-3 text-red-700 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-700"><Trash2 className="size-4" /></button></div></div>}
            </article>)}</div></section>
          })}
          {adding ? <section className="rounded-2xl border border-zinc-300 bg-white p-5"><div className="grid gap-3 sm:grid-cols-[200px_1fr]"><label className="text-xs font-medium text-zinc-600">{c.ruleCategory}<select aria-label={c.ruleCategory} value={newSection} onChange={(event) => setNewSection(event.target.value as WorkflowSection)} className={`${inputClass} mt-1`}>{sectionOrder.map((value) => <option key={value} value={value}>{c.sections[value]}</option>)}</select></label><label className="text-xs font-medium text-zinc-600">{c.ruleText}<textarea aria-label={c.ruleText} value={newRule} onChange={(event) => setNewRule(event.target.value)} className={`${inputClass} mt-1 min-h-24`} /></label></div><div className="mt-3 flex gap-2"><button type="button" onClick={addRule} className={primaryButton}>{c.add}</button><button type="button" onClick={() => setAdding(false)} className={secondaryButton}>{c.cancel}</button></div></section> : <button type="button" onClick={() => setAdding(true)} className={secondaryButton}><Plus className="size-4" />{c.addRule}</button>}
          <div className="flex flex-wrap justify-between gap-3"><button type="button" onClick={() => setStep(1)} className={secondaryButton}><ArrowLeft className="size-4" />{c.back}</button><button type="button" onClick={proceed} className={primaryButton}>{c.confirmContinue}<ChevronRight className="size-4" /></button></div>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-5 lg:self-start">
          <section className="rounded-2xl border border-zinc-300 bg-white p-5"><h3 className="font-semibold">{c.questions}</h3>{config.unresolvedQuestions.length ? <div className="mt-3 space-y-4">{config.unresolvedQuestions.map((question) => <div key={question.id}><p className="text-sm leading-6">{question.prompt}</p><label className="mt-2 block text-xs font-medium text-zinc-600">{c.answer}<input aria-label={`${c.answer} ${question.id}`} value={questionAnswers[question.id] ?? ''} onChange={(event) => setQuestionAnswers((current) => ({ ...current, [question.id]: event.target.value }))} className={`${inputClass} mt-1`} /></label><button type="button" onClick={() => { try { applyConfig(answerWorkflowQuestion(config, question.id, questionAnswers[question.id] ?? '')) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save the answer.') } }} className={`${secondaryButton} mt-2`}>{c.applyAnswer}</button></div>)}</div> : <p className="mt-2 text-sm text-zinc-600">{c.noQuestions}</p>}</section>
          <section className="rounded-2xl border border-zinc-300 bg-white p-5"><h3 className="font-semibold">{c.configurationStatus}</h3><p className="mt-2 text-sm">{isWorkflowConfirmed(config) ? c.configReady : c.configDraft}</p><p className="mt-4 text-xs leading-5 text-zinc-500">{c.fixedLimits}</p></section>
        </aside>
      </section>}

      {step === 3 && config && summary && <section data-builder-step="save" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-2xl border border-zinc-300 bg-white p-5 sm:p-7">
          <label className="block text-sm font-semibold">{c.workflowName}<input aria-label={c.workflowName} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={120} className={`${inputClass} mt-2`} /></label>
          <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4"><h2 className="font-semibold">{c.summary}</h2><p className="mt-2 text-sm leading-6 text-zinc-700">{config.goal}</p><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-zinc-500">{c.configurationStatus}</dt><dd className="mt-1 font-medium">{isWorkflowConfirmed(config) ? c.configReady : c.configDraft}</dd></div><div><dt className="text-xs text-zinc-500">{c.executionStatus}</dt><dd className="mt-1 font-medium">{config.execution.status === 'ready' ? 'Ready' : c.notConnected}</dd></div></dl></div>
          <div className="mt-5"><h3 className="text-sm font-semibold">{c.sections.process}</h3><ol className="mt-2 space-y-2">{allWorkflowItems(config).map((value) => <li key={value.id} className="flex gap-3 text-sm leading-6"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-zinc-950" aria-hidden="true" />{value.text}</li>)}</ol></div>
          <p className="mt-6 text-xs leading-5 text-zinc-500">{c.fixedLimits}</p>
          <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={saveCurrent} className={primaryButton}><Save className="size-4" />{c.saveWorkflow}</button><button type="button" onClick={() => setStep(2)} className={secondaryButton}><ArrowLeft className="size-4" />{c.edit}</button></div>
          <p className="mt-3 text-xs font-medium text-zinc-600">{isSaved ? c.savedLocal : c.unsaved}</p>
        </div>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-zinc-300 bg-white p-5"><h2 className="font-semibold">{c.executionStatus}</h2><p className="mt-2 text-sm font-medium">{c.notConnected}</p><p className="mt-2 text-xs leading-5 text-zinc-600">{config.execution.note}</p><ul className="mt-3 space-y-1 text-xs text-zinc-600">{config.requiredCapabilities.map((value) => <li key={value}><code>{value}</code></li>)}</ul></section>
          <details className="rounded-2xl border border-zinc-300 bg-white p-5"><summary className="cursor-pointer font-semibold outline-none focus-visible:ring-2 focus-visible:ring-zinc-950">{c.advanced}</summary><label className="mt-4 block text-xs font-medium text-zinc-600">{c.prompt}<textarea readOnly value={prompt} className={`${inputClass} mt-1 min-h-64 resize-y font-mono text-xs`} /></label><label className="mt-4 block text-xs font-medium text-zinc-600">{c.configJson}<textarea readOnly value={preparedConfig ? JSON.stringify(preparedConfig, null, 2) : ''} className={`${inputClass} mt-1 min-h-64 resize-y font-mono text-xs`} /></label></details>
          <section className="rounded-2xl border border-zinc-300 bg-white p-5"><div className="grid gap-2"><button type="button" onClick={() => preparedConfig && downloadJson(preparedConfig)} className={secondaryButton}><Download className="size-4" />{c.backup}</button><label className={`${secondaryButton} cursor-pointer`}><Upload className="size-4" />{c.restore}<input type="file" accept="application/json,.json" className="sr-only" onChange={(event) => importBackup(event.target.files?.[0])} /></label></div></section>
        </aside>
      </section>}
    </div>
  </main>
}
