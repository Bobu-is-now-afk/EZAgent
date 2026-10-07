'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, Download, FolderOpen, Play, Plus, Save, Sparkles, Trash2, Upload } from 'lucide-react'
import {
  addWorkflowRule,
  allWorkflowItems,
  answerWorkflowQuestion,
  buildWorkflowExplanationCard,
  buildWorkflowPrompt,
  canApplyCandidate,
  confirmWorkflow,
  confirmWorkflowPreviewParameter,
  isWorkflowConfirmed,
  mergeOrganizedRequirement,
  organizeRequirement,
  parseWorkflowBackup,
  removeWorkflowItem,
  renameWorkflow,
  summarizeWorkflow,
  updateWorkflowItem,
  updateWorkflowPreviewParameter,
  workflowValidationErrors,
  type WorkflowConfig,
  type WorkflowLocale,
  type WorkflowSection,
  type WorkflowPreviewParameterKey,
} from '@/lib/yolanda-review/workflow-config'
import { saveWorkflowVersion } from '@/lib/yolanda-review/workflow-storage'
import { downloadText } from '@/lib/yolanda-review/export'
import { buildTrialRunCsv, runReceiptJsonPreview, type TrialRunIssue, type TrialRunResult } from '@/lib/yolanda-review/workflow-runner'
import { canWorkflowAction, DEMO_WORKFLOW_IDENTITIES, stampWorkflowSave, type DemoWorkflowIdentity } from '@/lib/yolanda-review/workflow-governance'
import { WorkflowLibrary } from './workflow-library'
import { runWorkflowPreview, type WorkflowPreviewResult } from '@/lib/yolanda-review/workflow-preview'

const inputClass = 'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-950 outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10'
const primaryButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white outline-none transition hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-300'
const secondaryButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45'

