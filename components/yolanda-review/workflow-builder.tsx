'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, Download, FolderOpen, Play, Plus, Save, Sparkles, Trash2, Upload } from 'lucide-react'
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
import { saveWorkflowVersion } from '@/lib/yolanda-review/workflow-storage'
import { downloadText } from '@/lib/yolanda-review/export'
import { buildTrialRunCsv, runReceiptJsonPreview, type TrialRunIssue, type TrialRunResult } from '@/lib/yolanda-review/workflow-runner'
import { canWorkflowAction, DEMO_WORKFLOW_IDENTITIES, normalizeWorkflowGovernance, stampWorkflowSave, type DemoWorkflowIdentity } from '@/lib/yolanda-review/workflow-governance'
import { WorkflowLibrary } from './workflow-library'

const inputClass = 'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-950 outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10'
const primaryButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white outline-none transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-300'
const secondaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45'

const COPY = {
  'zh-Hant': {
    title: '建立工作流程', subtitle: '告訴助手你想處理什麼，再確認它理解的規則。', localOnly: '本機規則整理，不是 AI 理解或完整執行', savedDrafts: '本機工作流庫',
    steps: ['描述任務', '確認規則', '命名與儲存'], requirement: '你想重複處理什麼工作？', organize: '整理成步驟', reorganize: '重新整理', examples: '從範例開始',
    receiptExample: '幫我整理每個月的收據，提取日期、商戶和金額。缺少資訊時先問我，最後產生一份表格。',
    registrationExample: '整理新使用者登記資料，檢查必要欄位，發現重複電郵時交給人工確認。',
    invoiceExample: '改善發票收件流程，檢查必要欄位，遇到例外時分派給負責人。',
    summary: '任務摘要', edit: '修改', delete: '刪除', cancel: '取消', saveEdit: '儲存修改', confirm: '確認', addRule: '新增規則', confirmContinue: '確認並繼續', back: '返回修改需求',
    sections: { input: '使用資料', extract: '提取內容', process: '處理方式', exception: '遇到問題怎麼辦', output: '輸出結果' },
    sources: { 'user-request': '使用者明確要求', 'system-inference': '系統推測', 'user-edit': '使用者已修改' }, pending: '待確認', confirmed: '已確認', questions: '待確認事項', answer: '你的答案', applyAnswer: '確認答案', noQuestions: '沒有未解決的關鍵問題。',
    ruleText: '規則內容', ruleCategory: '規則分類', add: '加入規則', configurationStatus: '配置狀態', executionStatus: '執行能力', configReady: '目前版本已確認', configDraft: '草稿，仍需確認', notConnected: '能力未接入',
    workflowName: '工作流程名稱', saveWorkflow: '儲存工作流配置', savedLocal: '已儲存到本機工作流庫，可在此瀏覽器重新開啟。', unsaved: '有尚未儲存的變更', advanced: '進階設定', prompt: '派生提示詞', configJson: '配置 JSON', backup: '下載配置備份', restore: '匯入配置備份',
    fixedLimits: '儲存不會執行工作、傳送訊息、覆寫檔案或擴大存取權限。', noDrafts: '尚無本機工作流程。', open: '開啟', storageUnavailable: '無法使用本機工作流程儲存。', imported: '配置已匯入；原確認與執行狀態已清除。',
    company: '公司', department: '部門', creator: '建立者', lastModified: '上次修改', unknown: '首次儲存後建立', demoIdentity: '目前演示身分', permissionDenied: '目前演示職級沒有此操作權限。前端檢查不是真實安全邊界。',
    trialTitle: '本機結構化資料試跑', trialDescription: '使用 JSON 資料驗證票據工作流的最小路徑。這不是 PDF／圖片 OCR，也不會執行任意提示詞。', trialInput: '試跑 JSON', trialExample: '載入範例資料', trialUpload: '匯入 JSON', trialRun: '開始本機試跑', trialSaveFirst: '先確認並儲存目前版本，才能試跑。', trialUnsupported: '目前只支援票據模板的結構化 JSON 試跑。', trialReady: '可輸出', trialReview: '需人工檢查', trialResult: '試跑結果', trialDownload: '下載試跑 CSV', trialNotSaved: '試跑結果只存在於目前頁面，重新整理後會消失。', totalRows: '總筆數', columns: { id: 'ID', date: '日期', merchant: '商戶', amount: '金額', currency: '幣種', status: '狀態' }, issues: { 'invalid-date': '日期必須是有效的 YYYY-MM-DD。', 'missing-merchant': '缺少商戶。', 'invalid-amount': '金額必須是非負數，最多兩位小數。', 'invalid-currency': '幣種必須是三個英文字母。' },
  },
  en: {
    title: 'Create workflow', subtitle: 'Describe what you want to handle, then confirm the rules it understood.', localOnly: 'Local rule organizer, not AI understanding or full execution', savedDrafts: 'Local workflow library',
    steps: ['Describe task', 'Confirm rules', 'Name & save'], requirement: 'What repeated work do you want to handle?', organize: 'Organize into steps', reorganize: 'Organize again', examples: 'Start from an example',
    receiptExample: 'Organize my monthly receipts. Extract the date, merchant, and amount. Ask me when information is missing, then create a table.',
    registrationExample: 'Organize new user registrations, check required fields, and send duplicate emails to human review.',
    invoiceExample: 'Improve invoice intake, check required fields, and assign exceptions to an accountable owner.',
    summary: 'Task summary', edit: 'Edit', delete: 'Delete', cancel: 'Cancel', saveEdit: 'Save edit', confirm: 'Confirm', addRule: 'Add rule', confirmContinue: 'Confirm & continue', back: 'Back to requirement',
    sections: { input: 'Information used', extract: 'Content to extract', process: 'Processing rules', exception: 'When something goes wrong', output: 'Result format' },
    sources: { 'user-request': 'Explicit user request', 'system-inference': 'System inference', 'user-edit': 'User edited' }, pending: 'Pending confirmation', confirmed: 'Confirmed', questions: 'Questions to resolve', answer: 'Your answer', applyAnswer: 'Confirm answer', noQuestions: 'No unresolved critical questions.',
    ruleText: 'Rule text', ruleCategory: 'Rule category', add: 'Add rule', configurationStatus: 'Configuration status', executionStatus: 'Execution capability', configReady: 'Current version confirmed', configDraft: 'Draft, confirmation required', notConnected: 'Capability not connected',
    workflowName: 'Workflow name', saveWorkflow: 'Save workflow configuration', savedLocal: 'Saved to the local workflow library. You can reopen it in this browser.', unsaved: 'Unsaved changes', advanced: 'Advanced settings', prompt: 'Derived prompt', configJson: 'Configuration JSON', backup: 'Download backup', restore: 'Import backup',
    fixedLimits: 'Saving does not run work, send messages, overwrite files, or expand access.', noDrafts: 'No local workflows yet.', open: 'Open', storageUnavailable: 'Local workflow storage is unavailable.', imported: 'Configuration imported; previous confirmation and execution status were cleared.',
    company: 'Company', department: 'Department', creator: 'Creator', lastModified: 'Last modified', unknown: 'Created after first save', demoIdentity: 'Current demo identity', permissionDenied: 'The current demo role cannot perform this action. Client checks are not a real security boundary.',
    trialTitle: 'Local structured-data trial', trialDescription: 'Use JSON data to exercise the minimum receipt workflow path. This is not PDF/image OCR and does not execute arbitrary prompts.', trialInput: 'Trial JSON', trialExample: 'Load sample data', trialUpload: 'Import JSON', trialRun: 'Run local trial', trialSaveFirst: 'Confirm and save the current version before running a trial.', trialUnsupported: 'Only the receipt template supports this structured JSON trial.', trialReady: 'Ready', trialReview: 'Needs review', trialResult: 'Trial result', trialDownload: 'Download trial CSV', trialNotSaved: 'Trial results exist only on this page and disappear after refresh.', totalRows: 'Total rows', columns: { id: 'ID', date: 'Date', merchant: 'Merchant', amount: 'Amount', currency: 'Currency', status: 'Status' }, issues: { 'invalid-date': 'Date must be a real YYYY-MM-DD date.', 'missing-merchant': 'Merchant is missing.', 'invalid-amount': 'Amount must be non-negative with at most two decimals.', 'invalid-currency': 'Currency must use three letters.' },
  },
} as const

