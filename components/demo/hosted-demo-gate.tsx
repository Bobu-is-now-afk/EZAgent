'use client'

import { useEffect, useState } from 'react'

type DemoStatus = 'disabled' | 'maintenance' | 'busy' | 'stopped' | 'ready'
type DemoCapabilities = {
  version: 1
  status: DemoStatus
  message?: string
  dataPolicyUrl: string | null
  capabilities: { chat: boolean; invoicePlan: boolean; invoicePlanQueue: boolean; invoiceRun: boolean; localModelSetup: false }
  queue?: { full?: boolean; pollAfterMs?: number }
  requestLimits?: {
    maxRequestBytes: number
    maxRequestsPerSessionPerMinute: number
    maxCallsPerVisitorPerUtcDay: number
    maxCallsPerUtcDay: number
    maxConcurrentModelCalls: number
    maxConcurrentRuns: number
  }
}

export type HostedDemoInfo = {
  status: DemoStatus
  canPlan: boolean
  canQueuePlan: boolean
  canRun: boolean
  queueFull: boolean
  pollAfterMs: number
  dataPolicyUrl: string | null
  expiresAt: string
  requestLimits?: DemoCapabilities['requestLimits']
}

type GateState =
  | { kind: 'checking' }
  | { kind: 'closed'; message: string }
  | { kind: 'access-required'; data: DemoCapabilities; error?: string }
  | { kind: 'error'; message: string }

function safePolicyPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('..')) return null
  return value
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json()
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function closedMessage(status: DemoStatus, fallback?: string) {
  switch (status) {
    case 'disabled': return '線上示範尚未開放。服務未通過發佈檢查；目前不能上傳或執行。'
    case 'maintenance': return '線上示範正在維護；目前不能上傳或執行。'
    case 'busy': return '線上示範目前忙碌；可登入查看既有工作，並依佇列狀態提交計畫。'
    case 'stopped': return '示範模型目前停止或無法連線；可登入查看既有工作，但目前不能建立計畫。'
    default: return fallback ?? '線上示範暫時無法使用；目前不能上傳或執行。'
  }
}

