'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

type Model = { id: string; display_name: string; display_name_en: string; available: boolean; reason: string | null; blocked: boolean }
type Status = { state: string; model?: string; models?: Model[]; os?: string; percent?: number; ram_gb?: number; disk_gb?: number; host?: string }
const messages: Record<string, [string, string]> = {
  checking: ['正在檢查本機 AI…', 'Checking local AI…'],
  ready: ['本機 AI 已準備好', 'Local AI is ready'],
  install_required: ['此開發版不包含 Ollama。請先安裝 Ollama，完成後回來按「重新檢查」。', 'This development app does not include Ollama. Install Ollama separately, then return and check again.'],
  selected: ['已選擇模型。按準備按鈕啟用；若尚未安裝，會先下載。', 'Model selected. Prepare it to activate; it will download if needed.'],
  selection_required: ['模型已下載，請按準備按鈕啟用。', 'The model is downloaded. Prepare it below to activate it.'],
  engine_stopped: ['本機 AI 尚未啟動，按下方按鈕即可準備。', 'The local AI engine is stopped. Prepare it below.'],
  model_missing: ['需要先下載 AI 模型，完成後即可使用示範。', 'Download an AI model before running the demo.'],
  starting: ['正在啟動本機 AI…', 'Starting local AI…'],
  downloading: ['正在下載模型。所需時間視網路與電腦而定，目前尚未量測；請保持此頁開啟。', 'Downloading the model. Time depends on your connection and Mac and has not been measured; keep this page open.'],
  hardware_blocked: ['目前資源不足，請選擇可用的較小模型或清出儲存空間後重試。', 'Choose a smaller available model or free storage and retry.'],
  failed: ['準備未完成。請確認網路、Ollama 安裝狀態與可用空間，再按下方按鈕重試。', 'Setup did not finish. Check your connection, Ollama installation, and free storage, then retry below.'],
  runtime_missing: ['應用程式缺少準備元件，請聯絡安裝此 App 的人修復後重試。', 'A setup component is missing. Ask the app installer to repair it.'],
  config_error: ['本機設定無法使用。原有資料已保留，請聯絡支援協助修復。', 'Local settings need repair. Existing data is preserved; contact support.'],
  busy: ['另一個視窗正在準備 AI，請稍後重新檢查。', 'Another window is preparing AI. Check again shortly.'],
  local_only: ['請從這部電腦開啟 App，才能準備本機 AI。', 'Open the app on this computer to prepare local AI.'],
}