const sectionOrder: WorkflowSection[] = ['input', 'extract', 'process', 'exception', 'output']
const trialExample = JSON.stringify([
  { id: 'receipt-001', date: '2026-10-07', merchant: 'North Pier Cafe', amount: '128.40', currency: 'HKD' },
  { id: 'receipt-002', date: '09/10', merchant: '', amount: '-8', currency: 'HKD' },
], null, 2)

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
  const [showSaved, setShowSaved] = useState(false)
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0)
  const [actor, setActor] = useState<DemoWorkflowIdentity>(DEMO_WORKFLOW_IDENTITIES.find((identity) => identity.userId === 'demo-yolanda') ?? DEMO_WORKFLOW_IDENTITIES[0])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [organizing, setOrganizing] = useState(false)
  const [trialInput, setTrialInput] = useState(trialExample)
  const [trialResult, setTrialResult] = useState<TrialRunResult>()
  const activeRequestId = useRef('')

  useEffect(() => { configRef.current = config }, [config])
  const summary = useMemo(() => config ? summarizeWorkflow(config) : undefined, [config])
  const preparedConfig = useMemo(() => {
    if (!config || !nameDraft.trim()) return config
    return renameWorkflow(config, nameDraft)
  }, [config, nameDraft])
  const prompt = useMemo(() => preparedConfig ? buildWorkflowPrompt(preparedConfig, locale) : '', [preparedConfig, locale])
  const isSaved = Boolean(config && savedRevision === config.revision && nameDraft === config.name)
  const governance = config ? normalizeWorkflowGovernance(config.governance) : undefined
  const canEditCurrent = config ? (savedRevision === undefined ? canWorkflowAction(actor, 'create') : canWorkflowAction(actor, 'edit', config)) : canWorkflowAction(actor, 'create')
  const canRunCurrent = Boolean(config && canWorkflowAction(actor, 'run', config))

  async function organize() {
    if (!canEditCurrent) { setError(c.permissionDenied); return }
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
    if (!canEditCurrent) { setError(c.permissionDenied); return }
    setConfig(next)
    setTrialResult(undefined)
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
    if (!canEditCurrent) { setError(c.permissionDenied); return }
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
      if (!canEditCurrent) throw new Error(c.permissionDenied)
      const named = renameWorkflow(config, nameDraft)
      if (!isWorkflowConfirmed(named)) throw new Error(locale === 'zh-Hant' ? '請先確認目前版本的全部規則。' : 'Confirm every rule in the current version first.')
      const saved = stampWorkflowSave(named, actor)
      await saveWorkflowVersion(saved)
      setConfig(saved)
      setSavedRevision(saved.revision)
      setLibraryRefreshKey((value) => value + 1)
      setNotice(c.savedLocal)
      setError('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.storageUnavailable) }
  }

  function openManaged(saved: WorkflowConfig, mode: 'view' | 'edit' | 'run') {
    setConfig(saved)
    setRequirement(saved.goal)
    setNameDraft(saved.name)
    setSavedRevision(saved.revision)
    setStep(mode === 'edit' ? 2 : 3)
    setShowSaved(false)
    setTrialResult(undefined)
    setError('')
    if (mode === 'run') window.setTimeout(() => document.querySelector('[data-trial-run]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  function startNewWorkflow() {
    if (!canWorkflowAction(actor, 'create')) { setError(c.permissionDenied); return }
    setConfig(undefined)
    setRequirement('')
    setNameDraft('')
    setSavedRevision(undefined)
    setTrialResult(undefined)
    setStep(1)
    setShowSaved(false)
    setError('')
    setNotice('')
  }

  function handleDeleted(workflowId: string) {
    if (config?.workflowId !== workflowId) return
    setConfig(undefined)
    setRequirement('')
    setNameDraft('')
    setSavedRevision(undefined)
    setTrialResult(undefined)
    setStep(1)
  }

  function handleManagedChange(saved: WorkflowConfig) {
    if (config?.workflowId !== saved.workflowId) return
    setConfig(saved)
    setNameDraft(saved.name)
    setSavedRevision(saved.revision)
    setTrialResult(undefined)
  }

  async function importBackup(file?: File) {
    if (!file) return
    try {
      if (!canEditCurrent) throw new Error(c.permissionDenied)
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

  async function importTrialInput(file?: File) {
    if (!file) return
    try {
      setTrialInput(await file.text())
      setTrialResult(undefined)
      setError('')
    } catch { setError(locale === 'zh-Hant' ? '無法讀取試跑檔案。' : 'Could not read the trial file.') }
  }

  function runTrial() {
    if (!config) return
    try {
      if (!isSaved) throw new Error(c.trialSaveFirst)
      if (!canRunCurrent) throw new Error(c.permissionDenied)
      setTrialResult(runReceiptJsonPreview(config, trialInput))
      setError('')
      setNotice('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.trialUnsupported) }
  }

  return <main lang={locale === 'zh-Hant' ? 'zh-Hant' : 'en'} className="min-h-[100dvh] bg-[#f5f3ee] text-zinc-950">
    <header className="border-b border-zinc-300 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">EZAgent · Workflow Builder</p><h1 className="mt-1 text-xl font-semibold">{c.title}</h1></div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-950">{c.localOnly}</span>
          <span className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700">{c.demoIdentity}: {actor.displayName}</span>
          <button type="button" onClick={() => setShowSaved((value) => !value)} className={secondaryButton}><FolderOpen className="size-4" />{c.savedDrafts}</button>
          <div className="inline-flex rounded-xl border border-zinc-300 bg-white p-1" aria-label="Language">
            {(['en', 'zh-Hant'] as const).map((value) => <button key={value} type="button" aria-pressed={locale === value} onClick={() => setLocale(value)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${locale === value ? 'bg-zinc-950 text-white' : 'text-zinc-600'}`}>{value === 'en' ? 'EN' : '繁中'}</button>)}
          </div>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6">
      {showSaved && <WorkflowLibrary locale={locale} actor={actor} refreshKey={libraryRefreshKey} onActorChange={(identity) => { setActor(identity); setEditingId(undefined); setError(''); setNotice('') }} onCreate={startNewWorkflow} onOpen={openManaged} onChanged={handleManagedChange} onDeleted={handleDeleted} />}

      {!showSaved && <>
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
          <button type="button" onClick={organize} disabled={organizing || !requirement.trim() || !canEditCurrent} className={`${primaryButton} mt-4`}><Sparkles className="size-4" />{config ? c.reorganize : c.organize}</button>
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
              {editingId === value.id ? <div><label className="text-xs font-medium text-zinc-600">{c.ruleText}<textarea aria-label={`${c.ruleText} ${value.id}`} value={editText} onChange={(event) => setEditText(event.target.value)} disabled={!canEditCurrent} className={`${inputClass} mt-1 min-h-24 resize-y`} /></label><div className="mt-3 flex gap-2"><button type="button" onClick={() => saveItem(value.id)} disabled={!canEditCurrent} className={primaryButton}>{c.saveEdit}</button><button type="button" onClick={() => setEditingId(undefined)} className={secondaryButton}>{c.cancel}</button></div></div> : <div className="flex items-start justify-between gap-4"><div><p className="text-sm leading-6">{value.text}</p><p className="mt-2 text-xs text-zinc-500">{c.sources[value.source]} · {value.confirmation === 'confirmed' ? c.confirmed : c.pending}</p></div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" disabled={!canEditCurrent} onClick={() => { setEditingId(value.id); setEditText(value.text) }} className={secondaryButton}>{c.edit}</button>{value.confirmation === 'pending' && <button type="button" disabled={!canEditCurrent} onClick={() => applyConfig(confirmWorkflowItem(config, value.id))} className={secondaryButton}>{c.confirm}</button>}<button type="button" disabled={!canEditCurrent} aria-label={`${c.delete} ${value.text}`} onClick={() => applyConfig(removeWorkflowItem(config, value.id))} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-red-200 bg-white px-3 text-red-700 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-700 disabled:cursor-not-allowed disabled:opacity-45"><Trash2 className="size-4" /></button></div></div>}
            </article>)}</div></section>
          })}
          {adding ? <section className="rounded-2xl border border-zinc-300 bg-white p-5"><div className="grid gap-3 sm:grid-cols-[200px_1fr]"><label className="text-xs font-medium text-zinc-600">{c.ruleCategory}<select aria-label={c.ruleCategory} value={newSection} disabled={!canEditCurrent} onChange={(event) => setNewSection(event.target.value as WorkflowSection)} className={`${inputClass} mt-1`}>{sectionOrder.map((value) => <option key={value} value={value}>{c.sections[value]}</option>)}</select></label><label className="text-xs font-medium text-zinc-600">{c.ruleText}<textarea aria-label={c.ruleText} value={newRule} disabled={!canEditCurrent} onChange={(event) => setNewRule(event.target.value)} className={`${inputClass} mt-1 min-h-24`} /></label></div><div className="mt-3 flex gap-2"><button type="button" onClick={addRule} disabled={!canEditCurrent} className={primaryButton}>{c.add}</button><button type="button" onClick={() => setAdding(false)} className={secondaryButton}>{c.cancel}</button></div></section> : <button type="button" onClick={() => setAdding(true)} disabled={!canEditCurrent} className={secondaryButton}><Plus className="size-4" />{c.addRule}</button>}
          <div className="flex flex-wrap justify-between gap-3"><button type="button" onClick={() => setStep(1)} className={secondaryButton}><ArrowLeft className="size-4" />{c.back}</button><button type="button" onClick={proceed} disabled={!canEditCurrent} className={primaryButton}>{c.confirmContinue}<ChevronRight className="size-4" /></button></div>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-5 lg:self-start">
          <section className="rounded-2xl border border-zinc-300 bg-white p-5"><h3 className="font-semibold">{c.questions}</h3>{config.unresolvedQuestions.length ? <div className="mt-3 space-y-4">{config.unresolvedQuestions.map((question) => <div key={question.id}><p className="text-sm leading-6">{question.prompt}</p><label className="mt-2 block text-xs font-medium text-zinc-600">{c.answer}<input aria-label={`${c.answer} ${question.id}`} value={questionAnswers[question.id] ?? ''} disabled={!canEditCurrent} onChange={(event) => setQuestionAnswers((current) => ({ ...current, [question.id]: event.target.value }))} className={`${inputClass} mt-1`} /></label><button type="button" disabled={!canEditCurrent} onClick={() => { try { applyConfig(answerWorkflowQuestion(config, question.id, questionAnswers[question.id] ?? '')) } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save the answer.') } }} className={`${secondaryButton} mt-2`}>{c.applyAnswer}</button></div>)}</div> : <p className="mt-2 text-sm text-zinc-600">{c.noQuestions}</p>}</section>
          <section className="rounded-2xl border border-zinc-300 bg-white p-5"><h3 className="font-semibold">{c.configurationStatus}</h3><p className="mt-2 text-sm">{isWorkflowConfirmed(config) ? c.configReady : c.configDraft}</p><p className="mt-4 text-xs leading-5 text-zinc-500">{c.fixedLimits}</p></section>
        </aside>
      </section>}

      {step === 3 && config && summary && <section data-builder-step="save" className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 rounded-2xl border border-zinc-300 bg-white p-5 sm:p-7">
          <label className="block text-sm font-semibold">{c.workflowName}<input aria-label={c.workflowName} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} disabled={!canEditCurrent} maxLength={120} className={`${inputClass} mt-2 disabled:bg-zinc-100 disabled:text-zinc-500`} /></label>
          <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4"><h2 className="font-semibold">{c.summary}</h2><p className="mt-2 text-sm leading-6 text-zinc-700">{config.goal}</p><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-zinc-500">{c.configurationStatus}</dt><dd className="mt-1 font-medium">{isWorkflowConfirmed(config) ? c.configReady : c.configDraft}</dd></div><div><dt className="text-xs text-zinc-500">{c.executionStatus}</dt><dd className="mt-1 font-medium">{config.execution.status === 'ready' ? 'Ready' : c.notConnected}</dd></div></dl></div>
          <dl className="mt-5 grid gap-3 rounded-xl border border-zinc-200 p-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-zinc-500">{c.company}</dt><dd className="mt-1 font-medium">{governance?.organizationName ?? actor.organizationName}</dd></div><div><dt className="text-xs text-zinc-500">{c.department}</dt><dd className="mt-1 font-medium">{governance?.departmentName ?? actor.departmentName}</dd></div><div><dt className="text-xs text-zinc-500">{c.creator}</dt><dd className="mt-1 font-medium">{governance?.creatorName ?? actor.displayName}</dd></div><div><dt className="text-xs text-zinc-500">{c.lastModified}</dt><dd className="mt-1 font-medium">{governance?.updatedAt ? new Date(governance.updatedAt).toLocaleString(locale === 'zh-Hant' ? 'zh-Hant' : 'en') : c.unknown}</dd></div></dl>
          <div className="mt-5"><h3 className="text-sm font-semibold">{c.sections.process}</h3><ol className="mt-2 space-y-2">{allWorkflowItems(config).map((value) => <li key={value.id} className="flex gap-3 text-sm leading-6"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-zinc-950" aria-hidden="true" />{value.text}</li>)}</ol></div>
          <p className="mt-6 text-xs leading-5 text-zinc-500">{c.fixedLimits}</p>
          <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={saveCurrent} disabled={!canEditCurrent} className={primaryButton}><Save className="size-4" />{c.saveWorkflow}</button><button type="button" onClick={() => setStep(2)} disabled={!canEditCurrent} className={`${secondaryButton} disabled:cursor-not-allowed disabled:opacity-45`}><ArrowLeft className="size-4" />{c.edit}</button></div>
          <p className="mt-3 text-xs font-medium text-zinc-600">{isSaved ? c.savedLocal : c.unsaved}</p>
          <section data-trial-run className="min-w-0 mt-7 border-t border-zinc-200 pt-6">
            <h2 className="font-semibold">{c.trialTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">{c.trialDescription}</p>
            {config.templateId === 'receipt-processing' ? <>
              <label className="mt-4 block text-xs font-medium text-zinc-600">{c.trialInput}<textarea aria-label={c.trialInput} value={trialInput} onChange={(event) => { setTrialInput(event.target.value); setTrialResult(undefined) }} className={`${inputClass} mt-1 min-h-52 resize-y font-mono text-xs`} /></label>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { setTrialInput(trialExample); setTrialResult(undefined) }} disabled={!canRunCurrent} className={`${secondaryButton} disabled:cursor-not-allowed disabled:opacity-45`}>{c.trialExample}</button><label className={`${secondaryButton} ${canRunCurrent ? 'cursor-pointer' : 'pointer-events-none opacity-45'}`}><Upload className="size-4" />{c.trialUpload}<input type="file" accept="application/json,.json" disabled={!canRunCurrent} className="sr-only" onChange={(event) => importTrialInput(event.target.files?.[0])} /></label><button type="button" onClick={runTrial} disabled={!isSaved || !canRunCurrent} className={primaryButton}><Play className="size-4" />{c.trialRun}</button></div>
              {!isSaved && <p className="mt-2 text-xs text-amber-800">{c.trialSaveFirst}</p>}
            </> : <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{c.trialUnsupported}</p>}

            {trialResult && <div className="mt-6" role="region" aria-label={c.trialResult}><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-semibold">{c.trialResult}</h3><p className="mt-1 text-xs text-zinc-500">v{trialResult.revision} · {c.totalRows} {trialResult.rows.length} · {c.trialReady} {trialResult.readyCount} · {c.trialReview} {trialResult.reviewCount}</p></div><button type="button" onClick={() => downloadText(`ezagent-${trialResult.workflowId}-v${trialResult.revision}-trial.csv`, buildTrialRunCsv(trialResult), 'text/csv;charset=utf-8')} className={secondaryButton}><Download className="size-4" />{c.trialDownload}</button></div>
              <div className="mt-3 max-w-full overflow-x-auto rounded-xl border border-zinc-200"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-zinc-100 text-xs text-zinc-600"><tr><th className="px-3 py-2">{c.columns.id}</th><th className="px-3 py-2">{c.columns.date}</th><th className="px-3 py-2">{c.columns.merchant}</th><th className="px-3 py-2">{c.columns.amount}</th><th className="px-3 py-2">{c.columns.currency}</th><th className="px-3 py-2">{c.columns.status}</th></tr></thead><tbody>{trialResult.rows.map((row) => <tr key={row.rowId} className="border-t border-zinc-200 align-top"><td className="px-3 py-3 font-mono text-xs">{row.rowId}</td><td className="px-3 py-3">{row.date || '—'}</td><td className="px-3 py-3">{row.merchant || '—'}</td><td className="px-3 py-3 tabular-nums">{row.amount || '—'}</td><td className="px-3 py-3">{row.currency}</td><td className="px-3 py-3"><span className="font-medium">{row.status === 'ready' ? c.trialReady : c.trialReview}</span>{row.issues.length > 0 && <ul className="mt-1 space-y-1 text-xs text-red-700">{row.issues.map((issue: TrialRunIssue) => <li key={issue}>{c.issues[issue]}</li>)}</ul>}</td></tr>)}</tbody></table></div>
              <p className="mt-3 text-xs leading-5 text-zinc-500">{c.trialNotSaved}</p>
            </div>}
          </section>
        </div>

        <aside className="min-w-0 space-y-5">
          <section className="rounded-2xl border border-zinc-300 bg-white p-5"><h2 className="font-semibold">{c.executionStatus}</h2><p className="mt-2 text-sm font-medium">{c.notConnected}</p><p className="mt-2 text-xs leading-5 text-zinc-600">{config.execution.note}</p><ul className="mt-3 space-y-1 text-xs text-zinc-600">{config.requiredCapabilities.map((value) => <li key={value}><code>{value}</code></li>)}</ul></section>
          <details className="rounded-2xl border border-zinc-300 bg-white p-5"><summary className="cursor-pointer font-semibold outline-none focus-visible:ring-2 focus-visible:ring-zinc-950">{c.advanced}</summary><label className="mt-4 block text-xs font-medium text-zinc-600">{c.prompt}<textarea readOnly value={prompt} className={`${inputClass} mt-1 min-h-64 resize-y font-mono text-xs`} /></label><label className="mt-4 block text-xs font-medium text-zinc-600">{c.configJson}<textarea readOnly value={preparedConfig ? JSON.stringify(preparedConfig, null, 2) : ''} className={`${inputClass} mt-1 min-h-64 resize-y font-mono text-xs`} /></label></details>
          <section className="rounded-2xl border border-zinc-300 bg-white p-5"><div className="grid gap-2"><button type="button" onClick={() => preparedConfig && downloadJson(preparedConfig)} className={secondaryButton}><Download className="size-4" />{c.backup}</button><label className={`${secondaryButton} ${canEditCurrent ? 'cursor-pointer' : 'pointer-events-none opacity-45'}`}><Upload className="size-4" />{c.restore}<input type="file" accept="application/json,.json" disabled={!canEditCurrent} className="sr-only" onChange={(event) => importBackup(event.target.files?.[0])} /></label></div></section>
        </aside>
      </section>}
      </>}
    </div>
  </main>
}