export function HostedDemoGate({ onAuthorized }: { onAuthorized: (info: HostedDemoInfo) => void }) {
  const [state, setState] = useState<GateState>({ kind: 'checking' })
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const capabilityResponse = await fetch('/api/demo/capabilities', { cache: 'no-store', credentials: 'same-origin' })
        if (!capabilityResponse.ok) throw new Error('capabilities_unavailable')
        const capabilities = await capabilityResponse.json() as DemoCapabilities
        if (capabilities.version !== 1 || !['disabled', 'maintenance', 'busy', 'stopped', 'ready'].includes(capabilities.status)) throw new Error('capabilities_invalid')
        if (!safePolicyPath(capabilities.dataPolicyUrl)) {
          if (!cancelled) setState({ kind: 'closed', message: '示範資料政策未設定；目前不能開啟或使用線上示範。' })
          return
        }
        if (['disabled', 'maintenance'].includes(capabilities.status) || !capabilities.capabilities.invoicePlanQueue) {
          const message = capabilities.status === 'ready' || capabilities.status === 'busy' || capabilities.status === 'stopped'
            ? '示範服務尚未完成受限計畫佇列能力的驗收；目前不能上傳或執行。'
            : closedMessage(capabilities.status, capabilities.message)
          if (!cancelled) setState({ kind: 'closed', message })
          return
        }

        const sessionResponse = await fetch('/api/demo/session', { cache: 'no-store', credentials: 'same-origin' })
        if (!sessionResponse.ok) throw new Error('session_status_unavailable')
        const session = await readJson(sessionResponse)
        if (session.authenticated === true) {
          onAuthorized(toHostedInfo(capabilities, ''))
          return
        }
        if (!cancelled) setState({ kind: 'access-required', data: capabilities })
      } catch {
        if (!cancelled) setState({ kind: 'error', message: '無法確認線上示範狀態；目前不能上傳或執行。請稍後重新載入。' })
      }
    }
    void check()
    return () => { cancelled = true }
  }, [onAuthorized])

  async function submitAccessCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (state.kind !== 'access-required' || !code || submitting) return
    setSubmitting(true)
    try {
      const response = await fetch('/api/demo/session', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const body = await readJson(response)
      if (!response.ok || body.authenticated !== true || typeof body.expiresAt !== 'string') {
        const message = body.error && typeof body.error === 'object' && 'code' in body.error && body.error.code === 'invalid_demo_access'
          ? '示範代碼無效，請檢查後重試。'
          : '無法建立示範工作階段；示範目前未開放或暫時無法使用。'
        setState((current) => current.kind === 'access-required' ? { ...current, error: message } : current)
        return
      }
      setCode('')
      const refreshed = await fetch('/api/demo/capabilities', { cache: 'no-store', credentials: 'same-origin' })
      if (!refreshed.ok) throw new Error('capabilities_refresh_failed')
      const capabilities = await refreshed.json() as DemoCapabilities
      if (capabilities.version !== 1 || !['disabled', 'maintenance', 'busy', 'stopped', 'ready'].includes(capabilities.status) || !capabilities.capabilities?.invoicePlanQueue || ['disabled', 'maintenance'].includes(capabilities.status)) throw new Error('capabilities_no_longer_available')
      onAuthorized(toHostedInfo(capabilities, body.expiresAt))
    } catch {
      setState((current) => current.kind === 'access-required' ? { ...current, error: '無法連接示範服務，請稍後重試。' } : current)
    } finally {
      setSubmitting(false)
    }
  }

  const panelClass = 'mx-auto max-w-3xl rounded-2xl border p-6'
  if (state.kind === 'checking') return <p role="status" className={`${panelClass} border-zinc-200 bg-zinc-50 text-sm text-zinc-600`}>正在檢查線上示範狀態…</p>
  if (state.kind === 'closed') return <section role="status" className={`${panelClass} border-amber-300 bg-amber-50 text-amber-950`}><h1 className="text-xl font-semibold">線上發票示範尚未開放</h1><p className="mt-2 text-sm leading-6">{state.message}</p><DemoSafetyNotice /></section>
  if (state.kind === 'error') return <section role="alert" className={`${panelClass} border-amber-300 bg-amber-50 text-amber-950`}><h1 className="text-xl font-semibold">無法確認示範狀態</h1><p className="mt-2 text-sm leading-6">{state.message}</p><DemoSafetyNotice /></section>

  const policyPath = safePolicyPath(state.data.dataPolicyUrl)
  return <section className={`${panelClass} border-amber-300 bg-amber-50 text-amber-950`}>
    <h1 className="text-xl font-semibold">線上發票示範 · Mac mini</h1>
    <p className="mt-2 text-sm leading-6">此服務會把輸入的 CSV／TXT 傳到 Mac mini。只使用合成資料；目前沒有自助刪除功能，資料處理方式請先閱讀{policyPath ? <a className="font-semibold underline underline-offset-2" href={policyPath}>示範資料政策</a> : '示範資料政策（目前未提供）'}。未提供資料政策連結時不會允許開啟示範。</p>
    <DemoSafetyNotice />
    {state.data.requestLimits && <p className="mt-3 text-xs leading-5">上限：單次請求 {Math.floor(state.data.requestLimits.maxRequestBytes / 1024)} KiB、模型同時處理 {state.data.requestLimits.maxConcurrentModelCalls} 個、每位訪客每日 {state.data.requestLimits.maxCallsPerVisitorPerUtcDay} 次。模型忙碌時不會排隊。</p>}
    {policyPath && <form onSubmit={submitAccessCode} className="mt-5 border-t border-amber-200 pt-4">
      <label htmlFor="demo-access-code" className="block text-sm font-semibold">輸入評審示範代碼</label>
      <p className="mt-1 text-xs leading-5">代碼只用來換取限時示範工作階段；不會儲存在此頁。工作階段採 HttpOnly cookie，逾時後需重新輸入。</p>
      <div className="mt-3 flex flex-wrap gap-2"><input id="demo-access-code" type="password" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} disabled={submitting} className="min-h-11 min-w-0 flex-1 rounded-lg border border-amber-300 bg-white px-3 text-sm text-zinc-900" /><button type="submit" disabled={submitting || !code} className="min-h-11 rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{submitting ? '正在驗證…' : '進入示範'}</button></div>
      {state.error && <p role="alert" className="mt-2 text-sm font-medium">{state.error}</p>}
    </form>}
    {!policyPath && <p role="alert" className="mt-4 text-sm font-semibold">資料政策未設定；為保護評審資料，目前不開放進入。</p>}
  </section>
}

function toHostedInfo(capabilities: DemoCapabilities, expiresAt: string): HostedDemoInfo {
  return {
    status: capabilities.status,
    canPlan: ['ready', 'busy'].includes(capabilities.status) && capabilities.capabilities.invoicePlan,
    canQueuePlan: capabilities.capabilities.invoicePlanQueue,
    canRun: capabilities.status !== 'stopped' && capabilities.capabilities.invoiceRun,
    queueFull: Boolean(capabilities.queue?.full),
    pollAfterMs: Math.max(1_000, capabilities.queue?.pollAfterMs ?? 5_000),
    dataPolicyUrl: safePolicyPath(capabilities.dataPolicyUrl),
    expiresAt,
    requestLimits: capabilities.requestLimits,
  }
}

function DemoSafetyNotice() {
  return <div className="mt-4 rounded-xl border border-amber-200 bg-white p-4 text-sm leading-6">
    <h2 className="font-semibold">僅限合成資料</h2>
    <p className="mt-1">請勿輸入真實客戶文件、個人資料或機密資料。服務端的訪客隔離和限制仍須由後端強制執行；畫面提示不構成安全邊界。</p>
    <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all border-t border-zinc-100 pt-3 text-xs leading-5 text-zinc-700">{`invoice_id,customer,amount,currency\nINV-001,Harbour Studio,12500,HKD\nINV-002,Maple Works,9200,HKD\nINV-003,,14250,HKD`}</pre>
    <p className="mt-1 text-xs text-zinc-600">上方只有靜態範例；尚未上傳或送出資料。</p>
  </div>
}