export function LocalAiSetup({ locale = 'zh-Hant', onReady, showDemoLink = true, compact = false }: { locale?: 'zh-Hant' | 'en'; onReady?: (ready: boolean) => void; showDemoLink?: boolean; compact?: boolean }) {
  const en = locale === 'en'
  const t = (zh: string, english: string) => en ? english : zh
  const [status, setStatus] = useState<Status>({ state: 'checking' })
  const [inventory, setInventory] = useState<Status>({ state: 'checking' })
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const readyRef = useRef(onReady)
  useEffect(() => { readyRef.current = onReady }, [onReady])

  async function request(prepare = false) {
    if (controllerRef.current) return
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setStatus({ state: prepare ? 'starting' : 'checking' })
    readyRef.current?.(false)
    try {
      const response = await fetch('/api/local-ai', { method: prepare ? 'POST' : 'GET', ...(prepare ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) } : {}), cache: 'no-store', signal: controller.signal })
      if (!response.body) throw new Error('empty')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      let last: Status | undefined
      const accept = (line: string) => {
        const event = JSON.parse(line) as Status
        last = event; setStatus(event)
        if (event.models) { setInventory(event); setModel(event.model ?? '') }
      }
      while (true) {
        const { value, done } = await reader.read()
        pending += decoder.decode(value, { stream: !done })
        const lines = pending.split('\n'); pending = lines.pop() ?? ''
        lines.filter(Boolean).forEach(accept)
        if (done) break
      }
      if (pending.trim()) accept(pending)
      if (!last || ['checking', 'starting', 'downloading'].includes(last.state)) throw new Error('incomplete')
      readyRef.current?.(last.state === 'ready')
    } catch {
      if (!controller.signal.aborted) setStatus({ state: 'failed' })
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setBusy(false) }
    }
  }
  useEffect(() => {
    void request()
    return () => { controllerRef.current?.abort(); controllerRef.current = null }
    // One read-only readiness check per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const selected = inventory.models?.find((item) => item.id === model)
  const installUrl = inventory.os === 'macos' ? 'https://ollama.com/download/mac' : inventory.os === 'windows' ? 'https://ollama.com/download/windows' : 'https://ollama.com/download'
  const controls = <>
    {inventory.os === 'macos' && status.state !== 'ready' && <section aria-labelledby="macos-first-run-title" className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sky-950">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 id="macos-first-run-title" className="text-sm font-semibold">{t('macOS 首次使用', 'First run on macOS')}</h3><p className="mt-1 text-xs leading-5">{t('此開發版支援 macOS 27.0 以上的 Apple silicon（arm64）。App 已包含 Node.js，不需要另裝 Python；Ollama 需另行安裝。', 'This development build targets Apple silicon (arm64) on macOS 27.0 or later. Node.js is bundled; Python is not required. Install Ollama separately.')}</p></div>
      </div>
      <ol aria-label={t('macOS 首次使用步驟', 'macOS first-run steps')} className="mt-3 grid gap-2 sm:grid-cols-2">
        <li className="flex gap-3 rounded-lg border border-sky-200 bg-white p-3"><span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold">1</span><div><p className="text-xs font-semibold">{t('確認 Ollama', 'Set up Ollama')}</p><p className="mt-1 text-xs leading-5 text-zinc-600">{t('若畫面提示尚未安裝，開啟官方安裝頁完成安裝，再回來重新檢查。EZAgent 不會自行安裝 Ollama。', 'If asked, open the official installer, install Ollama, then return and check again. EZAgent will not install it for you.')}</p></div></li>
        <li className="flex gap-3 rounded-lg border border-sky-200 bg-white p-3"><span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold">2</span><div><p className="text-xs font-semibold">{t('選擇並準備模型', 'Choose and prepare a model')}</p><p className="mt-1 text-xs leading-5 text-zinc-600">{t('預設 Qwen 3.5 9B 至少需要 16 GB 記憶體、8 GB 可用空間；模型檔約 6.6 GB。只有按下準備按鈕後才會啟動下載。', 'The default Qwen 3.5 9B needs at least 16 GB RAM and 8 GB free storage; the model file is about 6.6 GB. Download starts only after you press Prepare.')}</p></div></li>
        <li className="flex gap-3 rounded-lg border border-sky-200 bg-white p-3"><span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold">3</span><div><p className="text-xs font-semibold">{t('等待狀態就緒', 'Wait for Ready')}</p><p className="mt-1 text-xs leading-5 text-zinc-600">{t('下載需要網路；時間視網路與電腦而定，目前尚未量測。若準備失敗，檢查網路與空間後按「重新嘗試準備本機 AI」。', 'A network connection is needed to download. Time varies by connection and Mac and has not been measured. If setup fails, check your connection and free space, then retry.')}</p></div></li>
        <li className="flex gap-3 rounded-lg border border-sky-200 bg-white p-3"><span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold">4</span><div><p className="text-xs font-semibold">{t('開始本機示範', 'Start the local demo')}</p><p className="mt-1 text-xs leading-5 text-zinc-600">{t('看到「本機 AI 已準備好」後即可開始；對話與發票整理會透過這部 Mac 上的 Ollama 處理。只用合成資料；完全斷網使用尚未驗證。', 'Continue when you see “Local AI is ready.” Chat and invoice processing use Ollama on this Mac. Use synthetic data only; fully disconnected use has not been verified.')}</p></div></li>
      </ol>
    </section>}
    {(inventory.os !== 'macos' || status.state === 'ready') && <p className="mt-2 text-sm leading-6 text-zinc-600">{t('首次使用需連網下載模型（約數 GB）。之後對話與發票整理在本機執行；完全斷網使用尚未驗證。', 'First use downloads several GB over the internet. Chat and invoice processing then run locally; fully disconnected use has not been verified.')}</p>}
    {inventory.models && <label className="block text-sm">{t('選擇 AI 模型', 'Choose an AI model')}<select value={model} disabled={busy} onChange={(event) => { setModel(event.target.value); setStatus({ state: 'selected' }); readyRef.current?.(false) }} className="mt-2 block min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm">
      {!model && <option value="">{t('目前沒有適合的模型', 'No suitable model available')}</option>}
      {inventory.models.filter((entry) => !entry.blocked).map((entry) => <option key={entry.id} value={entry.id} disabled={!entry.available}>{en ? entry.display_name_en : entry.display_name}{!entry.available ? t(' · 資源不足或無法確認', ' · Insufficient or unknown resources') : ''}</option>)}
    </select></label>}
    <div className="mt-4 flex flex-wrap gap-3">
      {status.state === 'install_required' && <a href={installUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-zinc-950 px-4 py-3 text-sm text-white">{t('開啟官方安裝頁', 'Open official installer')}</a>}
      {status.state !== 'ready' && status.state !== 'install_required' && <button type="button" disabled={busy || !selected?.available} onClick={() => void request(true)} className="rounded-lg bg-zinc-950 px-4 py-3 text-sm text-white disabled:opacity-50">{busy ? t('準備中…', 'Preparing…') : status.state === 'failed' ? t('重新嘗試準備本機 AI', 'Retry local AI setup') : t('準備本機 AI（允許下載）', 'Prepare local AI (allow download)')}</button>}
      <button type="button" disabled={busy} onClick={() => void request()} className="rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm disabled:opacity-50">{t('重新檢查', 'Check again')}</button>
      {showDemoLink && status.state === 'ready' && <Link href="/invoice-demo" className="rounded-lg bg-zinc-950 px-4 py-3 text-sm text-white">{t('開始發票示範', 'Start invoice demo')}</Link>}
    </div>
    {inventory.os === 'linux' && status.state === 'install_required' && <p className="mt-3 text-sm">{t('Linux 尚未提供免指令的引擎安裝流程，需要安裝人員協助。', 'Linux engine installation still requires help from the app installer.')}</p>}
    <details className="mt-4 text-xs text-zinc-500"><summary className="cursor-pointer">{t('進階詳情', 'Advanced details')}</summary><p className="mt-2">{t('本機推理服務', 'Local inference service')} · Ollama</p><p className="mt-1 break-all">{status.state} · {model || '—'} · {inventory.host || '—'}</p><p>RAM: {inventory.ram_gb?.toFixed(0) ?? '—'} GB · {t('可用空間', 'Free storage')}: {inventory.disk_gb?.toFixed(0) ?? '—'} GB</p></details>
  </>
  return <section aria-label={t('準備本機 AI', 'Prepare local AI')} className={`w-full rounded-2xl border border-zinc-200 bg-zinc-50 text-left ${compact ? 'p-4' : 'p-5'}`}>
    <h2 className={compact ? 'text-sm font-semibold' : 'text-lg font-semibold'}>{t('本機 AI 狀態', 'Local AI status')}</h2>
    <p role="status" aria-live="polite" className="my-3 text-sm font-medium">{(messages[status.state] ?? messages.failed)[en ? 1 : 0]}{typeof status.percent === 'number' ? ` ${status.percent}%` : ''}</p>
    {compact ? <details><summary className="cursor-pointer text-sm font-semibold underline underline-offset-2">{status.state === 'ready' ? t('更換模型或重新檢查', 'Change model or check again') : t('查看選項：準備本機 AI 或重新檢查', 'View options: prepare local AI or check again')}</summary><div className="mt-3">{controls}</div></details> : controls}
  </section>
}