const COPY = {
  'zh-Hant': {
    title: '你想讓助手重複完成什麼？', subtitle: '先從例子或一句話開始，再確認少量關鍵決定。', localOnly: '本機規則整理，不是 AI 理解或完整執行', savedDrafts: '本機工作流庫',
    steps: ['描述任務', '確認決定', '說明與儲存'], requirement: '描述其他任務', organize: '整理需求', reorganize: '重新整理', examples: '從例子開始',
    receiptStart: '從收據整理例子開始', otherStart: '描述其他任務', sampleQuestion: '你希望得到這樣的表格嗎？下一步可以修改規則。', sampleOnly: '輸出示例，不是已處理的業務資料。', unsupportedEarly: '可以整理和儲存規則；該場景暫未接入執行能力。',
    receiptExample: '幫我整理每個月的收據，提取日期、商戶和金額。缺少資訊時先問我，最後產生一份表格。',
    registrationExample: '整理新使用者登記資料，檢查必要欄位，發現重複電郵時交給人工確認。',
    invoiceExample: '改善發票收件流程，檢查必要欄位，遇到例外時分派給負責人。',
    summary: '任務摘要', edit: '修改', delete: '刪除', cancel: '取消', saveEdit: '儲存修改', confirm: '確認', addRule: '新增規則', confirmContinue: '確認並繼續', back: '返回修改需求',
    sections: { input: '使用資料', extract: '提取內容', process: '處理方式', exception: '遇到問題怎麼辦', output: '輸出結果' },
    sources: { 'user-request': '使用者明確要求', 'template-default': '建議設定', 'system-inference': '系統推測', 'user-edit': '使用者已修改' }, pending: '待確認', confirmed: '已確認', questions: '待確認事項', answer: '你的答案', applyAnswer: '確認答案', noQuestions: '沒有未解決的關鍵問題。',
    ruleText: '規則內容', ruleCategory: '規則分類', add: '加入規則', configurationStatus: '配置狀態', executionStatus: '執行能力', configReady: '目前版本已確認', configDraft: '草稿，仍需確認', notConnected: '能力未接入',
    workflowName: '工作流程名稱', saveWorkflow: '儲存工作流', savedLocal: '已儲存。保存於此瀏覽器；更換瀏覽器、網站地址或清除網站資料後可能無法找到。', unsaved: '有尚未儲存的變更', advanced: '進階設定', prompt: '派生提示詞', configJson: '配置 JSON', backup: '下載配置備份', restore: '匯入配置備份',
    decisions: '需要你決定的事項', knownRules: '已經明確的規則', acceptSuggestion: '採用建議', dateDecision: '日期 09/10/2026 如何解釋？', currencyDecision: '接受哪些幣種？', missingDecision: '缺少商戶時怎麼辦？', needsReview: '交給人工檢查', keepEmpty: '保留空值並標記', previewTitle: '規則預演', previewHelp: '使用內置例子顯示目前設定的影響。這不是實際工作流執行。', originalExample: '原始例子', currentResult: '目前結果', causedBy: '依據規則', changedFrom: '修改前', unsupportedPreview: '這條規則已儲存，但尚未接入預演。', mapped: '已映射到預演參數', recordedOnly: '僅記錄，尚未映射', includedUsd: '以 USD 20.00 納入，不換匯', reviewNoConversion: '標記待處理，不換匯', missingReviewResult: '交給人工檢查', missingKeepResult: '保留空白商戶並加上警告',
    cardUses: '使用資料', cardResult: '生成結果', cardExceptions: '特殊情況', cardWillNot: '不會執行', cardCapability: '目前能力', openLibrary: '打開工作流庫', reuseRules: '沿用規則', modifyRules: '修改規則', reuseNotice: '已選用目前規則；實際運行入口仍需由 JASON 接入。', developerValidation: '開發驗證：結構化 JSON 校驗', previewStatus: '預演狀態', previewPartial: '部分規則已預演', previewUnavailable: '尚無可預演規則', explanationTitle: '工作流說明卡', savedActions: '接下來',
    fixedLimits: '儲存不會執行工作、傳送訊息、覆寫檔案或擴大存取權限。', noDrafts: '尚無本機工作流程。', open: '開啟', storageUnavailable: '無法使用本機工作流程儲存。', imported: '配置已匯入；原確認與執行狀態已清除。',
    company: '公司', department: '部門', creator: '建立者', lastModified: '上次修改', unknown: '首次儲存後建立', demoIdentity: '目前演示身分', permissionDenied: '目前演示職級沒有此操作權限。前端檢查不是真實安全邊界。',
    trialTitle: '本機結構化資料校驗', trialDescription: '使用 JSON 資料檢查票據資料的固定結構。這不是規則預演、PDF／圖片 OCR，也不會執行任意提示詞。', trialInput: '校驗 JSON', trialExample: '載入範例資料', trialUpload: '匯入 JSON', trialRun: '開始資料校驗', trialSaveFirst: '先確認並儲存目前版本，才能校驗。', trialUnsupported: '目前只支援票據模板的結構化 JSON 校驗。', trialReady: '可輸出', trialReview: '需人工檢查', trialResult: '校驗結果', trialDownload: '下載校驗 CSV', trialNotSaved: '校驗結果只存在於目前頁面，重新整理後會消失。', totalRows: '總筆數', columns: { id: 'ID', date: '日期', merchant: '商戶', amount: '金額', currency: '幣種', status: '狀態' }, issues: { 'invalid-date': '日期必須是有效的 YYYY-MM-DD。', 'missing-merchant': '缺少商戶。', 'invalid-amount': '金額必須是非負數，最多兩位小數。', 'missing-currency': '缺少幣種；不會靜默補成 HKD。', 'invalid-currency': '幣種必須是三個英文字母。' },
  },
  en: {
    title: 'What should the assistant repeat for you?', subtitle: 'Start with an example or one sentence, then confirm a few key decisions.', localOnly: 'Local rule organizer, not AI understanding or full execution', savedDrafts: 'Local workflow library',
    steps: ['Describe task', 'Confirm decisions', 'Explain & save'], requirement: 'Describe another task', organize: 'Organize requirement', reorganize: 'Organize again', examples: 'Start from an example',
    receiptStart: 'Start with receipt organization', otherStart: 'Describe another task', sampleQuestion: 'Is this the table you want? You can change the rules next.', sampleOnly: 'Output example, not processed business data.', unsupportedEarly: 'You can organize and save rules; execution is not connected for this scenario.',
    receiptExample: 'Organize my monthly receipts. Extract the date, merchant, and amount. Ask me when information is missing, then create a table.',
    registrationExample: 'Organize new user registrations, check required fields, and send duplicate emails to human review.',
    invoiceExample: 'Improve invoice intake, check required fields, and assign exceptions to an accountable owner.',
    summary: 'Task summary', edit: 'Edit', delete: 'Delete', cancel: 'Cancel', saveEdit: 'Save edit', confirm: 'Confirm', addRule: 'Add rule', confirmContinue: 'Confirm & continue', back: 'Back to requirement',
    sections: { input: 'Information used', extract: 'Content to extract', process: 'Processing rules', exception: 'When something goes wrong', output: 'Result format' },
    sources: { 'user-request': 'Explicit user request', 'template-default': 'Suggested setting', 'system-inference': 'System inference', 'user-edit': 'User edited' }, pending: 'Pending confirmation', confirmed: 'Confirmed', questions: 'Questions to resolve', answer: 'Your answer', applyAnswer: 'Confirm answer', noQuestions: 'No unresolved critical questions.',
    ruleText: 'Rule text', ruleCategory: 'Rule category', add: 'Add rule', configurationStatus: 'Configuration status', executionStatus: 'Execution capability', configReady: 'Current version confirmed', configDraft: 'Draft, confirmation required', notConnected: 'Capability not connected',
    workflowName: 'Workflow name', saveWorkflow: 'Save workflow', savedLocal: 'Saved in this browser. It may be unavailable after changing browser, site address, or clearing site data.', unsaved: 'Unsaved changes', advanced: 'Advanced settings', prompt: 'Derived prompt', configJson: 'Configuration JSON', backup: 'Download configuration backup', restore: 'Import configuration backup',
    decisions: 'Decisions for you', knownRules: 'Rules already understood', acceptSuggestion: 'Use suggestion', dateDecision: 'How should 09/10/2026 be interpreted?', currencyDecision: 'Which currencies are accepted?', missingDecision: 'What happens when merchant is missing?', needsReview: 'Send to human review', keepEmpty: 'Keep empty and mark', previewTitle: 'Rule preview', previewHelp: 'Built-in examples show the effect of current settings. This is not an actual workflow run.', originalExample: 'Original example', currentResult: 'Current result', causedBy: 'Rule applied', changedFrom: 'Before change', unsupportedPreview: 'This rule is saved but not connected to preview.', mapped: 'Mapped to preview parameter', recordedOnly: 'Recorded only, not mapped', includedUsd: 'Include as USD 20.00 without conversion', reviewNoConversion: 'Mark for review without conversion', missingReviewResult: 'Send to human review', missingKeepResult: 'Keep empty merchant with a warning',
    cardUses: 'Information used', cardResult: 'Result', cardExceptions: 'Special cases', cardWillNot: 'Will not', cardCapability: 'Current capability', openLibrary: 'Open workflow library', reuseRules: 'Use these rules', modifyRules: 'Modify rules', reuseNotice: 'Current rules selected; the actual run entry still requires JASON integration.', developerValidation: 'Developer validation: structured JSON checker', previewStatus: 'Preview status', previewPartial: 'Some rules previewed', previewUnavailable: 'No previewable rules', explanationTitle: 'Workflow explanation card', savedActions: 'Next',
    fixedLimits: 'Saving does not run work, send messages, overwrite files, or expand access.', noDrafts: 'No local workflows yet.', open: 'Open', storageUnavailable: 'Local workflow storage is unavailable.', imported: 'Configuration imported; previous confirmation and execution status were cleared.',
    company: 'Company', department: 'Department', creator: 'Creator', lastModified: 'Last modified', unknown: 'Created after first save', demoIdentity: 'Current demo identity', permissionDenied: 'The current demo role cannot perform this action. Client checks are not a real security boundary.',
    trialTitle: 'Local structured-data checker', trialDescription: 'Use JSON to check the fixed receipt data shape. This is not rule preview or PDF/image OCR, and it does not execute arbitrary prompts.', trialInput: 'Checker JSON', trialExample: 'Load sample data', trialUpload: 'Import JSON', trialRun: 'Check data', trialSaveFirst: 'Confirm and save the current version before checking data.', trialUnsupported: 'Only the receipt template supports this structured JSON checker.', trialReady: 'Ready', trialReview: 'Needs review', trialResult: 'Check result', trialDownload: 'Download check CSV', trialNotSaved: 'Check results exist only on this page and disappear after refresh.', totalRows: 'Total rows', columns: { id: 'ID', date: 'Date', merchant: 'Merchant', amount: 'Amount', currency: 'Currency', status: 'Status' }, issues: { 'invalid-date': 'Date must be a real YYYY-MM-DD date.', 'missing-merchant': 'Merchant is missing.', 'invalid-amount': 'Amount must be non-negative with at most two decimals.', 'missing-currency': 'Currency is missing; HKD is not filled silently.', 'invalid-currency': 'Currency must use three letters.' },
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
  const [startMode, setStartMode] = useState<'receipt' | 'other'>('receipt')
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
  const [previousPreview, setPreviousPreview] = useState<WorkflowPreviewResult>()
  const [currencyDraft, setCurrencyDraft] = useState('')
  const activeRequestId = useRef('')

  useEffect(() => { configRef.current = config }, [config])
  useEffect(() => { setCurrencyDraft(config?.previewParameters?.acceptedCurrencies.value.join(', ') ?? '') }, [config?.previewParameters?.acceptedCurrencies.value])
  const summary = useMemo(() => config ? summarizeWorkflow(config) : undefined, [config])
  const explanation = useMemo(() => config ? buildWorkflowExplanationCard(config, locale) : undefined, [config, locale])
  const preview = useMemo(() => config?.previewParameters ? runWorkflowPreview(config, `preview-${config.revision}`) : undefined, [config])
  const preparedConfig = useMemo(() => {
    if (!config || !nameDraft.trim()) return config
    return renameWorkflow(config, nameDraft)
  }, [config, nameDraft])
  const prompt = useMemo(() => preparedConfig ? buildWorkflowPrompt(preparedConfig, locale) : '', [preparedConfig, locale])
  const isSaved = Boolean(config && savedRevision === config.revision && nameDraft === config.name)
  const canEditCurrent = config ? (savedRevision === undefined ? canWorkflowAction(actor, 'create') : canWorkflowAction(actor, 'edit', config)) : canWorkflowAction(actor, 'create')
  const canRunCurrent = Boolean(config && canWorkflowAction(actor, 'run', config))

  async function organize() {
    if (!canEditCurrent) { setError(c.permissionDenied); return }
    const requestedRequirement = requirement.trim() || (startMode === 'receipt' ? c.receiptExample : '')
    setError('')
    setNotice('')
    const base = configRef.current
    const sourceRevision = base?.revision ?? 0
    const requestId = globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}`
    activeRequestId.current = requestId
    setOrganizing(true)
    try {
      await Promise.resolve()
      const candidate = organizeRequirement(requestedRequirement, base?.workflowId, locale)
      const latest = configRef.current
      if (base) {
        if (!latest || !canApplyCandidate(requestId, activeRequestId.current, sourceRevision, latest.revision)) return
        const merged = mergeOrganizedRequirement(latest, candidate)
        setConfig(merged)
        setNameDraft(merged.name)
      } else {
        if (requestId !== activeRequestId.current || configRef.current) return
        setConfig(candidate)
        setRequirement(requestedRequirement)
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

  function updatePreviewParameter(key: WorkflowPreviewParameterKey, value: string | string[]) {
    if (!config) return
    try {
      setPreviousPreview(preview)
      applyConfig(updateWorkflowPreviewParameter(config, key, value))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update this setting.') }
  }

  function acceptPreviewSuggestion(key: WorkflowPreviewParameterKey) {
    if (!config) return
    setPreviousPreview(preview)
    applyConfig(confirmWorkflowPreviewParameter(config, key))
  }

  function editCurrencies(value: string) {
    setCurrencyDraft(value)
    const currencies = value.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean)
    if (currencies.length > 0 && currencies.length <= 10 && currencies.every((item) => /^[A-Z]{3}$/.test(item))) updatePreviewParameter('acceptedCurrencies', currencies)
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

  function applyQuestionAnswer(questionId: string) {
    if (!config) return
    try {
      applyConfig(answerWorkflowQuestion(config, questionId, questionAnswers[questionId] ?? ''))
      setQuestionAnswers((current) => ({ ...current, [questionId]: '' }))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not apply this answer.') }
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
    setStartMode('receipt')
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

  function previewOutcome(result: WorkflowPreviewResult['results'][number]) {
    if (result.caseId === 'ambiguous-date') return result.outcome
    if (result.caseId === 'foreign-currency') return result.status === 'included' ? c.includedUsd : c.reviewNoConversion
    return result.status === 'included-with-warning' ? c.missingKeepResult : c.missingReviewResult
  }

  function previewReason(result: WorkflowPreviewResult['results'][number]) {
    if (!config?.previewParameters) return ''
    if (result.parameter === 'dateInterpretation') return `${c.dateDecision} ${config.previewParameters.dateInterpretation.value}`
    if (result.parameter === 'acceptedCurrencies') return `${c.currencyDecision} ${config.previewParameters.acceptedCurrencies.value.join(', ')}`
    return `${c.missingDecision} ${config.previewParameters.missingMerchantHandling.value === 'needs-review' ? c.needsReview : c.keepEmpty}`
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
        <div className="max-w-3xl"><h2 className="text-2xl font-semibold">{c.title}</h2><p className="mt-2 text-sm leading-6 text-zinc-600">{c.subtitle}</p></div>
        <div className="mt-7 grid gap-3 sm:grid-cols-2"><button type="button" aria-pressed={startMode === 'receipt'} onClick={() => { setStartMode('receipt'); setRequirement(c.receiptExample) }} className={`rounded-xl border p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 ${startMode === 'receipt' ? 'border-zinc-950 bg-zinc-50' : 'border-zinc-200'}`}><strong className="block">{c.receiptStart}</strong><span className="mt-2 block text-sm leading-6 text-zinc-600">{c.receiptExample}</span></button><button type="button" aria-pressed={startMode === 'other'} onClick={() => { setStartMode('other'); setRequirement('') }} className={`rounded-xl border p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 ${startMode === 'other' ? 'border-zinc-950 bg-zinc-50' : 'border-zinc-200'}`}><strong className="block">{c.otherStart}</strong><span className="mt-2 block text-sm leading-6 text-zinc-600">{c.unsupportedEarly}</span></button></div>
        {startMode === 'receipt' ? <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-5"><p className="font-semibold">{c.sampleQuestion}</p><p className="mt-1 text-xs text-zinc-500">{c.sampleOnly}</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm"><thead className="text-xs text-zinc-500"><tr><th className="pb-2">{c.columns.date}</th><th className="pb-2">{c.columns.merchant}</th><th className="pb-2">{c.columns.amount}</th><th className="pb-2">{c.columns.currency}</th></tr></thead><tbody><tr className="border-t border-zinc-200"><td className="py-3">2026-10-01</td><td className="py-3">{locale === 'zh-Hant' ? '示例商戶' : 'Example merchant'}</td><td className="py-3">86.50</td><td className="py-3">HKD</td></tr></tbody></table></div></div> : <><label className="mt-6 block text-sm font-semibold">{c.requirement}<textarea aria-label={c.requirement} value={requirement} onChange={(event) => setRequirement(event.target.value)} maxLength={2000} className={`${inputClass} mt-2 min-h-40 resize-y`} /></label><p className="mt-2 text-xs text-amber-800">{c.unsupportedEarly}</p></>}
        <button type="button" onClick={organize} disabled={organizing || !(startMode === 'receipt' ? (requirement || c.receiptExample) : requirement).trim() || !canEditCurrent} className={`${primaryButton} mt-5`}><Sparkles className="size-4" />{c.organize}</button>
      </section>}

      {step === 2 && config && <section data-builder-step="confirm" className="space-y-5">
        <div className="rounded-2xl border border-zinc-300 bg-white p-5"><p className="text-sm text-zinc-500">{c.summary}</p><p className="mt-2 text-lg font-semibold leading-7">{config.goal}</p></div>
        {config.previewParameters ? <section className="rounded-2xl border border-zinc-300 bg-white p-5 sm:p-6"><h2 className="text-lg font-semibold">{c.decisions}</h2><div className="mt-5 grid gap-5 lg:grid-cols-3">
          <article className="rounded-xl border border-zinc-200 p-4"><label className="text-sm font-semibold">{c.dateDecision}<select aria-label={c.dateDecision} value={config.previewParameters.dateInterpretation.value} onChange={(event) => updatePreviewParameter('dateInterpretation', event.target.value)} className={`${inputClass} mt-2`}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option></select></label>{config.previewParameters.dateInterpretation.confirmation === 'pending' && <button type="button" onClick={() => acceptPreviewSuggestion('dateInterpretation')} className={`${secondaryButton} mt-3`}>{c.acceptSuggestion}</button>}</article>
          <article className="rounded-xl border border-zinc-200 p-4"><label className="text-sm font-semibold">{c.currencyDecision}<input aria-label={c.currencyDecision} value={currencyDraft} onChange={(event) => editCurrencies(event.target.value)} onBlur={() => updatePreviewParameter('acceptedCurrencies', currencyDraft)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} className={`${inputClass} mt-2`} /></label>{config.previewParameters.acceptedCurrencies.confirmation === 'pending' && <button type="button" onClick={() => acceptPreviewSuggestion('acceptedCurrencies')} className={`${secondaryButton} mt-3`}>{c.acceptSuggestion}</button>}</article>
          <article className="rounded-xl border border-zinc-200 p-4"><label className="text-sm font-semibold">{c.missingDecision}<select aria-label={c.missingDecision} value={config.previewParameters.missingMerchantHandling.value} onChange={(event) => updatePreviewParameter('missingMerchantHandling', event.target.value)} className={`${inputClass} mt-2`}><option value="needs-review">{c.needsReview}</option><option value="keep-empty-marked">{c.keepEmpty}</option></select></label>{config.previewParameters.missingMerchantHandling.confirmation === 'pending' && <button type="button" onClick={() => acceptPreviewSuggestion('missingMerchantHandling')} className={`${secondaryButton} mt-3`}>{c.acceptSuggestion}</button>}</article>
        </div></section> : <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{c.unsupportedEarly}</p>}

        {preview && <section className="rounded-2xl border border-zinc-300 bg-white p-5 sm:p-6"><h2 className="text-lg font-semibold">{c.previewTitle}</h2><p className="mt-1 text-sm text-zinc-600">{c.previewHelp}</p><div className="mt-5 grid gap-4 lg:grid-cols-3">{preview.results.map((result) => { const before = previousPreview?.results.find((value) => value.caseId === result.caseId); return <article key={result.caseId} data-preview-case={result.caseId} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4"><p className="text-xs font-semibold text-zinc-500">{c.originalExample}</p><p className="mt-1 font-mono text-sm">{result.input}</p><p className="mt-4 text-xs font-semibold text-zinc-500">{c.currentResult}</p><p className="mt-1 font-semibold">{previewOutcome(result)}</p><p className="mt-3 text-xs leading-5 text-zinc-600">{c.causedBy}: {previewReason(result)}</p>{before && previewOutcome(before) !== previewOutcome(result) && <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs text-zinc-600">{c.changedFrom}: {previewOutcome(before)}</p>}</article> })}</div></section>}

        {config.unresolvedQuestions.length > 0 && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6"><h2 className="text-lg font-semibold">{c.questions}</h2><div className="mt-4 space-y-4">{config.unresolvedQuestions.map((question) => <div key={question.id} className="rounded-xl border border-amber-200 bg-white p-4"><p className="text-sm font-semibold">{question.prompt}</p><label className="mt-3 block text-xs font-medium text-zinc-600">{c.answer}<input aria-label={`${c.answer} ${question.id}`} value={questionAnswers[question.id] ?? ''} onChange={(event) => setQuestionAnswers((current) => ({ ...current, [question.id]: event.target.value }))} className={`${inputClass} mt-1`} /></label><button type="button" onClick={() => applyQuestionAnswer(question.id)} className={`${secondaryButton} mt-3`}>{c.applyAnswer}</button></div>)}</div></section>}

        <details className="rounded-2xl border border-zinc-300 bg-white p-5"><summary className="cursor-pointer font-semibold outline-none focus-visible:ring-2 focus-visible:ring-zinc-950">{c.knownRules}</summary><div className="mt-4 space-y-3">{allWorkflowItems(config).map((value) => <article key={value.id} data-workflow-item={value.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">{editingId === value.id ? <div><textarea aria-label={`${c.ruleText} ${value.id}`} value={editText} onChange={(event) => setEditText(event.target.value)} className={`${inputClass} min-h-24`} /><div className="mt-2 flex gap-2"><button type="button" onClick={() => saveItem(value.id)} className={primaryButton}>{c.saveEdit}</button><button type="button" onClick={() => setEditingId(undefined)} className={secondaryButton}>{c.cancel}</button></div></div> : <div className="flex items-start justify-between gap-3"><div><p className="text-sm leading-6">{value.text}</p><p className="mt-1 text-xs text-zinc-500">{c.sources[value.source]} · {value.mapping.status === 'mapped' ? c.mapped : c.recordedOnly}</p>{value.mapping.status === 'recorded-only' && value.section !== 'input' && value.section !== 'output' && <p className="mt-2 text-xs text-amber-800">{c.unsupportedPreview}</p>}</div><div className="flex gap-2"><button type="button" onClick={() => { setEditingId(value.id); setEditText(value.text) }} className={secondaryButton}>{c.edit}</button><button type="button" aria-label={`${c.delete} ${value.text}`} onClick={() => applyConfig(removeWorkflowItem(config, value.id))} className="rounded-xl border border-red-200 px-3 text-red-700"><Trash2 className="size-4" /></button></div></div>}</article>)}</div><button type="button" onClick={() => setAdding(true)} className={`${secondaryButton} mt-4`}><Plus className="size-4" />{c.addRule}</button></details>
        {adding && <section className="rounded-2xl border border-zinc-300 bg-white p-5"><div className="grid gap-3 sm:grid-cols-[200px_1fr]"><select aria-label={c.ruleCategory} value={newSection} onChange={(event) => setNewSection(event.target.value as WorkflowSection)} className={inputClass}>{sectionOrder.map((value) => <option key={value} value={value}>{c.sections[value]}</option>)}</select><textarea aria-label={c.ruleText} value={newRule} onChange={(event) => setNewRule(event.target.value)} className={`${inputClass} min-h-24`} /></div><div className="mt-3 flex gap-2"><button type="button" onClick={addRule} className={primaryButton}>{c.add}</button><button type="button" onClick={() => setAdding(false)} className={secondaryButton}>{c.cancel}</button></div></section>}
        <div className="flex flex-wrap justify-between gap-3"><button type="button" onClick={() => setStep(1)} className={secondaryButton}><ArrowLeft className="size-4" />{c.back}</button><button type="button" onClick={proceed} disabled={!canEditCurrent || Boolean(config.previewParameters && currencyDraft !== config.previewParameters.acceptedCurrencies.value.join(', '))} className={primaryButton}>{c.confirmContinue}<ChevronRight className="size-4" /></button></div>
      </section>}

      {step === 3 && config && summary && <section data-builder-step="save" className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 rounded-2xl border border-zinc-300 bg-white p-5 sm:p-7">
          <label className="block text-sm font-semibold">{c.workflowName}<input aria-label={c.workflowName} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} disabled={!canEditCurrent} maxLength={120} className={`${inputClass} mt-2 disabled:bg-zinc-100 disabled:text-zinc-500`} /></label>
          {explanation && <article className="mt-6 rounded-2xl border border-zinc-950 bg-zinc-50 p-5" aria-label={c.explanationTitle}><p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{c.explanationTitle}</p><h2 className="mt-2 text-xl font-semibold">{nameDraft || explanation.title}</h2><dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-zinc-500">{c.cardUses}</dt><dd className="mt-1 leading-6">{explanation.uses}</dd></div><div><dt className="text-xs text-zinc-500">{c.cardResult}</dt><dd className="mt-1 leading-6">{explanation.result}</dd></div><div><dt className="text-xs text-zinc-500">{c.cardExceptions}</dt><dd className="mt-1 leading-6">{explanation.exceptions}</dd></div><div><dt className="text-xs text-zinc-500">{c.cardWillNot}</dt><dd className="mt-1 leading-6">{explanation.willNot}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-zinc-500">{c.cardCapability}</dt><dd className="mt-1 font-medium leading-6">{explanation.capability}</dd></div></dl></article>}
          <dl className="mt-5 grid gap-3 rounded-xl border border-zinc-200 p-4 text-sm sm:grid-cols-3"><div><dt className="text-xs text-zinc-500">{c.configurationStatus}</dt><dd className="mt-1 font-medium">{isWorkflowConfirmed(config) ? c.configReady : c.configDraft}</dd></div><div><dt className="text-xs text-zinc-500">{c.previewStatus}</dt><dd className="mt-1 font-medium">{preview ? c.previewPartial : c.previewUnavailable}</dd></div><div><dt className="text-xs text-zinc-500">{c.executionStatus}</dt><dd className="mt-1 font-medium">{config.execution.status === 'ready' ? 'Ready' : c.notConnected}</dd></div></dl>
          <p className="mt-6 text-xs leading-5 text-zinc-500">{c.fixedLimits}</p>
          <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={saveCurrent} disabled={!canEditCurrent} className={primaryButton}><Save className="size-4" />{c.saveWorkflow}</button><button type="button" onClick={() => setStep(2)} disabled={!canEditCurrent} className={`${secondaryButton} disabled:cursor-not-allowed disabled:opacity-45`}><ArrowLeft className="size-4" />{c.modifyRules}</button></div>
          <p className="mt-3 text-xs font-medium text-zinc-600">{isSaved ? c.savedLocal : c.unsaved}</p>
          {isSaved && <section className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><h3 className="text-sm font-semibold">{c.savedActions}</h3><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setShowSaved(true)} className={secondaryButton}><FolderOpen className="size-4" />{c.openLibrary}</button><button type="button" onClick={() => setNotice(c.reuseNotice)} className={secondaryButton}>{c.reuseRules}</button><button type="button" onClick={() => preparedConfig && downloadJson(preparedConfig)} className={secondaryButton}><Download className="size-4" />{c.backup}</button></div></section>}
          <details data-trial-run className="min-w-0 mt-7 border-t border-zinc-200 pt-6">
            <summary className="cursor-pointer font-semibold outline-none focus-visible:ring-2 focus-visible:ring-zinc-950">{c.developerValidation}</summary>
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
          </details>
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
