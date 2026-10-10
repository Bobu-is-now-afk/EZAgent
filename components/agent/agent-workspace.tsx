'use client'

import { LogicPillsEditor } from '@/components/agent/logic-pills-editor'
import { applyLogicPills, deriveLogicPills, isLogicPills, type LogicPill } from '@/lib/agent/logic-pills'
import { validateWorkflow } from '@/lib/agent/validation'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  ArrowUp,
  CircleDashed,
  FileText,
  FileUp,
  LoaderCircle,
  MessageCircle,
  Square,
  Sparkles,
} from 'lucide-react'
import {
  AGENT_TOOL_IDS,
  type AcceptanceCriterion,
  type AgentToolId,
  type Artifact,
  type Run,
  type RunEvent,
  type RunStatus,
  type SourceReference,
  type SourceType,
  type TaskState,
  type TaskStatus,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@/lib/agent/contracts'

type ApiResponseStatus = 'unconfirmed' | 'responded' | 'failed'

const MAX_POLL_FAILURES = 5
const MAX_POLL_DELAY_MS = 20_000
const NEEDS_INPUT_CORRECTIONS_SUPPORTED = true

const API_RESPONSE_LABELS: Record<ApiResponseStatus, string> = {
  unconfirmed: '尚未執行任務',
  responded: '本機處理已回應',
  failed: '最近一次處理未完成',
}

const API_ERROR_GUIDANCE: Record<string, string> = {
  model_missing: '本機 AI 尚未準備好。請回到上方「準備本機 AI」下載模型。',
  ollama_unavailable: '本機 AI 尚未啟動。請回到上方準備本機 AI，再重試。',
  ollama_unreachable: '無法連接本機 AI。請回到上方準備本機 AI，再重試。',
  ollama_request_failed: '本機 AI 未能完成處理，請稍後再試。',
  planner_timeout: 'AI 準備計畫的時間較長，請稍後再試或改用較小模型。',
  model_busy: '本機模型目前忙碌。請等待現有請求結束，再重新建立計畫。',
  invalid_source_content: '來源內容是空的或無法讀取。請選取非空的 UTF-8 CSV，或含標題列的 TXT。',
  source_too_large: '來源超過 1 MiB 上限。請縮小檔案後重新選取。',
  invalid_csv_header: 'CSV 標題列或欄位格式無效。請確認第一列是欄名，並包含所需發票欄位。',
  invalid_text_rows: 'TXT 格式無效。請使用含標題列、欄數一致的 Tab、逗號或直線分隔資料。',
  source_parse_failed: '來源資料無法安全解析。請檢查 UTF-8 編碼、標題列與每列欄位數，再建立新計畫。',
  invalid_headers: '來源缺少工作流程所需欄位。請選取包含必要欄名的 CSV/TXT，或調整必要欄位設定。',
  workflow_rejected: '工作流程未通過發票流程的安全檢查。請重新建立計畫並確認來源標題與必要欄位。',
  invalid_proposal: 'AI 未能產生可執行的發票計畫，請重試。',
  invalid_request: '請求資料不完整或格式無效。請檢查任務目標、來源檔與必要欄位。',
  invalid_messages: '訊息格式或長度無效。請簡化內容後重新傳送。',
  empty_stream: '服務沒有提供回覆串流。請確認本機 Ollama 正常，再重試。',
  row_limit_exceeded: '來源超過 5,000 列上限。請分批處理後建立新 Run。',
  active_run_limit: '已有一個 Run 正在執行。請先查看右側 Run 狀態，完成或取消後再建立下一個 Run。',
  task_limit: '工作流程超過 5 個步驟上限。請減少步驟後重新核准。',
  attempt_limit: '此 Task 已達重試上限。請檢查來源與驗證證據，修正後建立新 Run。',
  model_call_limit: '此 Run 已達模型呼叫上限。請精簡工作流程，再建立新 Run。',
  model_timeout: '模型請求超過時間上限。請檢查本機模型狀態，稍後重新執行。',
  run_timeout: 'Run 超過執行時間上限並停止。請檢查來源大小與驗證證據，再建立新 Run。',
  csv_formula_check_failed: '匯出檔未通過 CSV 公式安全檢查。請保留錯誤證據並交由管理者檢查，不要忽略檢核。',
  run_storage_failed: 'Agent 無法安全保存 Run 或來源。請確認本機儲存空間與權限，再建立新 Run。',
  task_validation_failed: 'Task 輸出未通過硬性驗證。請檢視 Task 證據與來源列，修正後建立新 Run。',
  invalid_workflow: '工作流程未通過伺服器驗證。請重新建立提案並檢查 Logic Pills。',
  invalid_resume_input: '補正資料不正確。請確認幣別與金額後重試。',
  run_not_resumable: '此 Run 不符合恢復條件（例如已有提交的 artifact）。請保留結果，修正來源或設定後建立新 Run。',
  source_unavailable: 'Run 的來源資料目前不可用，無法安全恢復。請重新選取來源並建立新 Run。',
  artifact_unavailable: 'CSV artifact 暫時無法下載。請重新同步 Run；若仍失敗，保留錯誤代碼供管理者檢查。',
}

function ErrorNotice({ detail, message = '處理未完成，請檢查輸入後重試。' }: { detail: string; message?: string }) {
  const guidance = Object.entries(API_ERROR_GUIDANCE).find(([code]) => detail.includes(code))?.[1]
  const plain = guidance && !/Run|Task|Planner|thresholdMinor|UTF-8|API|artifact/.test(guidance) ? guidance : message
  return <div role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p>{plain}</p><details className="mt-2 text-xs"><summary className="cursor-pointer">進階詳情</summary><p className="mt-2 break-words">{detail}</p></details></div>
}

function NormalLlm() {
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const submittingRef = useRef(false)

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = prompt.trim()
    if (!content || submittingRef.current) return

    submittingRef.current = true
    setIsLoading(true)
    setIsStreaming(false)
    setError(null)
    setNotice(null)
    setAnnouncement('')
    setPrompt('')

    const conversation = [...messages, { role: 'user' as const, content }]
    setMessages(conversation)
    const controller = new AbortController()
    controllerRef.current = controller
    let assistantContent = ''

    const updateAssistant = (nextContent: string) => {
      assistantContent = nextContent
      setMessages([...conversation, { role: 'assistant' as const, content: nextContent }])
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversation }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const result = await response.json().catch(() => null)
        const code = result?.error?.code
        if (code === 'model_missing') {
          throw new Error('api:model_missing')
        }
        if (code === 'ollama_unreachable' || code === 'ollama_unavailable') {
          throw new Error('api:ollama_unavailable')
        }
        if (typeof code === 'string') throw new Error(`api:${code}`)
        throw new Error(result?.error?.message || 'request-failed')
      }

      if (!response.body) throw new Error('empty-stream')
      setIsLoading(false)
      setIsStreaming(true)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      const consumeLine = (line: string) => {
        if (!line.trim()) return
        const chunk = JSON.parse(line)
        if (chunk.error) throw new Error(chunk.error)
        const text = chunk.message?.content
        if (typeof text === 'string' && text) updateAssistant(assistantContent + text)
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) consumeLine(line)
      }
      pending += decoder.decode()
      consumeLine(pending)
      if (!assistantContent) throw new Error('empty-response')
      setAnnouncement(`助理回覆：${assistantContent}`)
    } catch (caught) {
      if (controller.signal.aborted) {
        if (!assistantContent) setMessages(conversation)
        setNotice(assistantContent ? '已停止生成，保留目前已收到的回覆。' : '已取消傳送。')
        if (assistantContent) setAnnouncement(`已停止生成。已收到部分回覆：${assistantContent}`)
      } else {
        if (!assistantContent) setMessages(conversation)
        if (assistantContent) setAnnouncement(`回覆中斷。已收到部分內容：${assistantContent}`)
        const reason = caught instanceof Error ? caught.message : 'request-failed'
        if (reason.startsWith('api:') && API_ERROR_GUIDANCE[reason.slice(4)]) {
          setError(API_ERROR_GUIDANCE[reason.slice(4)])
        } else if (reason === 'api:empty_stream' || reason === 'empty-response' || reason === 'empty-stream') {
          setError('本機模型沒有傳回內容。請確認 Ollama 正常，再重新傳送。')
        } else if (caught instanceof TypeError || /failed to fetch|network request failed|load failed/i.test(reason)) {
          setError('無法連線至本機聊天 API。請確認 EZAgent 與 Ollama 正在執行，再重新傳送。')
        } else if (/model.{0,30}(not found|missing)|model_missing/i.test(reason)) {
          setError(API_ERROR_GUIDANCE.model_missing)
        } else if (/ollama.{0,40}(unavailable|unreachable)|connection refused/i.test(reason)) {
          setError(API_ERROR_GUIDANCE.ollama_unavailable)
        } else if (/timeout|timed out/i.test(reason) || (caught instanceof Error && caught.name === 'TimeoutError')) {
          setError('本機模型請求逾時。請確認 Ollama 正常，稍後重新傳送。')
        } else if (caught instanceof SyntaxError) {
          setError('本機聊天 API 傳回無法解讀的串流；目前對話已保留，請稍後重新傳送。')
        } else {
          setError(`聊天請求失敗：${reason}。請檢查本機服務狀態後重試。`)
        }
      }
    } finally {
      controllerRef.current = null
      submittingRef.current = false
      setIsLoading(false)
      setIsStreaming(false)
    }
  }

  function cancelMessage() {
    controllerRef.current?.abort()
  }

  return <section aria-labelledby="normal-llm-title" className="mx-auto flex min-h-[calc(100dvh-76px)] w-full max-w-4xl flex-col px-4 py-5 sm:px-6 sm:py-10">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6 sm:gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">本機 AI 對話</p><h1 id="normal-llm-title" className="mt-2 text-2xl font-semibold tracking-[-0.04em]">Local chat</h1></div><span className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600">本機 AI</span></div>
    <div role="log" aria-label="對話紀錄" aria-live="off" aria-relevant="additions text" className="flex min-h-[35vh] flex-1 flex-col overflow-auto rounded-2xl border border-zinc-200 bg-zinc-50/40 p-4 sm:p-8">
      {messages.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-zinc-950 text-white"><MessageCircle aria-hidden="true" className="size-5" /></div>
        <p className="mt-5 text-center text-lg font-medium text-zinc-900">Local Assistant Ready. How can I help you today?</p>
        <p className="mt-2 text-center text-sm text-zinc-500">Your conversation runs through the local Ollama service.</p>
      </div> : <div className="flex flex-col gap-5">
        {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'bg-zinc-950 text-white' : 'border border-zinc-200 bg-white text-zinc-800'}`}>
            {message.content ? <p className="whitespace-pre-wrap break-words">{message.content}</p> : <span className="flex items-center gap-2 text-zinc-500"><LoaderCircle className="size-4 animate-spin" />Thinking…</span>}
          </div>
        </div>)}
        {isLoading && <p className="flex items-center gap-2 text-xs text-zinc-500"><LoaderCircle className="size-3.5 animate-spin" />正在連接本機 AI…</p>}
        {isStreaming && messages[messages.length - 1]?.content && <p className="text-xs text-zinc-500">正在產生回覆…</p>}
      </div>}
    </div>
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>
    {error && <ErrorNotice detail={error} message="本機 AI 未能回覆，請檢查上方準備狀態後重試。" />}
    {notice && <p role="status" className="mt-3 text-sm text-zinc-500">{notice}</p>}
    <form onSubmit={sendMessage} aria-label="傳送訊息" className="mt-4 flex items-center gap-2 rounded-2xl border border-zinc-300 bg-white p-2 shadow-[0_8px_30px_-20px_rgba(24,24,27,0.35)] sm:mt-5 sm:gap-3"><input aria-label="輸入訊息" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault() }} disabled={isLoading || isStreaming} placeholder="輸入訊息…" className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-zinc-500 focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:opacity-60 sm:px-3" /><button type={isLoading || isStreaming ? 'button' : 'submit'} aria-label={isLoading || isStreaming ? '取消回覆' : '傳送訊息'} disabled={!isLoading && !isStreaming && !prompt.trim()} onClick={isLoading || isStreaming ? cancelMessage : undefined} className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-zinc-950 text-white transition hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-300">{isLoading || isStreaming ? <Square aria-hidden="true" className="size-3.5 fill-current" /> : <ArrowUp aria-hidden="true" className="size-[18px]" />}</button></form>
  </section>
}

type LocalSource = { name: string; type: SourceType; content: string }
type RunSnapshot = Pick<Run, 'id' | 'workflowVersion' | 'status' | 'currentTask' | 'workflow' | 'taskStates' | 'artifacts'>
type EventsResponse = { events: RunEvent[]; nextSequence: number }
type CsvTable = { headers: string[]; rows: string[][] }
type ResumeInput = { taskId: string; corrections: Array<{ field: string; value: string }> }
type SavedWorkflowTemplate = { id: string; name: string; version: number; createdAt: string; updatedAt: string; workflow: WorkflowDefinition }

const MAX_SOURCE_BYTES = 1024 * 1024
const RUN_ID_STORAGE_KEY = 'ezagent:lastRunId'
const TEMPLATE_STORAGE_KEY = 'ezagent:workflow-templates:v1'
const GOAL_PLACEHOLDER = '例如：篩選港幣 10,000 元以上的發票、標記缺漏欄位並匯出 CSV'
const TOOL_TITLES: Record<AgentToolId, string> = {
  parse_invoice_rows: '讀取發票資料',
  normalize_invoice_fields: '正規化既有欄位',
  filter_invoice_rows: '篩選金額與幣別',
  validate_required_fields: '檢查必要欄位',
  export_csv: '匯出結果 CSV',
}
const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  draft: '草稿',
  awaiting_approval: '等待核准',
  running: '執行中',
  needs_input: '等待輸入',
  failed: '失敗',
  cancelling: '取消中',
  cancelled: '已取消',
  interrupted: '已中斷',
  completed: '已完成',
}
const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '等待執行',
  running: '執行中',
  validating: '驗證中',
  passed: '已通過',
  retry_pending: '等待重試（退回）',
  needs_input: '等待輸入',
  failed: '失敗',
}

function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && Object.hasOwn(RUN_STATUS_LABELS, value)
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && Object.hasOwn(TASK_STATUS_LABELS, value)
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'interrupted'
}

function shouldPauseRunUpdates(status: RunStatus): boolean {
  return isTerminalRunStatus(status) || status === 'needs_input'
}

function eventMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  for (const key of ['message', 'reason', 'detail', 'prompt', 'question']) {
    const value = payload[key]
    if (typeof value === 'string' && value.trim()) return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500)
  }
  return null
}

function parseTaskState(value: unknown): TaskState | null {
  if (!isRecord(value) || !isTaskStatus(value.status) || !Number.isSafeInteger(value.attempts) || (value.attempts as number) < 0) return null
  if (value.validation !== undefined) {
    const validation = value.validation
    if (!isRecord(validation) || typeof validation.pass !== 'boolean' || typeof validation.code !== 'string' || !isStringArray(validation.evidence) || typeof validation.retryable !== 'boolean') return null
  }
  if (value.status === 'passed' && value.validation === undefined) return null
  return value as TaskState
}

function parseValidation(value: unknown): Artifact['validation'] | null {
  if (!isRecord(value) || typeof value.pass !== 'boolean' || typeof value.code !== 'string' || !isStringArray(value.evidence) || typeof value.retryable !== 'boolean') return null
  return value as Artifact['validation']
}

function parseSourceReference(value: unknown): SourceReference | null {
  if (!isRecord(value) || typeof value.fileName !== 'string' || !value.fileName.trim()) return null
  if (Number.isSafeInteger(value.rowNumber) && (value.rowNumber as number) >= 1) return { fileName: value.fileName, rowNumber: value.rowNumber as number }
  if (Number.isSafeInteger(value.lineNumber) && (value.lineNumber as number) >= 1) return { fileName: value.fileName, lineNumber: value.lineNumber as number }
  return null
}

function parseArtifact(value: unknown): Artifact | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.type !== 'string' || !value.type || typeof value.location !== 'string' || !Array.isArray(value.sourceRefs)) return null
  const sourceRefs = value.sourceRefs.map(parseSourceReference)
  const validation = parseValidation(value.validation)
  if (sourceRefs.some((reference) => reference === null) || !validation) return null
  return { id: value.id, type: value.type, location: value.location, sourceRefs: sourceRefs as SourceReference[], validation }
}

function parseRunSnapshot(value: unknown): RunSnapshot | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !Number.isSafeInteger(value.workflowVersion) || !isRunStatus(value.status)) return null
  if (value.currentTask !== null && typeof value.currentTask !== 'string') return null
  const workflow = parseWorkflow(value.workflow)
  if (!workflow || !isRecord(value.taskStates) || !Array.isArray(value.artifacts)) return null
  const taskStates: Record<string, TaskState> = {}
  for (const [id, rawState] of Object.entries(value.taskStates)) {
    const state = parseTaskState(rawState)
    if (!state) return null
    taskStates[id] = state
  }
  const artifacts = value.artifacts.map(parseArtifact)
  if (artifacts.some((artifact) => artifact === null) || new Set((artifacts as Artifact[]).map(({ id }) => id)).size !== artifacts.length) return null
  return {
    id: value.id,
    workflowVersion: value.workflowVersion as number,
    status: value.status,
    currentTask: value.currentTask as string | null,
    workflow,
    taskStates,
    artifacts: artifacts as Artifact[],
  }
}

function parseCsvTable(text: string): CsvTable {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
      continue
    }
    if (character === '"') {
      if (field.length > 0) throw new Error('CSV 格式無效：引號出現在未引用欄位中。')
      quoted = true
    } else if (character === ',') {
      record.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      record.push(field)
      if (record.some((cell) => cell.length > 0)) records.push(record)
      record = []
      field = ''
    } else {
      field += character
    }
  }
  if (quoted) throw new Error('CSV 格式無效：欄位引號未結束。')
  record.push(field)
  if (record.some((cell) => cell.length > 0)) records.push(record)
  if (records.length === 0) return { headers: [], rows: [] }
  const headers = records[0]
  if (headers.some((header) => !header.trim())) throw new Error('CSV 格式無效：欄名不可空白。')
  const rows = records.slice(1)
  if (rows.some((row) => row.length !== headers.length)) throw new Error('CSV 格式無效：資料欄位數與欄名不一致。')
  return { headers, rows }
}

function isCsvArtifact(artifact: Artifact): boolean {
  return /csv/i.test(artifact.type) || /\.csv(?:$|[?#])/i.test(artifact.location)
}

function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findCsvColumn(headers: string[], names: string[]): number {
  const normalizedNames = new Set(names.map(normalizedHeader))
  return headers.findIndex((header) => normalizedNames.has(normalizedHeader(header)))
}

function parseRunEvent(value: unknown, expectedRunId: string): RunEvent | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) return null
  if (value.runId !== expectedRunId || typeof value.time !== 'string' || typeof value.type !== 'string') return null
  if (value.taskId !== undefined && typeof value.taskId !== 'string') return null
  if (!Object.hasOwn(value, 'payload')) return null
  return value as RunEvent
}

function parseEventsResponse(value: unknown, runId: string): EventsResponse | null {
  if (!isRecord(value) || !Array.isArray(value.events) || !Number.isSafeInteger(value.nextSequence) || (value.nextSequence as number) < 0) return null
  const events = value.events.map((event) => parseRunEvent(event, runId))
  if (events.some((event) => event === null)) return null
  return { events: events as RunEvent[], nextSequence: value.nextSequence as number }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function parseAcceptance(value: unknown): AcceptanceCriterion | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string') return null
  if (value.type === 'required_fields' && isStringArray(value.fields)) return { id: value.id, type: value.type, fields: value.fields }
  if (value.type === 'currency_exact' && typeof value.currency === 'string') return { id: value.id, type: value.type, currency: value.currency }
  if (value.type === 'minimum_amount_minor' && Number.isSafeInteger(value.thresholdMinor)) return { id: value.id, type: value.type, thresholdMinor: value.thresholdMinor as number }
  if (value.type === 'csv_formula_safe') return { id: value.id, type: value.type }
  return null
}

function parseWorkflow(value: unknown): WorkflowDefinition | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.goal !== 'string' || !Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > 5) return null
  if (!isRecord(value.parameters) || !Array.isArray(value.allowedTools) || !value.allowedTools.every((tool) => AGENT_TOOL_IDS.includes(tool as AgentToolId))) return null
  if (!Array.isArray(value.acceptance)) return null
  const acceptance = value.acceptance.map(parseAcceptance)
  if (acceptance.some((criterion) => criterion === null)) return null
  const steps: WorkflowStep[] = []
  for (const valueStep of value.steps) {
    if (!isRecord(valueStep) || typeof valueStep.id !== 'string' || !AGENT_TOOL_IDS.includes(valueStep.tool as AgentToolId)) return null
    if (!isStringArray(valueStep.dependencies) || !isStringArray(valueStep.inputRefs) || !Array.isArray(valueStep.acceptance)) return null
    const stepAcceptance = valueStep.acceptance.map(parseAcceptance)
    if (stepAcceptance.some((criterion) => criterion === null)) return null
    if (valueStep.parameters !== undefined && !isRecord(valueStep.parameters)) return null
    steps.push({
      id: valueStep.id,
      dependencies: valueStep.dependencies,
      tool: valueStep.tool as AgentToolId,
      inputRefs: valueStep.inputRefs,
      parameters: valueStep.parameters as Record<string, unknown> | undefined,
      acceptance: stepAcceptance as AcceptanceCriterion[],
    })
  }
  if (value.pills !== undefined && !isLogicPills(value.pills)) return null
  const parameters = value.parameters
  if (parameters.thresholdMinor !== undefined && !Number.isSafeInteger(parameters.thresholdMinor)) return null
  if (parameters.currency !== undefined && typeof parameters.currency !== 'string') return null
  return {
    version: 1,
    goal: value.goal,
    ...(value.pills !== undefined ? { pills: value.pills as LogicPill[] } : {}),
    steps,
    parameters: { thresholdMinor: parameters.thresholdMinor as number | undefined, currency: parameters.currency as string | undefined },
    allowedTools: value.allowedTools as AgentToolId[],
    acceptance: acceptance as AcceptanceCriterion[],
  }
}

function makeTemplateWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  const steps = workflow.steps.map((step): WorkflowStep => {
    if (step.tool === 'filter_invoice_rows') {
      const parameters = step.parameters ?? {}
      return { ...step, parameters: {
        ...(Number.isSafeInteger(parameters.thresholdMinor) ? { thresholdMinor: parameters.thresholdMinor } : {}),
        ...(typeof parameters.currency === 'string' ? { currency: parameters.currency } : {}),
      } }
    }
    if (step.tool === 'validate_required_fields') {
      const fields = step.parameters?.fields
      return { ...step, parameters: { fields: isStringArray(fields) ? [...fields] : [] } }
    }
    if (step.tool === 'export_csv') {
      const columns = step.parameters?.columns
      return { ...step, parameters: isStringArray(columns) ? { columns: [...columns] } : {} }
    }
    return { ...step, parameters: undefined }
  })
  return {
    version: 1,
    goal: workflow.goal,
    ...(workflow.pills ? { pills: structuredClone(workflow.pills) } : {}),
    steps,
    parameters: {
      ...(Number.isSafeInteger(workflow.parameters.thresholdMinor) ? { thresholdMinor: workflow.parameters.thresholdMinor } : {}),
      ...(typeof workflow.parameters.currency === 'string' ? { currency: workflow.parameters.currency } : {}),
    },
    allowedTools: [...workflow.allowedTools],
    acceptance: workflow.acceptance.map((criterion) => criterion.type === 'required_fields'
      ? { ...criterion, fields: [...criterion.fields] }
      : criterion.type === 'minimum_amount_minor'
        ? { ...criterion }
        : { ...criterion }),
  }
}

function parseSavedWorkflowTemplate(value: unknown): SavedWorkflowTemplate | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !value.name.trim()) return null
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1 || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt)) || typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))) return null
  const workflow = parseWorkflow(value.workflow)
  if (!workflow) return null
  return {
    id: value.id,
    name: value.name.slice(0, 80),
    version: value.version as number,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    workflow: makeTemplateWorkflow(workflow),
  }
}

function formatApiError(value: unknown, status: number): string {
  const fallback = `Agent API 回傳 HTTP ${status}，無法完成請求。`
  if (!isRecord(value) || !isRecord(value.error)) return fallback
  const code = typeof value.error.code === 'string' ? value.error.code.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 80) : ''
  const message = typeof value.error.message === 'string' ? value.error.message.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300) : ''
  if (code && API_ERROR_GUIDANCE[code]) return `[${code}] ${API_ERROR_GUIDANCE[code]}${message ? ` API 說明：${message}` : ''}`
  return message ? `Agent API 錯誤${code ? ` ${code}` : ''}：${message}` : fallback
}

function formatClientRequestError(error: unknown, fallback: string): string {
  if (error instanceof TypeError || (error instanceof Error && /failed to fetch|network request failed|load failed/i.test(error.message))) {
    return '無法連線至本機 Agent API。請確認開發伺服器正在執行，再重試目前操作；Run 狀態可使用「重新同步 Run」。'
  }
  if (error instanceof Error && error.name === 'AbortError') return '請求已取消；目前沒有收到成功回應。'
  return error instanceof Error && error.message ? error.message : fallback
}

function eventCode(payload: unknown): string | null {
  return isRecord(payload) && typeof payload.code === 'string' ? payload.code : null
}

function formatPreview(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 6000)
  try {
    const serialized = JSON.stringify(value, null, 2)
    return typeof serialized === 'string' ? serialized.slice(0, 6000) : 'Planner 未提供文字預覽。'
  } catch {
    return 'Planner 預覽格式無法顯示。'
  }
}

function describeWorkflowStep(step: WorkflowStep, thresholdMinor: number, currency: string, requiredFields: string[]): string {
  if (step.tool === 'filter_invoice_rows') return `只保留金額嚴格超過 ${currency} ${(thresholdMinor / 100).toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 的項目。`
  if (step.tool === 'validate_required_fields') return `檢查欄位：${requiredFields.join(', ')}。不推測或補造資料。`
  if (step.tool === 'parse_invoice_rows') return '解析來源列，保留原始來源參照。'
  if (step.tool === 'normalize_invoice_fields') return '只正規化已存在的欄位值。'
  return '保留來源參照並檢查 CSV 輸出安全性。'
}

function MainStage({ apiStatus, onApiStatusChange }: { apiStatus: ApiResponseStatus; onApiStatusChange: (status: ApiResponseStatus) => void }) {
  const [goal, setGoal] = useState('')
  const [source, setSource] = useState<LocalSource | null>(null)
  const [pills, setPills] = useState<LogicPill[]>([])
  const [isEditingPlan, setIsEditingPlan] = useState(false)
  const [plannedWorkflow, setPlannedWorkflow] = useState<WorkflowDefinition | null>(null)
  const [plannerPreview, setPlannerPreview] = useState<unknown>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [runInfo, setRunInfo] = useState<RunSnapshot | null>(null)
  const [runEvents, setRunEvents] = useState<RunEvent[]>([])
  const [artifactPreview, setArtifactPreview] = useState<{ artifactId: string; table: CsvTable } | null>(null)
  const [artifactLoadingId, setArtifactLoadingId] = useState<string | null>(null)
  const [artifactError, setArtifactError] = useState<string | null>(null)
  const [correctionField, setCorrectionField] = useState('')
  const [correctionValue, setCorrectionValue] = useState('')
  const [correctionError, setCorrectionError] = useState<string | null>(null)
  const [savedTemplates, setSavedTemplates] = useState<SavedWorkflowTemplate[]>([])
  const [templateStoreReady, setTemplateStoreReady] = useState(false)
  const [templateStoreWritable, setTemplateStoreWritable] = useState(true)
  const [templateName, setTemplateName] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [selectedTemplateVersion, setSelectedTemplateVersion] = useState<number | null>(null)
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [runSourceBatch, setRunSourceBatch] = useState<string | null>(null)
  const [runTemplateLabel, setRunTemplateLabel] = useState<string | null>(null)
  const [runRestoreReady, setRunRestoreReady] = useState(false)
  const [streamRestartKey, setStreamRestartKey] = useState(0)
  const [liveMode, setLiveMode] = useState<'idle' | 'connecting' | 'sse' | 'polling' | 'stopped'>('idle')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [eventError, setEventError] = useState<string | null>(null)
  const [confirmedSignature, setConfirmedSignature] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [isReadingSource, setIsReadingSource] = useState(false)
  const [isPlanning, setIsPlanning] = useState(false)
  const [isCreatingRun, setIsCreatingRun] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isResuming, setIsResuming] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const idempotencyRef = useRef<{ signature: string; key: string } | null>(null)
  const lastSequenceRef = useRef(0)
  const eventIdsRef = useRef(new Set<string>())
  const actionControllerRef = useRef<AbortController | null>(null)
  const artifactControllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    actionControllerRef.current?.abort()
    artifactControllerRef.current?.abort()
  }, [])

  useEffect(() => {
    artifactControllerRef.current?.abort()
    setArtifactPreview(null)
    setArtifactError(null)
    setArtifactLoadingId(null)
    setCorrectionField('')
    setCorrectionValue('')
  }, [runId])

  const workflowEdit = plannedWorkflow ? applyLogicPills(plannedWorkflow, pills) : null
  const workflowValidation = workflowEdit ? validateWorkflow(workflowEdit.workflow) : null
  const pillErrors = [...(workflowEdit?.errors ?? []), ...(workflowValidation && !workflowValidation.ok ? workflowValidation.issues.map((issue) => issue.message) : [])]
  const editedWorkflow = workflowEdit?.workflow ?? null
  const thresholdMinor = editedWorkflow?.parameters.thresholdMinor ?? null
  const currency = editedWorkflow?.parameters.currency ?? ''
  const fieldsValue = editedWorkflow?.steps.find((step) => step.tool === 'validate_required_fields')?.parameters?.fields
  const requiredFields = isStringArray(fieldsValue) ? fieldsValue : []
  const payloadSignature = editedWorkflow && source
    ? JSON.stringify({ workflow: editedWorkflow, source })
    : ''
  const isConfirmed = payloadSignature !== '' && confirmedSignature === payloadSignature
  const runIsBusy = runInfo !== null && !isTerminalRunStatus(runInfo.status)
  const runBlocksNewWork = Boolean(runId && (liveMode === 'connecting' || !runInfo || runIsBusy || runInfo.status === 'interrupted'))
  const selectedTemplate = savedTemplates.find((template) => template.id === selectedTemplateId && template.version === selectedTemplateVersion) ?? null
  const selectedTemplateDirty = Boolean(selectedTemplate && editedWorkflow && JSON.stringify(makeTemplateWorkflow(editedWorkflow)) !== JSON.stringify(selectedTemplate.workflow))
  const apiSourceBatches = [...new Set(runInfo?.artifacts.flatMap((artifact) => artifact.sourceRefs.map((reference) => reference.fileName)) ?? [])]
  const apiSourceBatchLabel = apiSourceBatches.length > 2 ? `${apiSourceBatches.slice(0, 2).join(', ')}，另有 ${apiSourceBatches.length - 2} 個來源檔` : apiSourceBatches.join(', ')

  useEffect(() => {
    try {
      const storedRunId = window.localStorage.getItem(RUN_ID_STORAGE_KEY)
      if (storedRunId && storedRunId.length <= 256) setRunId(storedRunId)
    } catch {
      setSyncError('無法讀取本機儲存的 Run ID；目前工作階段仍可繼續。')
    } finally {
      setRunRestoreReady(true)
    }
  }, [])

  useEffect(() => {
    try {
      const serialized = window.localStorage.getItem(TEMPLATE_STORAGE_KEY)
      if (!serialized) return
      const stored: unknown = JSON.parse(serialized)
      if (!isRecord(stored) || stored.schemaVersion !== 1 || !Array.isArray(stored.templates)) {
        setTemplateError('本機模板資料版本或格式無效；保留原資料且未載入。')
        setTemplateStoreWritable(false)
        return
      }
      const templates = stored.templates.map(parseSavedWorkflowTemplate)
      if (templates.some((template) => template === null)) {
        setTemplateError('部分本機模板格式無效；為避免覆寫，未載入模板清單。')
        setTemplateStoreWritable(false)
        return
      }
      setSavedTemplates(templates as SavedWorkflowTemplate[])
    } catch {
      setTemplateError('無法讀取本機模板；目前仍可建立及執行 workflow。')
      setTemplateStoreWritable(false)
    } finally {
      setTemplateStoreReady(true)
    }
  }, [])

  useEffect(() => {
    if (!runRestoreReady || !runId) return
    const activeRunId = runId

    let disposed = false
    let stopped = false
    let pollingStarted = false
    let pollBusy = false
    let consecutivePollFailures = 0
    let eventSource: EventSource | null = null
    let pollTimer: number | null = null
    let runRequest: Promise<RunSnapshot> | null = null
    const controller = new AbortController()

    lastSequenceRef.current = 0
    eventIdsRef.current = new Set()
    setRunEvents([])
    setSyncError(null)
    setEventError(null)
    setLiveMode('connecting')

    function closeConnection() {
      eventSource?.close()
      eventSource = null
      if (pollTimer !== null) window.clearTimeout(pollTimer)
      pollTimer = null
    }

    function pauseUpdates() {
      if (stopped) return
      stopped = true
      closeConnection()
      if (!disposed) {
        setLiveMode('stopped')
        controller.abort()
      }
    }

    async function refreshRun(): Promise<RunSnapshot> {
      if (runRequest) return runRequest
      const request = (async () => {
        const response = await fetch(`/api/agent/runs/${encodeURIComponent(activeRunId)}`, { cache: 'no-store', signal: controller.signal })
        const result: unknown = await response.json().catch(() => null)
        if (!response.ok) throw new Error(formatApiError(result, response.status))
        const run = isRecord(result) ? parseRunSnapshot(result.run) : null
        if (!run || run.id !== activeRunId) throw new Error('Run API 回傳格式不符，或 Run ID 不一致。')
        if (!disposed) {
          setRunInfo(run)
          setSyncError(null)
          onApiStatusChange('responded')
        }
        return run
      })()
      runRequest = request
      try {
        return await request
      } finally {
        if (runRequest === request) runRequest = null
      }
    }

    function ingestEvents(events: RunEvent[]): boolean | null {
      let sequence = lastSequenceRef.current
      const ids = new Set(eventIdsRef.current)
      const accepted: RunEvent[] = []
      for (const event of events) {
        if (ids.has(event.id)) continue
        if (event.sequence <= sequence) {
          setEventError(`收到非單調 RunEvent sequence ${event.sequence}；事件已忽略，游標未推進。`)
          onApiStatusChange('failed')
          return null
        }
        ids.add(event.id)
        sequence = event.sequence
        accepted.push(event)
      }
      if (accepted.length > 0) {
        eventIdsRef.current = ids
        lastSequenceRef.current = sequence
        setRunEvents((current) => [...current, ...accepted].slice(-50))
        setEventError(null)
      }
      return accepted.length > 0
    }

    async function refreshEvents(): Promise<boolean> {
      const response = await fetch(`/api/agent/runs/${encodeURIComponent(activeRunId)}/events?after=${lastSequenceRef.current}`, { cache: 'no-store', signal: controller.signal })
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(formatApiError(result, response.status))
      const parsed = parseEventsResponse(result, activeRunId)
      if (!parsed) {
        const error = new Error('events API payload 格式無效；事件游標未推進。')
        setEventError(error.message)
        onApiStatusChange('failed')
        throw error
      }
      const ingestResult = ingestEvents(parsed.events)
      if (ingestResult === null) throw new Error('RunEvent sequence 不符合單調遞增規則；事件游標未推進。')
      setEventError(null)
      onApiStatusChange('responded')
      return ingestResult === true
    }

    async function pollOnce() {
      if (disposed || stopped || pollBusy) return
      pollBusy = true
      let pollFailed = false
      try {
        const run = await refreshRun()
        if (shouldPauseRunUpdates(run.status)) {
          try {
            await refreshEvents()
          } catch (error) {
            if (!disposed && !stopped) {
              setEventError(`終態 Run 事件補讀失敗：${formatClientRequestError(error, '事件補讀失敗。')}`)
              onApiStatusChange('failed')
            }
          } finally {
            consecutivePollFailures = 0
            pauseUpdates()
          }
          return
        }
        await refreshEvents()
        consecutivePollFailures = 0
      } catch (error) {
        pollFailed = true
        consecutivePollFailures += 1
        if (!disposed && !stopped) {
          const cause = formatClientRequestError(error, 'Run 同步失敗。')
          if (consecutivePollFailures >= MAX_POLL_FAILURES) {
            setSyncError(`${cause} 已連續失敗 ${MAX_POLL_FAILURES} 次，自動輪詢已停止以避免持續請求；可按「重新同步 Run」再試。`)
          } else {
            setSyncError(`${cause}（第 ${consecutivePollFailures}/${MAX_POLL_FAILURES} 次失敗，稍後重試。）`)
          }
          onApiStatusChange('failed')
        }
      } finally {
        pollBusy = false
        if (!disposed && !stopped) {
          if (pollFailed && consecutivePollFailures >= MAX_POLL_FAILURES) {
            pauseUpdates()
          } else {
            const delay = pollFailed ? Math.min(2500 * (2 ** (consecutivePollFailures - 1)), MAX_POLL_DELAY_MS) : 2500
            pollTimer = window.setTimeout(pollOnce, delay)
          }
        }
      }
    }

    function startPolling() {
      if (disposed || stopped || pollingStarted) return
      pollingStarted = true
      setLiveMode('polling')
      void pollOnce()
    }

    function handleSseEvent(rawEvent: Event) {
      if (disposed || stopped || !('data' in rawEvent)) return
      let value: unknown
      try {
        value = JSON.parse(String((rawEvent as MessageEvent).data))
      } catch {
        setEventError('SSE RunEvent JSON 無效；事件游標未推進。')
        onApiStatusChange('failed')
        return
      }
      const event = parseRunEvent(value, activeRunId)
      if (!event) {
        setEventError('SSE RunEvent payload 格式無效；事件游標未推進。')
        onApiStatusChange('failed')
        return
      }
      if (ingestEvents([event])) {
        void refreshRun().then((run) => {
          if (shouldPauseRunUpdates(run.status)) pauseUpdates()
        }).catch((error) => {
          if (!disposed && !stopped) {
            setSyncError(formatClientRequestError(error, 'Run 狀態同步失敗。'))
            onApiStatusChange('failed')
          }
        })
      }
    }

    async function connect() {
      try {
        const run = await refreshRun()
        if (disposed) return
        if (shouldPauseRunUpdates(run.status)) {
          try {
            await refreshEvents()
          } catch (error) {
            if (!disposed && !stopped) {
              setEventError(`終態 Run 事件補讀失敗：${formatClientRequestError(error, '事件補讀失敗。')}`)
              onApiStatusChange('failed')
            }
          } finally {
            pauseUpdates()
          }
          return
        }
        try {
          await refreshEvents()
        } catch (error) {
          if (!disposed) setEventError(`補讀事件失敗：${formatClientRequestError(error, '事件補讀失敗。')}`)
        }
        if (disposed) return
        if (typeof EventSource === 'undefined') {
          startPolling()
          return
        }
        setLiveMode('sse')
        eventSource = new EventSource(`/api/agent/runs/${encodeURIComponent(activeRunId)}/stream?after=${lastSequenceRef.current}`)
        eventSource.addEventListener('message', handleSseEvent)
        eventSource.addEventListener('RunEvent', handleSseEvent)
        eventSource.onerror = () => {
          if (disposed || stopped) return
          void refreshRun().then(async (latestRun) => {
            if (disposed || stopped) return
            if (shouldPauseRunUpdates(latestRun.status)) {
              try {
                await refreshEvents()
              } catch (error) {
                if (!disposed && !stopped) {
                  setEventError(`終態 Run 事件補讀失敗：${formatClientRequestError(error, '事件補讀失敗。')}`)
                  onApiStatusChange('failed')
                }
              } finally {
                pauseUpdates()
              }
              return
            }
            setEventError('SSE 連線失敗，已改用 events polling。')
            onApiStatusChange('failed')
            closeConnection()
            startPolling()
          }).catch((error) => {
            if (disposed || stopped) return
            setEventError(`SSE 連線失敗，已改用 events polling：${formatClientRequestError(error, 'Run 狀態同步失敗。')}`)
            onApiStatusChange('failed')
            closeConnection()
            startPolling()
          })
        }
      } catch (error) {
        if (!disposed && !stopped) {
          setSyncError(formatClientRequestError(error, 'Run 狀態讀取失敗。'))
          onApiStatusChange('failed')
          setLiveMode('stopped')
        }
      }
    }

    const cleanup = () => {
      disposed = true
      stopped = true
      closeConnection()
      controller.abort()
    }
    void connect()
    return cleanup
  }, [runId, runRestoreReady, streamRestartKey, onApiStatusChange])

  function clearPlanState() {
    setPills([])
    setIsEditingPlan(false)
    setPlannedWorkflow(null)
    setPlannerPreview(null)
    setConfirmedSignature(null)
    setPlanError(null)
    setRunError(null)
    idempotencyRef.current = null
  }

  function clearSource() {
    setSource(null)
    setSourceError(null)
    if (selectedTemplateId && plannedWorkflow) {
      setPlannerPreview(null)
      setConfirmedSignature(null)
      setPlanError(null)
      setRunError(null)
      idempotencyRef.current = null
    } else {
      clearPlanState()
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function loadWorkflowTemplate(template: SavedWorkflowTemplate) {
    if (runBlocksNewWork) return
    const workflow = makeTemplateWorkflow(template.workflow)
    setSource(null)
    setSourceError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    clearPlanState()
    setGoal(workflow.goal)
    setPills(workflow.pills ?? deriveLogicPills(workflow))
    setIsEditingPlan(false)
    setPlannedWorkflow(workflow)
    setPlannerPreview(null)
    setTemplateName(template.name)
    setSelectedTemplateId(template.id)
    setSelectedTemplateVersion(template.version)
    setTemplateError(null)
  }

  function saveWorkflowTemplate() {
    if (!templateStoreReady || !templateStoreWritable || !editedWorkflow || pillErrors.length || runBlocksNewWork) return
    const name = templateName.trim()
    if (!name || name.length > 80) {
      setTemplateError('請輸入 1 至 80 字的模板名稱。')
      return
    }
    const templateId = selectedTemplateId ?? crypto.randomUUID()
    const priorVersions = savedTemplates.filter((template) => template.id === templateId)
    const nextVersion = priorVersions.reduce((latest, template) => Math.max(latest, template.version), 0) + 1
    const now = new Date().toISOString()
    const template: SavedWorkflowTemplate = {
      id: templateId,
      name,
      version: nextVersion,
      createdAt: priorVersions[0]?.createdAt ?? now,
      updatedAt: now,
      workflow: makeTemplateWorkflow(editedWorkflow),
    }
    const nextTemplates = [...savedTemplates, template]
    try {
      window.localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, templates: nextTemplates }))
      setSavedTemplates(nextTemplates)
      setSelectedTemplateId(template.id)
      setSelectedTemplateVersion(template.version)
      setTemplateName(template.name)
      setTemplateError(null)
    } catch {
      setTemplateError('無法儲存本機模板；請檢查瀏覽器儲存空間。來源檔與執行結果未寫入模板。')
    }
  }

  function startNewWorkflowTemplate() {
    setSelectedTemplateId(null)
    setSelectedTemplateVersion(null)
    setTemplateName('')
    setTemplateError(null)
  }

  async function loadSample() {
    if (isReadingSource || isPlanning || isCreatingRun || runBlocksNewWork) return
    clearSource()
    setSelectedTemplateId(null)
    setSelectedTemplateVersion(null)
    setTemplateName('')
    clearPlanState()
    setIsReadingSource(true)
    try {
      const response = await fetch('/api/demo-invoices')
      if (!response.ok) throw new Error('sample_unavailable')
      const sample = await response.json()
      setSource(sample)
      setGoal('篩選港幣 10,000 元以上的發票，標記缺漏欄位並匯出 CSV')
    } catch { setSourceError('示範資料暫時無法載入，請再試一次。') }
    finally { setIsReadingSource(false) }
  }

  async function selectSource(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (selectedTemplateId && plannedWorkflow) {
      setPlannerPreview(null)
      setConfirmedSignature(null)
      setPlanError(null)
      setRunError(null)
      idempotencyRef.current = null
    } else {
      clearPlanState()
    }
    setSource(null)
    setSourceError(null)
    if (!file) return
    if (file.size > MAX_SOURCE_BYTES) {
      setSourceError('來源檔案超過 1 MiB 上限，請選擇較小的 UTF-8 CSV 或 TXT。')
      input.value = ''
      return
    }
    const lowerName = file.name.toLowerCase()
    const type: SourceType | null = lowerName.endsWith('.csv') || file.type === 'text/csv'
      ? 'csv'
      : lowerName.endsWith('.txt') || file.type === 'text/plain'
        ? 'text'
        : null
    if (!type) {
      setSourceError('只接受副檔名為 .csv 或 .txt 的檔案。')
      input.value = ''
      return
    }
    setIsReadingSource(true)
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (!content.trim()) {
        setSourceError('檔案是空的。請選取包含標題列與資料的 UTF-8 CSV 或 TXT。')
        input.value = ''
        return
      }
      setSource({ name: file.name, type, content })
    } catch {
      setSourceError('檔案無法以 UTF-8 解碼，請另存為 UTF-8 後重試。')
      input.value = ''
    } finally {
      setIsReadingSource(false)
    }
  }

  async function createPlan() {
    if (!source || !goal.trim() || runBlocksNewWork) return
    setSelectedTemplateId(null)
    setSelectedTemplateVersion(null)
    setTemplateName('')
    setIsPlanning(true)
    setPills([])
    setIsEditingPlan(false)
    setPlanError(null)
    setRunError(null)
    setPlannedWorkflow(null)
    setPlannerPreview(null)
    setConfirmedSignature(null)
    idempotencyRef.current = null
    try {
      const response = await fetch('/api/agent/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: goal.trim(), source }),
      })
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(formatApiError(result, response.status))
      if (!isRecord(result) || result.preview === undefined) throw new Error('Planner 回應格式不相容，缺少 preview。')
      const workflow = parseWorkflow(result.workflow)
      if (!workflow) throw new Error('Planner 回傳的 workflow 格式不相容，無法安全編輯或核准。')
      const returnedPills = result.pills ?? workflow.pills ?? deriveLogicPills(workflow)
      if (!isLogicPills(returnedPills)) throw new Error('Planner 回傳的 Logic Pills 格式無效。')
      setPills(returnedPills)
      setIsEditingPlan(false)
      setPlannedWorkflow(workflow)
      setPlannerPreview(result.preview)
      onApiStatusChange('responded')
    } catch (error) {
      setPlanError(formatClientRequestError(error, '建立計畫失敗，請稍後重試。'))
      onApiStatusChange('failed')
    } finally {
      setIsPlanning(false)
    }
  }

  async function createRun() {
    if (!editedWorkflow || !source || !isConfirmed || isEditingPlan || pillErrors.length || runBlocksNewWork) return
    const request = { workflow: editedWorkflow, source }
    const signature = JSON.stringify(request)
    const existingKey = idempotencyRef.current?.signature === signature ? idempotencyRef.current.key : null
    const idempotencyKey = existingKey ?? crypto.randomUUID()
    idempotencyRef.current = { signature, key: idempotencyKey }
    setIsCreatingRun(true)
    setRunError(null)
    try {
      const response = await fetch('/api/agent/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, idempotencyKey }),
      })
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(formatApiError(result, response.status))
      const run = isRecord(result) ? parseRunSnapshot(result.run) : null
      if (!run) {
        throw new Error('Run API 回應格式不相容，未顯示未驗證的執行狀態。')
      }
      let storageNotice: string | null = null
      setRunInfo(run)
      setRunId(run.id)
      setRunEvents([])
      setRunSourceBatch(source.name)
      setRunTemplateLabel(selectedTemplate
        ? `${selectedTemplate.name} · v${selectedTemplate.version}${selectedTemplateDirty ? ' · 含尚未儲存的參數修改' : ''}`
        : '自訂 workflow（未套用模板）')
      try {
        window.localStorage.setItem(RUN_ID_STORAGE_KEY, run.id)
      } catch {
        storageNotice = 'Run 已建立，但無法只保存 Run ID；重新載入後需手動恢復。'
      }
      setRunError(null)
      setSyncError(storageNotice)
      onApiStatusChange('responded')
    } catch (error) {
      setRunError(formatClientRequestError(error, '建立 Run 失敗；相同內容重試會沿用同一個 idempotency key。'))
      onApiStatusChange('failed')
    } finally {
      setIsCreatingRun(false)
    }
  }

  async function downloadCsvArtifact(artifact: Artifact) {
    if (!runInfo || !isCsvArtifact(artifact) || artifactLoadingId) return
    artifactControllerRef.current?.abort()
    const controller = new AbortController()
    artifactControllerRef.current = controller
    setArtifactLoadingId(artifact.id)
    setArtifactPreview(null)
    setArtifactError(null)
    try {
      const response = await fetch(`/api/agent/runs/${encodeURIComponent(runInfo.id)}/artifacts/${encodeURIComponent(artifact.id)}`, { cache: 'no-store', signal: controller.signal })
      const blob = await response.blob()
      if (!response.ok) {
        let errorResult: unknown = null
        try { errorResult = JSON.parse(await blob.text()) } catch { /* Use the status fallback below. */ }
        throw new Error(formatApiError(errorResult, response.status))
      }
      const contentType = response.headers.get('content-type') ?? blob.type
      if (contentType && !/(?:text\/csv|application\/csv|application\/octet-stream|text\/plain)/i.test(contentType)) {
        throw new Error('Artifact API 未回傳 CSV 檔案。')
      }
      const table = parseCsvTable(await blob.text())
      setArtifactPreview({ artifactId: artifact.id, table })
      const safePart = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80) || 'run'
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `ezagent-${safePart(runInfo.id)}-${safePart(artifact.id)}.csv`
      anchor.hidden = true
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      onApiStatusChange('responded')
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = formatClientRequestError(error, '無法載入 CSV artifact。')
        setArtifactError(message)
        onApiStatusChange('failed')
      }
    } finally {
      if (artifactControllerRef.current === controller) artifactControllerRef.current = null
      setArtifactLoadingId(null)
    }
  }

  async function cancelRun() {
    if (!runId || !runInfo || !['running', 'cancelling', 'awaiting_approval', 'needs_input'].includes(runInfo.status) || isCancelling) return
    const controller = new AbortController()
    actionControllerRef.current = controller
    setIsCancelling(true)
    setSyncError(null)
    try {
      const response = await fetch(`/api/agent/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', signal: controller.signal })
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(formatApiError(result, response.status))
      const run = isRecord(result) ? parseRunSnapshot(result.run) : null
      if (!run || run.id !== runId) throw new Error('Cancel API 回應格式不符，或 Run ID 不一致。')
      setRunInfo(run)
      onApiStatusChange('responded')
      setStreamRestartKey((key) => key + 1)
    } catch (error) {
      if (!controller.signal.aborted) {
        setSyncError(formatClientRequestError(error, '取消 Run 失敗。'))
        onApiStatusChange('failed')
      }
    } finally {
      if (actionControllerRef.current === controller) actionControllerRef.current = null
      setIsCancelling(false)
    }
  }

  async function resumeRun(input?: ResumeInput) {
    if (!runId || !runInfo || isResuming) return
    const isInterrupted = runInfo.status === 'interrupted' && input === undefined
    const isInputResume = runInfo.status === 'needs_input' && input !== undefined && input.taskId === runInfo.currentTask && input.corrections.length > 0 && input.corrections.every((item) => item.field.trim() && item.value.trim())
    if (!isInterrupted && !isInputResume) return
    const controller = new AbortController()
    actionControllerRef.current = controller
    setIsResuming(true)
    setSyncError(null)
    try {
      const response = await fetch(`/api/agent/runs/${encodeURIComponent(runId)}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input ? { input } : {}),
        signal: controller.signal,
      })
      const result: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(formatApiError(result, response.status))
      const run = isRecord(result) ? parseRunSnapshot(result.run) : null
      if (!run || run.id !== runId) throw new Error('Resume API 回應格式不符，或 Run ID 不一致。')
      setRunInfo(run)
      onApiStatusChange('responded')
      setStreamRestartKey((key) => key + 1)
    } catch (error) {
      if (!controller.signal.aborted) {
        setSyncError(formatClientRequestError(error, 'Resume Run 失敗。'))
        onApiStatusChange('failed')
      }
    } finally {
      if (actionControllerRef.current === controller) actionControllerRef.current = null
      setIsResuming(false)
    }
  }

  function submitNeedsInputCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!runInfo?.currentTask) return
    const field = correctionField.trim()
    const value = correctionValue.trim()
    if (!field || !value) return
    if (field === 'thresholdMinor' && (!/^\d{1,16}$/.test(value) || !Number.isSafeInteger(Number(value)))) {
      setCorrectionError('門檻必須是有效的非負安全整數，且以最小貨幣單位輸入。')
      return
    }
    if (field === 'currency' && !/^[A-Z]{3}$/.test(value)) {
      setCorrectionError('幣別必須使用三碼大寫代碼，例如 HKD。')
      return
    }
    setCorrectionError(null)
    void resumeRun({ taskId: runInfo.currentTask, corrections: [{ field, value }] })
  }

  function retryRunSync() {
    if (!runId) return
    setSyncError(null)
    setEventError(null)
    setStreamRestartKey((key) => key + 1)
  }

  const planningDisabled = !source || !goal.trim() || isPlanning || isReadingSource || isCreatingRun || runBlocksNewWork
  const canCreateRun = Boolean(editedWorkflow && source && isConfirmed && !isEditingPlan && !pillErrors.length && !isCreatingRun && !runBlocksNewWork)
  const previewText = plannerPreview === null ? '' : formatPreview(plannerPreview)
  const workflowForDisplay = editedWorkflow ?? runInfo?.workflow ?? null
  const runWorkflowMatches = Boolean(runInfo && workflowForDisplay && JSON.stringify(runInfo.workflow) === JSON.stringify(workflowForDisplay))
  const displayThresholdMinor = editedWorkflow ? thresholdMinor ?? 0 : runInfo?.workflow.parameters.thresholdMinor ?? thresholdMinor ?? 0
  const displayCurrency = editedWorkflow ? currency : runInfo?.workflow.parameters.currency ?? currency
  const storedRequiredFields = runInfo?.workflow.steps.find((step) => step.tool === 'validate_required_fields')?.parameters?.fields
  const displayRequiredFields = editedWorkflow
    ? requiredFields
    : isStringArray(storedRequiredFields) ? storedRequiredFields : requiredFields
  const canCancelRun = Boolean(runId && runInfo && ['running', 'cancelling', 'awaiting_approval'].includes(runInfo.status))
  const needsInputEvent = runInfo?.status === 'needs_input'
    ? [...runEvents].reverse().find((event) => event.type.toLowerCase().includes('input') && (!event.taskId || event.taskId === runInfo.currentTask))
    : undefined
  const needsInputReason = needsInputEvent ? eventMessage(needsInputEvent.payload) : null
  const runFailedEvent = runInfo?.status === 'failed' ? [...runEvents].reverse().find((event) => event.type.toLowerCase().includes('run_failed')) : undefined
  const failedTaskState = runInfo?.status === 'failed' ? Object.values(runInfo.taskStates).find((taskState) => taskState.status === 'failed') : undefined
  const runFailureCode = eventCode(runFailedEvent?.payload) ?? failedTaskState?.validation?.code ?? null
  const runFailureMessage = (runFailedEvent ? eventMessage(runFailedEvent.payload) : null) ?? failedTaskState?.validation?.evidence[0] ?? null
  const artifactTable = artifactPreview?.table ?? null
  const sourceFileColumn = artifactTable ? findCsvColumn(artifactTable.headers, ['source_file', 'source_filename', 'file_name', 'filename']) : -1
  const sourceLocationColumn = artifactTable ? findCsvColumn(artifactTable.headers, ['source_row', 'source_row_number', 'row_number', 'source_line', 'line_number']) : -1
  const resultStatusColumn = artifactTable ? findCsvColumn(artifactTable.headers, ['validation_status', 'validation_flag']) : -1
  const resultReasonColumn = artifactTable ? findCsvColumn(artifactTable.headers, ['validation_reason', 'validation_reasons', 'flag_reason', 'validation_evidence']) : -1

  return <section className="mx-auto flex min-h-[calc(100vh-76px)] w-full max-w-[1840px] flex-col px-4 py-5 sm:px-7 sm:py-6 xl:px-10">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">Invoice demo</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.04em] sm:text-[28px]">發票整理示範</h1></div>
      <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${apiStatus === 'responded' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : apiStatus === 'failed' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-zinc-200 bg-zinc-50 text-zinc-600'}`}><CircleDashed aria-hidden="true" className="size-3.5" />{API_RESPONSE_LABELS[apiStatus]}</div>
    </div>

    <div className="grid flex-1 gap-4 xl:grid-cols-[minmax(245px,0.82fr)_minmax(440px,1.55fr)_minmax(260px,0.9fr)]">
      <section aria-labelledby="mission-goal-title" className="flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_8px_30px_-24px_rgba(24,24,27,0.3)] sm:p-6">
        <div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-xl bg-zinc-100 text-zinc-700"><Sparkles aria-hidden="true" className="size-4" /></div><div><h2 id="mission-goal-title" className="text-sm font-semibold">目標與輸入</h2><p className="mt-0.5 text-xs text-zinc-500">載入資料 → 建立計畫 → 確認執行</p></div></div>
        <button type="button" onClick={loadSample} disabled={isReadingSource || isPlanning || isCreatingRun || runBlocksNewWork} className="mt-5 min-h-11 rounded-lg bg-zinc-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{isReadingSource ? '正在載入…' : '使用示範發票'}</button>
        <p className="mt-2 text-xs text-zinc-500">合成資料，不含真實客戶紀錄。載入後按「建立計畫」。</p>
        <label htmlFor="mission-goal" className="mt-6 text-xs font-semibold text-zinc-700">任務目標</label>
        <textarea id="mission-goal" placeholder={GOAL_PLACEHOLDER} value={goal} disabled={isPlanning || isCreatingRun || runBlocksNewWork} onChange={(event) => { const nextGoal = event.target.value; setGoal(nextGoal); if (selectedTemplateId && plannedWorkflow) { setPlannedWorkflow({ ...plannedWorkflow, goal: nextGoal }); setPlannerPreview(null); setConfirmedSignature(null); setPlanError(null); setRunError(null); idempotencyRef.current = null } else { setSelectedTemplateId(null); setSelectedTemplateVersion(null); setTemplateName(''); clearPlanState() } }} className="mt-2 min-h-32 resize-y rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5 text-sm leading-6 text-zinc-800 outline-none transition focus:border-zinc-400 focus:bg-white focus-visible:ring-2 focus-visible:ring-zinc-950 motion-reduce:transition-none disabled:opacity-60" />
        <div className="mt-6 flex items-center justify-between"><label htmlFor="mission-source" className="text-xs font-semibold text-zinc-700">來源檔案</label><span className="rounded-full bg-zinc-100 px-2 py-1 text-[10px] font-medium text-zinc-500">CSV / TXT · 最多 1 MB</span></div>
        <label htmlFor="mission-source" className="mt-2 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 px-4 py-4 text-center transition hover:border-zinc-500 hover:bg-zinc-50 focus-within:ring-2 focus-within:ring-zinc-950 focus-within:ring-offset-2 motion-reduce:transition-none">
          <FileUp aria-hidden="true" className="size-5 text-zinc-500" />
          <span className="mt-2 text-xs font-semibold text-zinc-700">{isReadingSource ? '讀取本機檔案中…' : '選取本機檔案'}</span>
          <span className="mt-1 break-all text-[11px] text-zinc-500">{source?.name ?? '選取 CSV 或純文字檔'}</span>
          <input ref={fileInputRef} id="mission-source" type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" disabled={isReadingSource || isPlanning || isCreatingRun || runBlocksNewWork} onClick={clearSource} onChange={selectSource} aria-describedby="source-note" />
        </label>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><p id="source-note" className="text-[11px] leading-5 text-zinc-600">資料由本機處理。更換檔案後，需要重新確認計畫。PDF 與 Excel 檔案尚未支援。</p>{source && <button type="button" onClick={clearSource} disabled={isPlanning || isCreatingRun || runBlocksNewWork} className="min-h-11 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:opacity-50">清除來源</button>}</div>
        {source && <p aria-live="polite" className="mt-1 text-[11px] text-zinc-500">{(new TextEncoder().encode(source.content).byteLength / 1024).toFixed(1)} KiB · {source.type === 'csv' ? 'CSV' : '純文字'}</p>}
        {sourceError && <ErrorNotice detail={sourceError} message="無法讀取發票。請使用示範資料，或另存為 CSV 後重試。" />}
        <div className="mt-auto pt-6"><div className="flex items-center justify-between border-t border-zinc-100 pt-4 text-xs"><span className="text-zinc-500">執行模式</span><span className="font-medium text-zinc-700">單一本機模型 · 序列流程</span></div></div>
      </section>

      <section aria-labelledby="workflow-title" className="flex min-w-0 flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_8px_30px_-24px_rgba(24,24,27,0.3)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="workflow-title" className="text-sm font-semibold">確認發票處理計畫</h2><p className="mt-1 text-xs text-zinc-500">先建立計畫；核對篩選條件後才會開始處理。</p></div><span className="rounded-full border border-zinc-200 px-2.5 py-1 text-[10px] font-medium text-zinc-500">{plannedWorkflow ? `Draft · ${plannedWorkflow.steps.length} 個步驟` : runInfo ? '已恢復 Run workflow' : '尚無提案'}</span></div>
        {plannedWorkflow && <>
          <div className="mt-4 flex items-center justify-between gap-3"><span className="text-xs text-zinc-500">{isEditingPlan ? '編輯中 · 完成後請重新確認計畫' : '計畫預覽 · 需要調整條件時按「修改計畫」'}</span><button type="button" disabled={isPlanning || isCreatingRun || runBlocksNewWork || (isEditingPlan && pillErrors.length > 0)} onClick={() => { setIsEditingPlan(!isEditingPlan); setConfirmedSignature(null); idempotencyRef.current = null }} className="rounded-lg border border-zinc-300 px-4 py-2 text-xs font-semibold disabled:opacity-40">{isEditingPlan ? '完成修改' : '修改計畫'}</button></div>
          {isEditingPlan ? <LogicPillsEditor pills={pills} disabled={!isEditingPlan || isPlanning || isCreatingRun || runBlocksNewWork} onChange={(nextPills) => { setPills(nextPills); setConfirmedSignature(null); setRunError(null); idempotencyRef.current = null }} /> : <p className="mt-3 rounded-xl bg-zinc-50 p-4 text-sm leading-6">篩選 {displayCurrency} {(displayThresholdMinor / 100).toLocaleString('zh-Hant', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 以上（不含相同金額）的發票，保留缺漏標記。請核對下方步驟後確認。</p>}

          {pillErrors.length > 0 && <div role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{pillErrors.map((error, index) => <p key={index}>{error}</p>)}<button type="button" disabled={isCreatingRun || runBlocksNewWork} onClick={() => { setPills(plannedWorkflow.pills ?? deriveLogicPills(plannedWorkflow)); setConfirmedSignature(null) }} className="mt-2 underline">還原提案 Pills</button></div>}
        </>}
        <p className="mt-3 text-xs leading-5 text-zinc-500">目前僅能執行發票 CSV／TXT 欄位篩選流程。新增註記不會自動新增工具能力，請使用合成資料示範。</p>
        <details aria-labelledby="workflow-template-title" className="mt-4 rounded-xl border border-zinc-200 bg-white p-4"><summary className="cursor-pointer text-xs font-semibold">進階：儲存與載入模板</summary>
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 id="workflow-template-title" className="text-xs font-semibold text-zinc-800">可重用 workflow 模板</h3><p className="mt-1 text-[10px] leading-4 text-zinc-500">只儲存模板名稱與 workflow；來源檔、來源列及 Run artifacts 不會儲存。請勿把敏感資料放入名稱或任務目標。</p></div><span className="rounded-full bg-zinc-100 px-2 py-1 text-[10px] text-zinc-500">{templateStoreReady ? `${savedTemplates.length} 個版本` : '載入模板…'}</span></div>
          <div className="mt-3 flex flex-wrap gap-2"><div className="min-w-48 flex-1"><label htmlFor="workflow-template-name" className="sr-only">模板名稱</label><input id="workflow-template-name" value={templateName} onChange={(event) => setTemplateName(event.target.value)} maxLength={80} disabled={!templateStoreReady || runBlocksNewWork} placeholder="輸入模板名稱" className="w-full rounded-lg border border-zinc-300 px-2.5 py-2 text-xs outline-none focus:border-zinc-600 disabled:opacity-60" /></div><button type="button" onClick={saveWorkflowTemplate} disabled={!templateStoreReady || !templateStoreWritable || !editedWorkflow || runBlocksNewWork || !templateName.trim()} className="rounded-lg bg-zinc-950 px-3 py-2 text-[11px] font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300">{selectedTemplate ? `儲存新版本 v${selectedTemplate.version + 1}` : '儲存為模板 v1'}</button>{selectedTemplate && <button type="button" onClick={startNewWorkflowTemplate} disabled={runBlocksNewWork} className="rounded-lg border border-zinc-300 px-3 py-2 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">另存為新模板</button>}</div>
          {templateError && <ErrorNotice detail={templateError} message="模板尚未儲存，請檢查名稱與儲存空間。" />}
          {savedTemplates.length > 0 ? <details className="mt-3"><summary className="cursor-pointer text-[10px] font-semibold text-zinc-600">載入已儲存版本</summary><ul className="mt-2 max-h-40 space-y-1 overflow-auto">{[...savedTemplates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.version - a.version).map((template) => <li key={`${template.id}-v${template.version}`}><button type="button" onClick={() => loadWorkflowTemplate(template)} disabled={runBlocksNewWork} aria-pressed={selectedTemplateId === template.id && selectedTemplateVersion === template.version} className="flex w-full items-start justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[10px] hover:bg-zinc-50 disabled:opacity-50"><span className="min-w-0 break-words font-medium text-zinc-700">{template.name} · v{template.version}</span><span className="shrink-0 text-zinc-500">{new Date(template.updatedAt).toLocaleDateString()}</span></button></li>)}</ul></details> : templateStoreReady && <p className="mt-2 text-[10px] text-zinc-500">尚無儲存的 workflow 模板。</p>}
        </details>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] text-zinc-500">先預覽計畫，確認後才會處理資料。</p><button type="button" onClick={createPlan} disabled={planningDisabled} className="flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-zinc-700 motion-reduce:transition-none disabled:cursor-not-allowed disabled:bg-zinc-300"><Sparkles aria-hidden="true" className="size-3.5" />{isPlanning ? '建立計畫中…' : '建立計畫'}</button></div>
        {planError && <ErrorNotice detail={planError} message="計畫尚未建立，請檢查本機 AI 與發票資料後重試。" />}

        {workflowForDisplay ? <>
          <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-semibold text-zinc-800">處理目標</h3><span className="text-[10px] font-medium text-zinc-500">{selectedTemplate ? `模板 ${selectedTemplate.name} · v${selectedTemplate.version}${selectedTemplateDirty ? ' · 有未儲存修改' : ''}` : '未套用已儲存模板'}</span></div><p className="mt-1 text-xs leading-5 text-zinc-600">{workflowForDisplay.goal}</p><p className="mt-2 break-all text-[10px] text-zinc-500">來源批次：{source?.name ?? '尚未選取；載入模板後請選取新來源檔案。'}</p></div>
          <ol className="mt-3 flex flex-col gap-2">
            {workflowForDisplay.steps.map((step, index) => {
              const taskState = runWorkflowMatches ? runInfo?.taskStates[step.id] : undefined
              const isCurrentTask = Boolean(taskState && runInfo?.currentTask === step.id)
              const isActiveTask = Boolean(taskState && (taskState.status === 'running' || taskState.status === 'validating'))
              return <li key={step.id} className={`rounded-xl border p-3.5 transition-colors motion-reduce:transition-none ${isCurrentTask || isActiveTask ? 'border-sky-300 bg-sky-50 ring-1 ring-sky-200' : 'border-zinc-200 bg-white'}`}><div className="flex items-start gap-3"><span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${isCurrentTask || isActiveTask ? 'bg-sky-700 text-white' : 'bg-zinc-950 text-white'}`}>{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-zinc-900">{TOOL_TITLES[step.tool]}</h3><span className={`rounded-full px-2 py-1 text-[10px] ${taskState?.status === 'failed' || taskState?.status === 'retry_pending' ? 'bg-amber-100 text-amber-800' : 'bg-zinc-100 text-zinc-600'}`}>{taskState ? TASK_STATUS_LABELS[taskState.status] : editedWorkflow ? '待執行' : '尚未回報'}</span></div><p className="mt-1 text-xs leading-5 text-zinc-500">{describeWorkflowStep(step, displayThresholdMinor, displayCurrency, displayRequiredFields)}</p><details className="mt-2 text-xs text-zinc-500"><summary className="cursor-pointer">進階詳情</summary><code>{step.tool}</code>{taskState && <p className="mt-2 text-[10px] text-zinc-500">Attempts · {taskState.attempts}{taskState.validation?.evidence[0] ? ` · ${taskState.validation.evidence[0]}` : ''}</p>}</details></div></div></li>
            })}
          </ol>
          {editedWorkflow && previewText && <details className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3"><summary className="cursor-pointer text-xs font-semibold text-zinc-700">進階詳情：計畫資料</summary><pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-zinc-600">{previewText}</pre></details>}
          {editedWorkflow && source ? <>
            <label className={`mt-4 flex items-start gap-3 rounded-xl border p-4 text-xs leading-5 ${isConfirmed ? 'border-emerald-300 bg-emerald-50' : 'border-zinc-200 bg-zinc-50'}`}><input type="checkbox" checked={isConfirmed} disabled={!source || isEditingPlan || Boolean(pillErrors.length) || isCreatingRun || runBlocksNewWork} onChange={(event) => setConfirmedSignature(event.target.checked ? payloadSignature : null)} className="mt-0.5 size-4 accent-zinc-950" /><span><span className="font-semibold text-zinc-800">我已檢查來源與篩選條件，同意開始整理。</span><span className="mt-1 block text-zinc-500">確認內容改變時，核准會自動失效，需重新確認。</span></span></label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] text-zinc-500">確認後即在本機整理發票。</p><button type="button" onClick={createRun} disabled={!canCreateRun} className="flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-zinc-700 motion-reduce:transition-none disabled:cursor-not-allowed disabled:bg-zinc-300">{isCreatingRun ? '正在開始整理…' : runBlocksNewWork ? '正在整理中' : '確認並開始整理'} <ArrowRight aria-hidden="true" className="size-3.5" /></button></div>
            {runError && <ErrorNotice detail={runError} message="處理尚未開始，請重試。" />}
          </> : runInfo && <p className="mt-4 rounded-xl bg-zinc-50 px-4 py-3 text-xs leading-5 text-zinc-600">此為從已保存的 Run ID 載入的 workflow 快照；來源內容不會從 localStorage 還原。</p>}
        </> : <div className="mt-4 flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 px-5 py-8 text-center"><CircleDashed aria-hidden="true" className="size-5 text-zinc-500" /><p className="mt-3 text-sm font-semibold text-zinc-700">尚未建立計畫</p><p className="mt-1 max-w-md text-xs leading-5 text-zinc-500">按「使用示範發票」，再按「建立計畫」。確認前不會開始整理。</p></div>}
      </section>

      <section aria-labelledby="result-title" className="flex flex-col rounded-2xl border border-zinc-200 bg-zinc-50/60 p-5 sm:p-6">
        <div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-xl bg-white text-zinc-600 ring-1 ring-zinc-200"><FileText aria-hidden="true" className="size-4" /></div><div><h2 id="result-title" className="text-sm font-semibold">處理結果</h2><p className="mt-0.5 text-xs text-zinc-500">完成後可下載並檢視 CSV</p></div></div>
        {runInfo ? <div className="mt-5 flex flex-1 flex-col rounded-xl border border-zinc-200 bg-white p-4"><p role="status" aria-live="polite" className="text-sm font-semibold text-zinc-900">{syncError ? `最近一次 API 回報：${RUN_STATUS_LABELS[runInfo.status]}` : RUN_STATUS_LABELS[runInfo.status]}</p><details className="mt-3 text-xs"><summary className="cursor-pointer">進階詳情：處理識別與來源</summary><p className="mt-2 break-all font-mono text-[11px] text-zinc-500">Run ID · {runInfo.id}</p><p className="mt-1 text-[11px] text-zinc-500">Workflow version · {runInfo.workflowVersion}</p><p className="mt-1 break-all text-[11px] text-zinc-500">來源批次 · {runSourceBatch ?? (apiSourceBatchLabel || 'Run API 尚未回報來源參照')}</p><p className="mt-1 break-words text-[11px] text-zinc-500">模板版本 · {runTemplateLabel ?? 'GET Run 未提供模板版本（僅以 Run ID 恢復）'}</p>{runInfo.currentTask && <p className="mt-2 break-all text-xs text-zinc-600">目前 Task · {runInfo.currentTask}</p>}
</details>
          {runInfo.status === 'running' && <p role="status" className="mt-3 rounded-lg bg-sky-50 p-3 text-[11px] leading-5 text-sky-900">正在整理發票，完成後會顯示下載按鈕。</p>}
          {runInfo.status === 'cancelling' && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-[11px] leading-5 text-amber-900">已送出取消要求，正在等待 Agent API 回報 cancelled 或其他最終狀態。</p>}
          {runInfo.status === 'awaiting_approval' && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-[11px] leading-5 text-amber-900">Agent API 回報此 Run 尚待核准。請確認 workflow 與來源批次後，再使用 API 支援的核准流程。</p>}
          {runInfo.status === 'completed' && (runInfo.artifacts.length > 0
            ? <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-[11px] leading-5 text-emerald-900">整理完成。請下載並核對結果中的缺漏標記。</p>
            : <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-[11px] leading-5 text-amber-900">處理已結束，但沒有產生結果。請重新同步；若仍失敗，請聯絡支援。</p>)}
          {runInfo.status === 'cancelled' && <p role="status" className="mt-3 rounded-lg bg-zinc-100 p-3 text-[11px] leading-5 text-zinc-800">Agent API 已回報取消。僅使用仍列在下方的 artifacts；如需重跑，請選新來源並重新核准 workflow。</p>}
          {runInfo.status === 'failed' && <ErrorNotice detail={`${runFailureCode ?? ''}: ${runFailureMessage ?? ''}`} message="整理未完成。請檢查來源與條件，重新建立計畫。" />}
          <details className="mt-3 text-xs"><summary className="cursor-pointer">進階詳情：步驟檢核</summary><div className="mt-4 border-t border-zinc-100 pt-3"><h3 className="text-[11px] font-semibold text-zinc-700">Task states</h3>{Object.entries(runInfo.taskStates).length > 0 ? <ul className="mt-2 space-y-2">{Object.entries(runInfo.taskStates).map(([taskId, taskState]) => { const taskStep = runInfo.workflow.steps.find((step) => step.id === taskId); const current = runInfo.currentTask === taskId; return <li key={taskId} className={`rounded-lg border px-3 py-2 ${current ? 'border-sky-300 bg-sky-50' : 'border-zinc-100 bg-zinc-50'}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all text-[11px] font-medium text-zinc-800">{taskStep ? TOOL_TITLES[taskStep.tool] : taskId}</span><span className="text-[10px] text-zinc-600">{TASK_STATUS_LABELS[taskState.status]}</span></div><p className="mt-1 text-[10px] text-zinc-500">Attempts · {taskState.attempts}{taskState.validation ? ` · ${taskState.validation.pass ? '檢核通過' : '檢核未通過'} · ${taskState.validation.code}` : ''}</p>{taskState.validation?.evidence.length ? <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] leading-4 text-zinc-600">{taskState.validation.evidence.map((item, index) => <li key={`${taskId}-validation-${index}`}>{item}</li>)}</ul> : taskState.status === 'failed' ? <p className="mt-1 text-[10px] text-amber-800">API 未提供此 Task 的驗證證據。</p> : null}</li> })}</ul> : <p className="mt-2 text-[11px] text-zinc-500">Run API 尚未回報 Task 狀態。</p>}</div></details>
          <div className="mt-4 border-t border-zinc-100 pt-3"><h3 className="text-[11px] font-semibold text-zinc-700">可下載的結果</h3>{runInfo.artifacts.length === 0 ? <p role="status" className="mt-2 text-[11px] leading-5 text-zinc-500">{isTerminalRunStatus(runInfo.status) ? '處理已停止，目前沒有可下載的結果。' : '正在等待整理結果。'}</p> : <ul className="mt-2 space-y-3">{runInfo.artifacts.map((artifact) => {
            const table = artifactPreview?.artifactId === artifact.id ? artifactPreview.table : null
            const referenceRows = artifact.sourceRefs.slice(0, 50)
            return <li key={artifact.id} className="rounded-lg border border-zinc-200 bg-white p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-all text-[11px] font-semibold text-zinc-800">{artifact.type}</p><details className="mt-2 text-xs"><summary className="cursor-pointer">進階詳情：結果位置</summary><p className="break-all">{artifact.location}</p></details></div>{isCsvArtifact(artifact) && <button type="button" onClick={() => void downloadCsvArtifact(artifact)} disabled={artifactLoadingId !== null} className="shrink-0 rounded-md border border-zinc-300 px-2 py-1.5 text-[10px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60">{artifactLoadingId === artifact.id ? '載入 CSV…' : '下載並檢視 CSV'}</button>}</div>
              <p className={`mt-2 text-[10px] font-semibold ${artifact.validation.pass ? 'text-emerald-700' : 'text-amber-800'}`}>檢核：{artifact.validation.pass ? '通過' : '未通過'} · {artifact.validation.code}{artifact.validation.retryable ? ' · 可重試' : ''}</p>
              {artifact.validation.evidence.length > 0 ? <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] leading-4 text-zinc-600">{artifact.validation.evidence.map((item, index) => <li key={`${artifact.id}-evidence-${index}`}>{item}</li>)}</ul> : <p className="mt-1 text-[10px] text-zinc-500">Artifact 未提供檢核證據。</p>}
              <details className="mt-2"><summary className="cursor-pointer text-[10px] font-medium text-zinc-600">來源參照 · {artifact.sourceRefs.length} 筆</summary>{artifact.sourceRefs.length > 0 ? <ul className="mt-2 max-h-32 space-y-1 overflow-auto rounded bg-zinc-50 p-2 text-[10px] text-zinc-600">{referenceRows.map((reference, index) => <li key={`${artifact.id}-source-${index}`} className="break-all">{reference.fileName} · {'rowNumber' in reference ? `第 ${reference.rowNumber} 列` : `第 ${reference.lineNumber} 行`}</li>)}{artifact.sourceRefs.length > referenceRows.length && <li>另有 {artifact.sourceRefs.length - referenceRows.length} 筆來源參照。</li>}</ul> : <p className="mt-2 text-[10px] text-zinc-500">Artifact 未提供來源參照。</p>}</details>
              {table && <div className="mt-3 border-t border-zinc-100 pt-3"><h4 className="text-[10px] font-semibold text-zinc-700">CSV 結果列</h4>{table.rows.length === 0 ? <p role="status" className="mt-2 text-[10px] text-zinc-500">CSV 目前沒有資料列。</p> : <><p className="mt-1 text-[10px] text-zinc-500">共 {table.rows.length} 列；畫面最多顯示前 100 列。完整 CSV 已交由瀏覽器下載。</p><div className="mt-2 max-h-80 space-y-2 overflow-auto">{table.rows.slice(0, 100).map((row, rowIndex) => {
                const sourceFile = sourceFileColumn >= 0 ? row[sourceFileColumn] : ''
                const sourceLocation = sourceLocationColumn >= 0 ? row[sourceLocationColumn] : ''
                const status = resultStatusColumn >= 0 ? row[resultStatusColumn] : ''
                const reason = resultReasonColumn >= 0 ? row[resultReasonColumn] : ''
                return <article key={`${artifact.id}-result-${rowIndex}`} className="rounded-md border border-zinc-200 p-2"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] font-semibold text-zinc-700">結果列 {rowIndex + 1}</span><span className="break-all text-[10px] text-zinc-500">來源：{sourceFile ? `${sourceFile}${sourceLocation ? ` · ${sourceLocationColumn >= 0 && normalizedHeader(table.headers[sourceLocationColumn]).includes('line') ? '行' : '列'} ${sourceLocation}` : ''}` : 'CSV 未提供來源欄位'}</span></div><p className="mt-1 text-[10px] leading-4 text-zinc-600">檢核／標記：{status || 'CSV 未提供狀態'}{reason ? ` · 原因：${reason}` : resultReasonColumn < 0 ? ' · CSV 未提供獨立原因欄' : ''}</p><details className="mt-1"><summary className="cursor-pointer text-[10px] text-sky-800">檢視此列欄位</summary><dl className="mt-1 grid grid-cols-[minmax(70px,0.7fr)_minmax(0,1.3fr)] gap-x-2 gap-y-1 text-[10px]">{table.headers.map((header, columnIndex) => <div key={`${artifact.id}-${rowIndex}-${header}-${columnIndex}`} className="contents"><dt className="break-words font-medium text-zinc-500">{header}</dt><dd className="break-all text-zinc-700">{row[columnIndex] || '（空白）'}</dd></div>)}</dl></details></article>
              })}</div></>}</div>}
            </li>
          })}</ul>}
          {artifactError && <ErrorNotice detail={artifactError} message="結果暫時無法下載，請重試。" />}
          </div>
          {runInfo.status === 'needs_input' && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-900">Run 暫停，等待補資料</p><details className="mt-2 text-xs"><summary>進階詳情</summary>{needsInputReason ?? "需要補正資料"}</details>
            {runInfo.currentTask ? <form onSubmit={submitNeedsInputCorrection} className="mt-3 space-y-2"><fieldset disabled={!NEEDS_INPUT_CORRECTIONS_SUPPORTED || isResuming} className="space-y-2 disabled:opacity-60"><p className="text-[10px] leading-4 text-amber-900">API 支援補正幣別或門檻。幣別需存在於來源；thresholdMinor 使用最小貨幣單位（例如 HKD 100.00 輸入 10000）。</p><div><label htmlFor="resume-field" className="text-[10px] font-semibold text-amber-950">要補正的欄位</label><select id="resume-field" value={correctionField} onChange={(event) => { setCorrectionField(event.target.value); setCorrectionValue(''); setCorrectionError(null) }} required className="mt-1 min-h-11 w-full rounded-lg border border-amber-300 bg-white px-2.5 py-2 text-xs text-zinc-900 outline-none focus:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-700"><option value="" disabled>選擇欄位</option><option value="currency">幣別（currency）</option><option value="thresholdMinor">金額門檻（thresholdMinor）</option></select></div><div><label htmlFor="resume-value" className="text-[10px] font-semibold text-amber-950">正確資料</label><input id="resume-value" value={correctionValue} onChange={(event) => { setCorrectionValue(event.target.value); setCorrectionError(null) }} required maxLength={32} inputMode={correctionField === 'thresholdMinor' ? 'numeric' : 'text'} pattern={correctionField === 'thresholdMinor' ? '[0-9]{1,16}' : correctionField === 'currency' ? '[A-Z]{3}' : undefined} aria-invalid={Boolean(correctionError)} aria-describedby={correctionError ? 'resume-value-error' : undefined} placeholder={correctionField === 'thresholdMinor' ? '例如 10000（代表 HKD 100.00）' : correctionField === 'currency' ? '例如 HKD' : '先選擇要補正的欄位'} className="mt-1 min-h-11 w-full rounded-lg border border-amber-300 bg-white px-2.5 py-2 text-xs text-zinc-900 outline-none focus:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-700" />{correctionError && <p id="resume-value-error" role="alert" className="mt-1 text-[11px] leading-4 text-amber-900">{correctionError}</p>}</div><button type="submit" disabled={!NEEDS_INPUT_CORRECTIONS_SUPPORTED || isResuming || !correctionField || !correctionValue.trim()} className="min-h-11 rounded-lg bg-zinc-950 px-3 py-2 text-[11px] font-semibold text-white hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-400">{isResuming ? '送出補正中…' : '送出補正並繼續'}</button></fieldset></form> : <p className="mt-3 text-[10px] leading-4 text-amber-900">Run API 未提供目前 Task ID，暫時無法安全提交補正。</p>}
            <button type="button" onClick={retryRunSync} className="mt-3 min-h-11 rounded-lg border border-amber-800 px-3 py-2 text-[10px] font-semibold text-amber-950 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-800">重新讀取 Run 狀態</button>
          </div>}
          {runInfo.status === 'interrupted' && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-900">Run 已中斷</p><p className="mt-1 text-[11px] leading-5 text-amber-800">可使用「繼續執行」向 API 請求恢復。API 只接受沒有已提交 artifact 且來源仍可用的 interrupted Run；如果恢復失敗，請查看錯誤後選來源建立新 Run。</p><button type="button" onClick={() => void resumeRun()} disabled={isResuming} className="mt-3 min-h-11 rounded-lg bg-zinc-950 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:bg-zinc-300 motion-reduce:transition-none">{isResuming ? '恢復請求中…' : '繼續執行'}</button></div>}
          {canCancelRun && <button type="button" onClick={cancelRun} disabled={isCancelling || runInfo.status === 'cancelling'} className="mt-4 self-start rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">{isCancelling || runInfo.status === 'cancelling' ? '等待取消狀態…' : '取消 Run'}</button>}
          {syncError && <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><ErrorNotice detail={syncError} message="進度暫時無法更新，請重新同步。" /><button type="button" onClick={retryRunSync} className="mt-2 block font-semibold underline underline-offset-2">重新同步 Run</button></div>}
          <details className="mt-auto pt-4 text-[11px] text-zinc-500"><summary>進階詳情：連線狀態</summary>{liveMode === 'sse' ? 'SSE events 已連線' : liveMode === 'polling' ? 'SSE 不可用，使用 events polling' : liveMode === 'connecting' ? '正在補讀 Run 與事件…' : 'Run 已暫停或結束，停止輪詢。'}</details>
        </div> : <div className="mt-5 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white px-5 py-8 text-center"><div className="flex size-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-500"><CircleDashed aria-hidden="true" className="size-5" /></div><p className="mt-4 text-sm font-semibold text-zinc-800">{runId && liveMode === 'connecting' ? '正在恢復 Run 狀態' : '尚未開始整理'}</p><p className="mt-2 max-w-[250px] text-xs leading-5 text-zinc-500">{runId ? '正在讀取上次處理結果。' : '確認計畫後，這裡會顯示處理進度與結果。'}</p>{syncError && <div role="alert" className="mt-3 text-xs leading-5 text-amber-900"><ErrorNotice detail={syncError} message="進度暫時無法更新，請重新同步。" /><button type="button" onClick={retryRunSync} className="mt-2 block font-semibold underline underline-offset-2">重新同步 Run</button></div>}</div>}
      </section>
    </div>

    <details aria-labelledby="events-title" className="mt-4 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6"><summary className="cursor-pointer text-sm font-semibold">進階詳情：執行紀錄</summary>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="events-title" className="text-sm font-semibold">執行事件</h2><p className="mt-1 text-xs text-zinc-500">RunEvent · 去重後按 sequence 接收</p></div><span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-medium text-zinc-500">{runInfo ? `${runEvents.length} events · ${liveMode}` : runId ? '等待恢復' : '尚無 Run'}</span></div>
      {eventError && <ErrorNotice detail={eventError} message="更新進度暫時中斷，請重新同步。" />}
      {runEvents.length > 0 ? <ol className="mt-4 divide-y divide-zinc-100 rounded-xl border border-zinc-200">{runEvents.slice(-12).map((event) => <li key={event.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 text-xs"><span className="shrink-0 font-mono text-zinc-500">#{event.sequence}</span><span className="min-w-24 font-semibold text-zinc-800">{event.type}</span>{event.taskId && <span className="break-all text-zinc-500">Task · {event.taskId}</span>}<span className="min-w-0 flex-1 text-zinc-600">{eventMessage(event.payload) ?? 'API 已回報事件。'}</span><time className="text-[10px] text-zinc-500">{event.time}</time></li>)}</ol> : <div role="status" className="mt-4 flex min-h-16 items-center gap-3 rounded-xl bg-zinc-50 px-4 py-3"><CircleDashed aria-hidden="true" className="size-4 shrink-0 text-zinc-500" /><p className="text-xs leading-5 text-zinc-500">{runInfo ? shouldPauseRunUpdates(runInfo.status) ? '此 Run 目前沒有已回報事件。' : '尚無事件，正在等待 Agent API 回報。' : runId ? '正在使用 Run ID 載入狀態與事件。' : '建立 Run 後，這裡會顯示 API 實際回報的事件。'}</p></div>}
    </details>
  </section>
}

export default function AgentWorkspace({ view }: { view: 'main-stage' | 'normal-llm' }) {
  const [apiStatus, setApiStatus] = useState<ApiResponseStatus>('unconfirmed')
  return view === 'normal-llm' ? <NormalLlm /> : <MainStage apiStatus={apiStatus} onApiStatusChange={setApiStatus} />
}
