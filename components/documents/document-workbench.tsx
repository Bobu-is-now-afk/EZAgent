'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, FilePlus2, FileText, LoaderCircle, Plus, Printer, ShieldCheck, Trash2, X } from 'lucide-react'
import { LocalAiSetup } from '@/components/local-ai-setup'
import {
  ApiRequestError, basisPointsFromInput, computeTotals, decimalFromMinor, documentsRequest, Draft, DraftSuggestion, DocumentType, FieldProvenance, formatMoney, lineTotal, moneyFromInput, moneyInput, Order, OrderItem, SampleDocument,
} from '@/lib/documents/ui-contract'

const TYPES: Array<{ id: DocumentType; label: string }> = [
  { id: 'quotation', label: '報價單' },
  { id: 'invoice', label: '發票／付款通知' },
  { id: 'receipt', label: '收據' },
]
const MAX_ORDER_ITEMS = 40

type OrderForm = { buyer: Order['buyer']; items: OrderItem[]; currency: string | null; agreedDate: string | null; termsText: string | null }
const blankOrder = (): OrderForm => ({
  buyer: { name: '', address: '', contact: '' }, items: [{ id: createId(), name: '', description: '', quantity: null, unitPriceMinor: null }], currency: null, agreedDate: null, termsText: null,
})

function createId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16)
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16)
  })
}

function typeName(type: DocumentType) { return TYPES.find((item) => item.id === type)?.label ?? '文件' }

function documentErrorMessage(reason: unknown, localAppMode: boolean, fallback: string) {
  if (reason instanceof ApiRequestError) {
    if (reason.code === 'documents_disabled') return localAppMode
      ? '文件工作台目前未啟用。請關閉並重新開啟 App；若仍無法載入，請聯絡提供此 App 的人。'
      : '文件工作台目前未啟用。請檢查本機開發伺服器設定後重新整理。'
    if (reason.code === 'local_only') return '請在執行此文件工作台的這部電腦上重新開啟 App，再試一次。'
    if (['unsafe_storage_lock', 'unsafe_storage_path', 'unsafe_storage_file', 'stale_storage_lock', 'stale_lock_recovery', 'store_io'].includes(reason.code ?? '')) return '本機文件資料目前無法安全讀取或儲存。請重新開啟 App 後再試；請勿自行刪除或移動資料夾。若仍發生，請聯絡支援。'
  }
  if (reason instanceof TypeError) return localAppMode
    ? '無法連接本機文件服務。請關閉並重新開啟 App，再按「重新整理」；文件資料不會因此清除。'
    : '無法連接本機文件服務。請確認開發伺服器仍在執行，再試一次。'
  return reason instanceof Error ? reason.message : fallback
}

function toDraftPatch(draft: Draft) {
  return {
    buyer: draft.buyer,
    currency: draft.currency,
    items: draft.items.map((item) => ({ id: item.id, name: item.name, description: item.description, quantity: item.quantity, unitPrice: decimalFromMinor(item.unitPriceMinor) })),
    termsText: draft.termsText,
    issueDate: draft.issueDate,
    dueDate: draft.dueDate,
    validUntil: draft.validUntil,
    paymentDate: draft.paymentDate,
    paymentAmount: decimalFromMinor(draft.paymentAmountMinor),
    paymentMethod: draft.paymentMethod,
    taxMode: draft.taxMode,
    taxRateBasisPoints: draft.taxRateBasisPoints,
  }
}

function populatedReviewPaths(draft: Draft): string[] {
  const paths: string[] = []
  for (const key of ['name', 'address', 'contact'] as const) if (draft.buyer[key]?.trim()) paths.push(`buyer.${key}`)
  if (draft.currency) paths.push('currency')
  draft.items.forEach((item, index) => {
    if (item.name?.trim()) paths.push(`items[${index}].name`)
    if (item.description?.trim()) paths.push(`items[${index}].description`)
    if (item.quantity != null) paths.push(`items[${index}].quantity`)
    if (item.unitPriceMinor != null) paths.push(`items[${index}].unitPriceMinor`)
  })
  for (const key of ['termsText', 'issueDate', 'dueDate', 'validUntil', 'paymentDate', 'paymentMethod', 'taxMode', 'taxRateBasisPoints'] as const) {
    if (draft[key] != null && draft[key] !== '') paths.push(key)
  }
  if (draft.paymentAmountMinor != null) paths.push('paymentAmountMinor')
  return paths
}

function isPopulatedPath(draft: Draft, path: string) { return populatedReviewPaths(draft).includes(path) }

function reviewFieldLabel(path: string) {
  if (path.startsWith('buyer.')) return ({ name: '買方名稱', address: '買方地址', contact: '買方聯絡方式' } as Record<string, string>)[path.slice(6)] ?? '買方資料'
  const item = /^items\[(\d+)\]\.(.+)$/.exec(path)
  if (item) {
    const itemLabels: Record<string, string> = { name: '項目名稱', description: '項目描述', quantity: '數量', unitPriceMinor: '單價' }
    return `項目 ${Number(item[1]) + 1} · ${itemLabels[item[2]] ?? '項目資料'}`
  }
  const labels: Record<string, string> = { currency: '幣別', termsText: '條款', issueDate: '開立日期', dueDate: '付款期限', validUntil: '有效期限', paymentDate: '收款日期', paymentAmountMinor: '實收金額', paymentMethod: '收款方式', taxMode: '稅務方式', taxRateBasisPoints: '稅率' }
  return labels[path] ?? path
}

function reviewFieldValue(draft: Draft, path: string): string {
  const itemMatch = /^items\[(\d+)\]\.(.+)$/.exec(path)
  if (itemMatch) {
    const item = draft.items[Number(itemMatch[1])]
    if (!item) return '—'
    const field = itemMatch[2] as keyof OrderItem
    const value = item[field]
    return field === 'unitPriceMinor' ? formatMoney(value as number | null, draft.currency) : String(value ?? '—')
  }
  if (path.startsWith('buyer.')) return String(draft.buyer[path.slice(6) as keyof Draft['buyer']] ?? '—')
  if (path === 'paymentAmountMinor') return formatMoney(draft.paymentAmountMinor, draft.currency)
  if (path === 'taxRateBasisPoints') return `${((draft.taxRateBasisPoints ?? 0) / 100).toLocaleString('zh-HK')}%`
  if (path === 'taxMode') return ({ none: '不計稅', included: '稅額內含', excluded: '另加稅額' } as Record<string, string>)[String(draft.taxMode)] ?? '未設定'
  return String(draft[path as keyof Draft] ?? '—')
}

function orderDiffRows(before: Order, after: Order) {
  const rows: Array<{ label: string; before: string; after: string }> = []
  const compare = (label: string, oldValue: unknown, newValue: unknown) => {
    const oldText = String(oldValue ?? '—'); const newText = String(newValue ?? '—')
    if (oldText !== newText) rows.push({ label, before: oldText, after: newText })
  }
  compare('買方名稱', before.buyer.name, after.buyer.name)
  compare('買方地址', before.buyer.address, after.buyer.address)
  compare('聯絡方式', before.buyer.contact, after.buyer.contact)
  compare('幣別', before.currency, after.currency)
  compare('約定日期', before.agreedDate, after.agreedDate)
  compare('條款', before.termsText, after.termsText)
  const count = Math.max(before.items.length, after.items.length)
  for (let index = 0; index < count; index++) {
    const oldItem = before.items[index]; const newItem = after.items[index]
    if (!oldItem) { rows.push({ label: `新增項目 ${index + 1}`, before: '—', after: newItem.name || newItem.description || '未命名' }); continue }
    if (!newItem) { rows.push({ label: `移除項目 ${index + 1}`, before: oldItem.name || oldItem.description || '未命名', after: '—' }); continue }
    const prefix = `項目 ${index + 1}`
    compare(`${prefix} 名稱`, oldItem.name, newItem.name)
    compare(`${prefix} 描述`, oldItem.description, newItem.description)
    compare(`${prefix} 數量`, oldItem.quantity, newItem.quantity)
    compare(`${prefix} 單價`, formatMoney(oldItem.unitPriceMinor, before.currency), formatMoney(newItem.unitPriceMinor, after.currency))
  }
  return rows
}

function sourceLabel(value: FieldProvenance | undefined) {
  if (!value) return '來源未確認'
  if (value.source === 'order') return '來自訂單'
  if (value.source === 'ai_suggestion') return value.confirmed ? '已確認 AI 建議' : 'AI 建議，待確認'
  return value.confirmed ? '你已確認' : '待你確認'
}

export function DocumentWorkbench({ localAppMode = false, hostedMode = false, policyVersion = '' }: { localAppMode?: boolean; hostedMode?: boolean; policyVersion?: string }) {
  const [orders, setOrders] = useState<Order[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [samples, setSamples] = useState<SampleDocument[]>([])
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null)
  const [activeSample, setActiveSample] = useState<SampleDocument | null>(null)
  const [sourceDiff, setSourceDiff] = useState<{ original: Order; current: Order } | null>(null)
  const [mode, setMode] = useState<'orders' | 'custom' | 'draft'>('orders')
  const [docType, setDocType] = useState<DocumentType>('quotation')
  const [customText, setCustomText] = useState('')
  const [suggestion, setSuggestion] = useState<DraftSuggestion | null>(null)
  const [customDraft, setCustomDraft] = useState<Draft | null>(null)
  const [selectedSuggestionFields, setSelectedSuggestionFields] = useState<number[]>([])
  const [suggestionApplied, setSuggestionApplied] = useState(false)
  const [orderForm, setOrderForm] = useState<OrderForm | null>(null)
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null)
  const [confirmSample, setConfirmSample] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [mobilePane, setMobilePane] = useState<'edit' | 'preview'>('edit')
  const [hostedAuthenticated, setHostedAuthenticated] = useState(!hostedMode)
  const [hostedChecking, setHostedChecking] = useState(hostedMode)
  const [inviteId, setInviteId] = useState('')
  const [accessToken, setAccessToken] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [orderData, draftData, sampleData] = await Promise.all([
        documentsRequest<{ orders: Order[] }>('/api/documents/orders'),
        documentsRequest<{ drafts: Draft[] }>('/api/documents/drafts'),
        documentsRequest<{ samples: SampleDocument[] }>('/api/documents/samples'),
      ])
      setOrders(orderData.orders)
      setDrafts(draftData.drafts)
      setSamples(sampleData.samples)
    } catch (reason) {
      setError(documentErrorMessage(reason, localAppMode, '無法載入文件工作台。'))
    } finally { setLoading(false) }
  }, [localAppMode])

  useEffect(() => {
    if (!hostedMode) return
    let active = true
    void documentsRequest('/api/documents/session').then(() => {
      if (active) setHostedAuthenticated(true)
    }).catch(() => {
      if (active) setHostedAuthenticated(false)
    }).finally(() => {
      if (active) setHostedChecking(false)
    })
    return () => { active = false }
  }, [hostedMode])

  useEffect(() => { if (hostedAuthenticated) void refresh() }, [refresh, hostedAuthenticated])

  async function signInHosted(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await documentsRequest('/api/documents/session', { method: 'POST', body: JSON.stringify({ inviteId, accessToken, policyVersion, policyAccepted: true }) })
      setAccessToken('')
      setHostedAuthenticated(true)
    } catch (reason) {
      setAccessToken('')
      setError(reason instanceof ApiRequestError && reason.code === 'hosted_session_required' ? '邀請資料無效，或目前無法建立示範工作區。' : documentErrorMessage(reason, false, '目前無法登入示範工作區。'))
    } finally { setBusy(false) }
  }

  async function signOutHosted() {
    setBusy(true)
    try { await documentsRequest('/api/documents/session', { method: 'DELETE' }) }
    catch { /* Local UI still locks even if the network response is lost. */ }
    finally {
      setOrders([]); setDrafts([]); setSamples([]); setActiveDraft(null); setActiveSample(null)
      setHostedAuthenticated(false); setBusy(false)
    }
  }

  const totals = useMemo(() => activeDraft ? computeTotals(activeDraft) : null, [activeDraft])
  const [draftDirty, setDraftDirty] = useState(false)
  const [reviewCheckedPaths, setReviewCheckedPaths] = useState<string[]>([])
  const [previewChecked, setPreviewChecked] = useState(false)
  const completeForReview = useMemo(() => {
    if (!activeDraft || !activeDraft.buyer.name?.trim() || !activeDraft.currency || !activeDraft.issueDate || activeDraft.items.length === 0) return false
    if (activeDraft.items.some((item) => !(item.name || item.description)?.trim() || item.quantity == null || item.quantity <= 0 || !Number.isSafeInteger(item.quantity) || item.unitPriceMinor == null || item.unitPriceMinor < 0)) return false
    if (activeDraft.taxMode == null || totals?.totalMinor == null || draftDirty) return false
    if (activeDraft.type === 'receipt' && (activeDraft.paymentAmountMinor == null || activeDraft.paymentAmountMinor <= 0 || !activeDraft.paymentDate)) return false
    if (populatedReviewPaths(activeDraft).some((path) => !activeDraft.provenance[path]?.confirmed)) return false
    return true
  }, [activeDraft, totals, draftDirty])

  async function createDraft(sourceOrder: Order | null, typeOverride = docType) {
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await documentsRequest<{ draft: Draft }>('/api/documents/drafts', {
        method: 'POST', body: JSON.stringify({ type: typeOverride, sourceOrder: sourceOrder ? { id: sourceOrder.id, revision: sourceOrder.revision } : null }),
      })
      setActiveSample(null); setActiveDraft(result.draft); setDraftDirty(false); setReviewCheckedPaths([]); setPreviewChecked(false); setMode('draft'); setMobilePane('edit'); setMessage('草稿已建立。補齊資料並儲存後，即可預覽與覆核。'); await refresh()
    } catch (reason) { setError(documentErrorMessage(reason, localAppMode, '無法建立草稿。')) }
    finally { setBusy(false) }
  }

  async function saveOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!orderForm) return
    setBusy(true); setError(''); setMessage('')
    try {
      const route = editingOrderId ? `/api/documents/orders/${encodeURIComponent(editingOrderId)}` : '/api/documents/orders'
      const payload = { buyer: orderForm.buyer, currency: orderForm.currency, items: orderForm.items.map((item) => ({ name: item.name, description: item.description, quantity: item.quantity, unitPrice: decimalFromMinor(item.unitPriceMinor) })), agreedDate: orderForm.agreedDate, termsText: orderForm.termsText, sourceReferenceId: null, sourceReferenceVersion: null }
      const result = await documentsRequest<{ order: Order }>(route, { method: editingOrderId ? 'PUT' : 'POST', body: JSON.stringify({ ...payload, ...(editingOrderId ? { expectedRevision: orders.find((item) => item.id === editingOrderId)?.revision } : {}) }) })
      const saved = result.order
      setOrders((current) => editingOrderId ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current])
      setOrderForm(null); setEditingOrderId(null); setMessage(editingOrderId ? '訂單新版本已儲存。既有草稿仍保留原訂單版本。' : '合成訂單已儲存。')
    } catch (reason) { setError(documentErrorMessage(reason, localAppMode, '無法儲存訂單。')) }
    finally { setBusy(false) }
  }

  async function askSuggestion() {
    if (!customText.trim()) return
    setBusy(true); setError(''); setMessage('')
    try {
      let target = customDraft
      if (!target) {
        const created = await documentsRequest<{ draft: Draft }>('/api/documents/drafts', { method: 'POST', body: JSON.stringify({ type: docType, sourceOrder: null }) })
        target = created.draft; setCustomDraft(target)
      }
      const response = await documentsRequest<{ suggestion: DraftSuggestion }>('/api/documents/suggestions', { method: 'POST', body: JSON.stringify({ draftId: target.id, expectedRevision: target.revision, description: customText }) })
      setSuggestion(response.suggestion); setSelectedSuggestionFields([]); setSuggestionApplied(false); setMessage('建議只包含文字欄位；數量、金額、買方及付款資料仍須你提供。')
    } catch (reason) { setError(documentErrorMessage(reason, localAppMode, '目前無法取得文字建議。')) }
    finally { setBusy(false) }
  }

  async function applySuggestion() {
    if (!suggestion || !customDraft || selectedSuggestionFields.length === 0) return
    setBusy(true); setError('')
    try {
      const response = await documentsRequest<{ draft: Draft }>(`/api/documents/drafts/${encodeURIComponent(customDraft.id)}/apply-suggestion`, { method: 'POST', body: JSON.stringify({ expectedRevision: customDraft.revision, suggestionId: suggestion.id, fieldIndexes: selectedSuggestionFields }) })
      setActiveSample(null); setActiveDraft(response.draft); setCustomDraft(response.draft); setDraftDirty(false); setReviewCheckedPaths([]); setPreviewChecked(false); setSuggestionApplied(true); setMode('draft'); setMobilePane('edit'); setMessage('已套用選取的文字建議。財務欄位維持空白。'); await refresh()
    } catch (reason) { setError(documentErrorMessage(reason, localAppMode, '無法套用文字建議。')) }
    finally { setBusy(false) }
  }

  function updateDraft<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraftDirty(true)
    setReviewCheckedPaths([]); setPreviewChecked(false)
    setActiveDraft((current) => {
      if (!current) return current
      const next = { ...current, [key]: value, status: 'draft' as const, reviewedRevision: null, reviewDigest: null }
      next.provenance = { ...current.provenance }
      if (key === 'buyer') {
        const buyer = value as Draft['buyer']
        for (const field of ['name', 'address', 'contact'] as const) {
          if (buyer[field] !== current.buyer[field]) next.provenance[`buyer.${field}`] = { source: 'user', confirmed: true }
        }
      } else if (key === 'items') {
        for (const path of Object.keys(next.provenance)) if (/^items\[\d+\]\./.test(path)) delete next.provenance[path]
        const nextItems = value as Draft['items']
        nextItems.forEach((item, index) => {
          const previousIndex = current.items.findIndex((previous) => previous.id === item.id)
          for (const field of ['name', 'description', 'quantity', 'unitPriceMinor']) {
            const newPath = `items[${index}].${field}`
            const oldPath = previousIndex >= 0 ? `items[${previousIndex}].${field}` : ''
            next.provenance[newPath] = current.provenance[oldPath] ?? { source: 'user', confirmed: false }
          }
        })
      } else next.provenance[String(key)] = { source: 'user', confirmed: true }
      return next
    })
  }

  function updateItem(index: number, patch: Partial<Draft['items'][number]>) {
    if (!activeDraft) return
    setDraftDirty(true)
    setReviewCheckedPaths([]); setPreviewChecked(false)
    const updated = activeDraft.items.map((item, current) => current === index ? { ...item, ...patch } : item)
    const next = { ...activeDraft, items: updated, status: 'draft' as const, reviewedRevision: null, reviewDigest: null, provenance: { ...activeDraft.provenance } }
    for (const key of Object.keys(patch)) next.provenance[`items[${index}].${key}`] = { source: 'user', confirmed: true }
    setActiveDraft(next)
  }

  async function saveDraft() {
    if (!activeDraft) return
    setBusy(true); setError(''); setMessage('')
    const { id, revision } = activeDraft
    try {
      const saved = await documentsRequest<{ draft: Draft; totals: Draft['totals'] }>(`/api/documents/drafts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: revision, ...toDraftPatch(activeDraft) }) })
      const draft = { ...saved.draft, totals: saved.totals }
      setActiveDraft(draft); setDraftDirty(false); setReviewCheckedPaths([]); setPreviewChecked(false); setDrafts((rows) => [draft, ...rows.filter((row) => row.id !== draft.id)]); setMessage(`草稿第 ${draft.revision} 版已儲存；請重新檢查這個版本。`)
    } catch (reason) { setError(documentErrorMessage(reason, localAppMode, '無法儲存草稿。')) }
    finally { setBusy(false) }
  }

  async function reviewDraft() {
    const requiredPaths = activeDraft ? populatedReviewPaths(activeDraft) : []
    if (!activeDraft || !completeForReview || draftDirty || !previewChecked || requiredPaths.some((path) => !reviewCheckedPaths.includes(path))) return
    setBusy(true); setError(''); setMessage('')
    try {
      const confirmedPaths = reviewCheckedPaths.filter((path) => isPopulatedPath(activeDraft, path))
      const result = await documentsRequest<{ draft: Draft; totals: Draft['totals']; review: { revision: number; digest: string } }>(`/api/documents/drafts/${encodeURIComponent(activeDraft.id)}/review`, { method: 'POST', body: JSON.stringify({ expectedRevision: activeDraft.revision, confirmedPaths }) })
      const reviewed = { ...result.draft, totals: result.totals, reviewDigest: result.review.digest }
      setActiveDraft(reviewed); setDrafts((rows) => rows.map((row) => row.id === reviewed.id ? reviewed : row)); setDraftDirty(false); setMessage('此版本已覆核。任何修改都會要求重新覆核。')
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.code === 'source_order_changed') {
        setError('來源訂單已有新版本。草稿保留原資料；請查看差異並從最新版建立新草稿。')
        await openDraft(activeDraft)
        setError('來源訂單已有新版本。草稿保留原資料；請查看差異並從最新版建立新草稿。')
      } else setError(documentErrorMessage(reason, localAppMode, '無法覆核這個版本。'))
    }
    finally { setBusy(false) }
  }

  async function createSample() {
    if (!activeDraft || activeDraft.status !== 'reviewed' || !activeDraft.reviewDigest || draftDirty) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await documentsRequest<{ sample: SampleDocument; created: boolean }>(`/api/documents/drafts/${encodeURIComponent(activeDraft.id)}/create-sample`, {
        method: 'POST', headers: { 'idempotency-key': createId() },
        body: JSON.stringify({ revision: activeDraft.revision, reviewDigest: activeDraft.reviewDigest, confirm: 'CREATE SAMPLE' }),
      })
      const sampleDraft = { ...result.sample.snapshot, status: 'sample_created' as const, sampleNumber: result.sample.sampleNumber, totals: result.sample.totals }
      setSamples((rows) => [result.sample, ...rows.filter((row) => row.id !== result.sample.id)]); setActiveSample(result.sample); setActiveDraft(sampleDraft); setDraftDirty(false); setConfirmSample(false); setMessage('合成範例文件已建立，可列印或另存為 PDF。'); await refresh()
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.code === 'source_order_changed') {
        setError('來源訂單已有新版本。這份草稿仍保留原資料，無法建立範例；請查看差異並從最新版建立新草稿。')
        await openDraft(activeDraft)
        setError('來源訂單已有新版本。這份草稿仍保留原資料，無法建立範例；請查看差異並從最新版建立新草稿。')
      } else setError(documentErrorMessage(reason, localAppMode, '無法建立範例文件。'))
    }
    finally { setBusy(false) }
  }

  async function deleteDraft(draft: Draft) {
    if (!window.confirm(`刪除「${typeName(draft.type)}」草稿？此動作無法復原。`)) return
    setBusy(true); setError(''); setMessage('')
    try {
      await documentsRequest(`/api/documents/drafts/${encodeURIComponent(draft.id)}`, { method: 'DELETE', body: JSON.stringify({ confirm: true, expectedRevision: draft.revision }) })
      setDrafts((rows) => rows.filter((row) => row.id !== draft.id)); if (activeDraft?.id === draft.id) { setActiveDraft(null); setActiveSample(null); setMode('orders') }; setMessage('草稿已刪除。')
    } catch (reason) { setError(documentErrorMessage(reason, localAppMode, '無法刪除草稿。')) }
    finally { setBusy(false) }
  }

  async function clearDemoData() {
    if (!window.confirm('清除所有合成訂單、草稿與範例文件？範例編號序列會保留，不會重用舊編號。')) return
    setBusy(true); setError(''); setMessage('')
    try {
      await documentsRequest('/api/documents/clear-data', { method: 'DELETE', body: JSON.stringify({ confirm: true }) })
      setOrders([]); setDrafts([]); setSamples([]); setActiveDraft(null); setActiveSample(null); setDraftDirty(false); setMode('orders'); setMessage('合成工作台資料已清除；範例編號序列已保留，舊匯出檔不會刪除。')
    } catch (reason) { setError(documentErrorMessage(reason, localAppMode, '無法清除合成資料。')) }
    finally { setBusy(false) }
  }

  async function openDraft(draft: Draft) {
    setBusy(true); setError('')
    try {
      const current = await documentsRequest<{ draft: Draft; totals: Draft['totals']; sourceOrderCurrentRevision: number | null }>(`/api/documents/drafts/${encodeURIComponent(draft.id)}`)
      setActiveDraft({ ...current.draft, totals: current.totals, sourceOrderCurrentRevision: current.sourceOrderCurrentRevision }); setActiveSample(null); setDraftDirty(false); setReviewCheckedPaths([]); setPreviewChecked(false); setMode('draft'); setMobilePane('edit'); setSourceDiff(null)
      if (current.draft.sourceOrder && (current.sourceOrderCurrentRevision ?? current.draft.sourceOrder.revision) > current.draft.sourceOrder.revision) {
        const base = encodeURIComponent(current.draft.sourceOrder.id)
        const [oldResult, latestResult] = await Promise.all([
          documentsRequest<{ order: Order }>(`/api/documents/orders/${base}?revision=${current.draft.sourceOrder.revision}`),
          documentsRequest<{ order: Order }>(`/api/documents/orders/${base}`),
        ])
        setSourceDiff({ original: oldResult.order, current: latestResult.order })
      }
    }
    catch (reason) { setError(documentErrorMessage(reason, localAppMode, '無法開啟草稿。')) }
    finally { setBusy(false) }
  }

  if (hostedMode && hostedChecking) return <main className="documents-shell min-h-screen"><section className="api-off-state"><div className="empty-stamp">示範</div><h1>正在確認工作階段</h1><p>文件資料尚未載入。</p></section></main>

  if (hostedMode && !hostedAuthenticated) return <main className="documents-shell min-h-screen">
    <header className="documents-topbar"><Link className="brand-link" href="/" aria-label="回到 EZAgent 首頁"><span className="brand-mark">E</span><span>EZAgent</span></Link><div className="topbar-center">受控文件示範</div><div className="topbar-actions"><Link href="/data-policy" className="quiet-button">資料政策</Link><Link href="/" className="quiet-button top-home"><ArrowLeft size={15} aria-hidden="true" />首頁</Link></div></header>
    <section className="api-off-state hosted-login-card"><div className="empty-stamp">合成資料</div><h1>登入示範工作區</h1><p>請使用主辦方提供的邀請 ID 與存取碼。存取碼只用於建立受控工作階段，不會寫入文件資料。</p>
      <p className="muted-copy">只輸入合成測試資料；禁止輸入真實客戶、員工、財務或機密資料。AI 文字建議只會送到此主機的 Ollama loopback 服務。登出或工作階段到期不會刪除已儲存資料。</p>
      <form onSubmit={(event) => void signInHosted(event)} className="hosted-login-form">
        <label className="field"><span>邀請 ID</span><input autoComplete="off" required maxLength={64} value={inviteId} onChange={(event) => setInviteId(event.target.value)} /></label>
        <label className="field"><span>存取碼</span><input type="password" autoComplete="off" required minLength={32} maxLength={256} value={accessToken} onChange={(event) => setAccessToken(event.target.value)} /></label>
        <label className="preview-confirm"><input type="checkbox" required /><span>我已閱讀並同意 <Link href="/data-policy">合成資料政策</Link>，只會使用合成資料。</span></label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy || !policyVersion}>{busy ? '登入中…' : '登入示範工作區'}</button>
        {!policyVersion && <p role="alert" className="form-error">資料政策設定無效，登入功能已停用。</p>}
      </form>
    </section>
  </main>

  return <main className="documents-shell min-h-screen">
    <header className="documents-topbar">
      <Link className="brand-link" href="/" aria-label="回到 EZAgent 首頁"><span className="brand-mark">E</span><span>EZAgent</span></Link>
      <div className="topbar-center"><span className="status-dot" />{hostedMode ? '受控示範工作階段' : '本機文件工作台'} <span className="topbar-divider">/</span> 合成資料</div>
      <div className="topbar-actions"><button type="button" className="quiet-button" onClick={() => void refresh()} disabled={busy || loading}>重新整理</button>{hostedMode && <button type="button" className="quiet-button" onClick={() => void signOutHosted()} disabled={busy}>登出</button>}<Link href={hostedMode ? '/data-policy' : '/'} className="quiet-button top-home">{hostedMode ? '資料政策' : <><ArrowLeft size={15} aria-hidden="true" /> 首頁</>}</Link></div>
    </header>

    <div className="workbench-frame">
      <aside className="workbench-rail" aria-label="工作台導覽">
        <div className="rail-heading"><div><p className="eyebrow">文件</p><h1>工作台</h1></div><button type="button" className="icon-button" aria-label="建立新草稿" onClick={() => { setMode('orders'); setActiveDraft(null) }}><FilePlus2 size={17} /></button></div>
        <div className="rail-section"><div className="rail-section-title"><span>工作區</span><span>{orders.length + drafts.length}</span></div>
          <button type="button" className={`rail-link ${mode === 'orders' ? 'selected' : ''}`} onClick={() => { setMode('orders'); setActiveDraft(null) }}><FileText size={16} />訂單與草稿</button>
          {drafts.map((draft) => <button type="button" key={draft.id} className={`rail-draft ${activeDraft?.id === draft.id ? 'selected' : ''}`} onClick={() => void openDraft(draft)}><span className="draft-mini-icon">{draft.type === 'quotation' ? 'Q' : draft.type === 'invoice' ? 'I' : 'R'}</span><span className="rail-draft-copy"><strong>{draft.buyer.name || '未命名買方'}</strong><small>{typeName(draft.type)} · 第 {draft.revision} 版</small></span><ChevronRight size={14} /></button>)}
          {!drafts.length && <p className="rail-empty">尚未建立草稿</p>}
        </div>
        <div className="rail-section sample-section"><div className="rail-section-title"><span>範例文件</span><span>{samples.length}</span></div>
          {samples.map((sample) => <button type="button" className="sample-row" key={sample.id} onClick={() => { setActiveSample(sample); setActiveDraft({ ...sample.snapshot, status: 'sample_created', sampleNumber: sample.sampleNumber, totals: sample.totals }); setSourceDiff(null); setDraftDirty(false); setMode('draft'); setMessage(`範例 ${sample.sampleNumber} 為唯讀快照。列印前請確認 SAMPLE 標記。`) }}><span className="sample-mark">S</span><span><strong>{sample.sampleNumber}</strong><small>{typeName(sample.type)}</small></span></button>)}
          {!samples.length && <p className="rail-empty">建立範例後會顯示在這裡</p>}
        </div>
        <div className="rail-bottom"><div className="data-note"><ShieldCheck size={15} /><span>{localAppMode ? '封裝版資料保存在此使用者的 App Support，直到你清除合成資料。移除 App 不會刪除此資料；重新安裝後可能仍會保留。清除會移除訂單、草稿及範例，不刪除已匯出的檔案，編號序列會保留。' : '開發版資料保存在專案的 .ezagent/documents/，直到你清除合成資料。清除會移除訂單、草稿及範例，不刪除已匯出的檔案，編號序列會保留。'}</span></div>{localAppMode && <details className="mt-2 text-xs text-zinc-500"><summary className="cursor-pointer">查看封裝版資料位置與恢復方式</summary><p className="mt-1 break-all">~/Library/Application Support/CantoNet/EZAgent/Runtime/.ezagent/documents/</p><p className="mt-1">App 關閉後再開啟可重新載入資料。若資料無法讀取，請勿自行刪除資料夾，聯絡支援協助。</p></details>}<button type="button" className="clear-link" onClick={() => void clearDemoData()} disabled={busy}>清除合成資料</button></div>
      </aside>

      <section className="workbench-main" aria-label="文件工作區">
        {(error || message) && <div className={`notice ${error ? 'notice-error' : 'notice-success'}`} role={error ? 'alert' : 'status'}><span>{error || message}</span>{error && <button type="button" aria-label="關閉錯誤訊息" onClick={() => setError('')}><X size={16} /></button>}</div>}
        {loading && <div className="loading-state"><LoaderCircle className="spin" size={18} />載入訂單與草稿…</div>}
        {!loading && error && !orders.length && !drafts.length && <div className="api-off-state"><div className="empty-stamp">本機</div><h2>文件工作台尚未就緒</h2><p>{error}</p><p className="muted-copy">資料只會寫入本機文件儲存區，不會改存到瀏覽器。你可以重新整理重試；若在封裝版持續失敗，請聯絡支援。</p><button className="primary-button" onClick={() => void refresh()}>重新整理</button></div>}

        {!loading && mode === 'orders' && <OrdersHome orders={orders} drafts={drafts} samples={samples} docType={docType} setDocType={setDocType} orderForm={orderForm} setOrderForm={setOrderForm} editingOrderId={editingOrderId} setEditingOrderId={setEditingOrderId} saveOrder={saveOrder} createDraft={createDraft} busy={busy} setMessage={setMessage} setError={setError} setActiveDraft={setActiveDraft} setMode={setMode} />}
        {!loading && mode === 'custom' && <CustomHome docType={docType} setDocType={setDocType} text={customText} setText={setCustomText} suggestion={suggestion} selectedFields={selectedSuggestionFields} setSelectedFields={setSelectedSuggestionFields} askSuggestion={askSuggestion} applySuggestion={applySuggestion} busy={busy} applied={suggestionApplied} onBack={() => setMode('orders')} />}
        {!loading && mode === 'draft' && activeDraft && <DraftEditor draft={activeDraft} sample={activeSample} updateDraft={updateDraft} updateItem={updateItem} total={totals?.totalMinor ?? activeSample?.totals.totalMinor ?? null} totals={totals ?? activeSample?.totals ?? activeDraft.totals} completeForReview={completeForReview} draftDirty={draftDirty} reviewCheckedPaths={reviewCheckedPaths} setReviewCheckedPaths={setReviewCheckedPaths} previewChecked={previewChecked} setPreviewChecked={setPreviewChecked} saveDraft={saveDraft} reviewDraft={reviewDraft} createSample={() => setConfirmSample(true)} deleteDraft={deleteDraft} busy={busy} mobilePane={mobilePane} setMobilePane={setMobilePane} onBack={() => { setMode('orders'); setActiveSample(null) }} onError={setError} sourceDiff={sourceDiff} onCreateFromLatest={(order) => void createDraft(order, activeDraft.type)} />}
      </section>
    </div>

    {confirmSample && activeDraft && <div className="modal-backdrop" role="presentation"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="sample-dialog-title"><div className="dialog-stamp">SAMPLE</div><h2 id="sample-dialog-title">建立合成範例文件？</h2><p>將依第 {activeDraft.revision} 版已覆核內容建立不可變更的合成快照。文件會標示「SAMPLE / NOT FOR PAYMENT」，不會寄出或發起付款。</p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setConfirmSample(false)} disabled={busy}>返回檢查</button><button type="button" className="primary-button" onClick={() => void createSample()} disabled={busy}>{busy ? '建立中…' : '確認建立範例文件'}</button></div></section></div>}
  </main>
}

type OrdersHomeProps = {
  orders: Order[]; drafts: Draft[]; samples: SampleDocument[]; docType: DocumentType; setDocType: (type: DocumentType) => void;
  orderForm: OrderForm | null; setOrderForm: (value: OrderForm | null) => void;
  editingOrderId: string | null; setEditingOrderId: (value: string | null) => void;
  saveOrder: (event: React.FormEvent<HTMLFormElement>) => Promise<void>; createDraft: (order: Order | null) => Promise<void>; busy: boolean;
  setMessage: (value: string) => void; setError: (value: string) => void; setActiveDraft: (value: Draft | null) => void; setMode: (value: 'orders' | 'custom' | 'draft') => void;
}

function OrdersHome(props: OrdersHomeProps) {
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null)
  const [priceText, setPriceText] = useState<Record<string, string>>({})
  const selected = props.orders.find((item) => item.id === selectedOrder) ?? null
  function patchOrderItem(index: number, patch: Partial<OrderItem>) {
    if (!props.orderForm) return
    props.setOrderForm({ ...props.orderForm, items: props.orderForm.items.map((item, idx) => idx === index ? { ...item, ...patch } : item) })
  }
  return <div className="home-view">
    <div className="page-heading"><div><p className="eyebrow">建立客戶文件</p><h2>從一筆工作開始</h2><p>選擇合成訂單，或描述自訂工作。未知的資料會保持空白，直到你補上。</p></div><span className="synthetic-pill"><span />僅限合成資料</span></div>
    <div className="path-switcher"><button type="button" className="path-choice active" onClick={() => props.setMode('orders')}><span className="path-glyph">01</span><span><strong>從訂單建立</strong><small>使用已確認的買方與項目資料，不需要 AI 模型</small></span><ChevronRight size={17} /></button><button type="button" className="path-choice" onClick={() => props.setMode('custom')}><span className="path-glyph custom-glyph">✳</span><span><strong>描述自訂工作</strong><small>準備本機 AI 後取得文字建議</small></span><ChevronRight size={17} /></button></div>
    <div className="section-heading"><div><h3>合成訂單</h3><p>手動輸入的示範資料；修改後會建立新版本。</p></div><button type="button" className="outline-button" onClick={() => { props.setEditingOrderId(null); props.setOrderForm(blankOrder()) }}><Plus size={15} />新增訂單</button></div>

    {props.orderForm && <form className="order-form" onSubmit={(event) => void props.saveOrder(event)}>
      <div className="form-title"><strong>{props.editingOrderId ? '編輯訂單' : '新增合成訂單'}</strong><button type="button" className="icon-button" aria-label="關閉訂單表單" onClick={() => { props.setOrderForm(null); props.setEditingOrderId(null) }}><X size={16} /></button></div>
      <div className="field-grid"><label className="field wide"><span>買方名稱</span><input required value={props.orderForm.buyer.name ?? ''} onChange={(event) => props.setOrderForm({ ...props.orderForm!, buyer: { ...props.orderForm!.buyer, name: event.target.value } })} /></label><label className="field wide"><span>買方地址 <small>選填</small></span><input value={props.orderForm.buyer.address ?? ''} onChange={(event) => props.setOrderForm({ ...props.orderForm!, buyer: { ...props.orderForm!.buyer, address: event.target.value } })} /></label><label className="field"><span>聯絡方式 <small>選填</small></span><input value={props.orderForm.buyer.contact ?? ''} onChange={(event) => props.setOrderForm({ ...props.orderForm!, buyer: { ...props.orderForm!.buyer, contact: event.target.value } })} /></label><label className="field"><span>幣別 <small>HKD 或 TWD</small></span><select required value={props.orderForm.currency ?? ''} onChange={(event) => { const currency = event.target.value || null; if (currency !== props.orderForm?.currency && props.orderForm?.items.some((item) => item.unitPriceMinor != null)) { if (!window.confirm('變更幣別會清除所有已輸入單價。確認後需重新輸入金額。')) return; props.setOrderForm({ ...props.orderForm!, currency, items: props.orderForm!.items.map((item) => ({ ...item, unitPriceMinor: null })) }); setPriceText({}); return }; props.setOrderForm({ ...props.orderForm!, currency }) }}><option value="">選擇幣別</option><option value="HKD">HKD</option><option value="TWD">TWD</option></select></label><label className="field"><span>約定日期 <small>選填</small></span><input type="date" value={props.orderForm.agreedDate ?? ''} onChange={(event) => props.setOrderForm({ ...props.orderForm!, agreedDate: event.target.value || null })} /></label></div>
      <div className="line-form-heading"><span>工作項目 <small>最多 {MAX_ORDER_ITEMS} 項</small></span><button type="button" className="text-button" disabled={props.orderForm.items.length >= MAX_ORDER_ITEMS} onClick={() => props.setOrderForm({ ...props.orderForm!, items: [...props.orderForm!.items, { id: createId(), name: '', description: '', quantity: null, unitPriceMinor: null }] })}><Plus size={14} />新增項目</button></div>
      {props.orderForm.items.map((item, index) => <div className="order-line-form" key={item.id}><label className="field line-description"><span>項目名稱／描述</span><input required value={item.name || item.description || ''} onChange={(event) => patchOrderItem(index, { name: event.target.value, description: event.target.value })} /></label><label className="field"><span>數量</span><input type="number" min="1" max="1000000" step="1" value={item.quantity ?? ''} onChange={(event) => patchOrderItem(index, { quantity: event.target.value ? Number(event.target.value) : null })} /></label><label className="field"><span>單價</span><input inputMode="decimal" placeholder="留白代表未知" value={priceText[item.id] ?? moneyInput(item.unitPriceMinor)} onChange={(event) => setPriceText((values) => ({ ...values, [item.id]: event.target.value }))} onBlur={() => { try { const minor = moneyFromInput(priceText[item.id] ?? moneyInput(item.unitPriceMinor), props.orderForm?.currency); patchOrderItem(index, { unitPriceMinor: minor }); setPriceText((values) => ({ ...values, [item.id]: moneyInput(minor) })) } catch (reason) { props.setError(reason instanceof Error ? reason.message : '金額格式不正確。') } }} /></label>{(props.orderForm?.items.length ?? 0) > 1 && <button className="icon-button remove-line" type="button" aria-label={`移除項目 ${index + 1}`} onClick={() => props.setOrderForm({ ...props.orderForm!, items: props.orderForm!.items.filter((_, idx) => idx !== index) })}><Trash2 size={15} /></button>}</div>)}
      <label className="field"><span>約定條款 <small>選填</small></span><textarea rows={2} value={props.orderForm.termsText ?? ''} onChange={(event) => props.setOrderForm({ ...props.orderForm!, termsText: event.target.value })} /></label>
      <div className="form-actions"><button type="button" className="secondary-button" onClick={() => { props.setOrderForm(null); props.setEditingOrderId(null) }}>取消</button><button type="submit" className="primary-button" disabled={props.busy}>{props.busy ? '儲存中…' : '儲存訂單'}</button></div>
    </form>}

    <div className="order-layout"><div className="order-list" aria-label="訂單清單">
      {props.orders.map((order) => <button type="button" key={order.id} onClick={() => setSelectedOrder(order.id)} className={`order-row ${selectedOrder === order.id ? 'selected' : ''}`}><span className="order-avatar">{order.buyer.name?.slice(0, 1) || '訂'}</span><span className="order-copy"><strong>{order.buyer.name || '未命名買方'}</strong><small>{order.items.length} 項工作 · 訂單 v{order.revision}</small></span><span className="order-amount">{formatMoney(order.items.reduce<number | null>((sum, item) => sum == null || lineTotal(item) == null ? null : sum + lineTotal(item)!, 0), order.currency)}</span></button>)}
      {!props.orders.length && !props.orderForm && <div className="empty-orders"><span className="empty-order-icon"><FileText size={20} /></span><strong>還沒有訂單</strong><p>建立一筆合成訂單，開始製作報價單、發票或收據。</p><button type="button" className="outline-button" onClick={() => props.setOrderForm(blankOrder())}><Plus size={15} />建立第一筆訂單</button></div>}
    </div>
    <div className="order-detail">{selected ? <><div className="detail-top"><div><p className="eyebrow">訂單版本 {selected.revision}</p><h4>{selected.buyer.name || '未命名買方'}</h4><p>{selected.buyer.address || '尚未輸入地址'}</p></div><button className="text-button" type="button" onClick={() => { props.setEditingOrderId(selected.id); props.setOrderForm({ buyer: { ...selected.buyer }, items: selected.items.map((item) => ({ ...item })), termsText: selected.termsText, agreedDate: selected.agreedDate, currency: selected.currency }) }}>編輯訂單</button></div><div className="detail-items">{selected.items.map((item) => <div className="detail-line" key={item.id}><span>{item.name || item.description || '未命名項目'}<small>{item.quantity == null ? '數量待填' : `數量 ${item.quantity}`}</small></span><strong>{formatMoney(lineTotal(item), selected.currency)}</strong></div>)}</div><div className="create-panel"><label className="field"><span>文件類型</span><select value={props.docType} onChange={(event) => props.setDocType(event.target.value as DocumentType)}>{TYPES.map((type) => <option value={type.id} key={type.id}>{type.label}</option>)}</select></label><button type="button" className="primary-button wide-button" onClick={() => void props.createDraft(selected)} disabled={props.busy}>以此訂單建立草稿 <ChevronRight size={15} /></button><p>會保留訂單 ID 與版本。重複建立會產生獨立草稿，不會配置正式文件編號。</p></div></> : <div className="select-prompt"><div className="selection-mark">選擇</div><h4>選一筆訂單</h4><p>查看來源版本與已知欄位，再建立文件草稿。</p></div>}</div></div>
    <div className="home-footnote">資料只存在本機文件工作台。此流程不會寄出文件、發起付款或核准公司正式文件。</div>
  </div>
}

type CustomHomeProps = { docType: DocumentType; setDocType: (type: DocumentType) => void; text: string; setText: (text: string) => void; suggestion: DraftSuggestion | null; selectedFields: number[]; setSelectedFields: (fields: number[]) => void; askSuggestion: () => Promise<void>; applySuggestion: () => Promise<void>; busy: boolean; applied: boolean; onBack: () => void }

function CustomHome({ docType, setDocType, text, setText, suggestion, selectedFields, setSelectedFields, askSuggestion, applySuggestion, busy, applied, onBack }: CustomHomeProps) {
  return <div className="custom-view"><button type="button" className="back-link" onClick={onBack}><ArrowLeft size={15} />回到訂單清單</button><div className="page-heading compact-heading"><div><p className="eyebrow">自訂工作</p><h2>用幾句話描述需求</h2><p>本機 AI 只提出文字建議。買方、幣別、數量、價格、稅務及付款資料不會由 AI 補齊。</p></div><span className="synthetic-pill"><span />本機 AI 建議</span></div>
    <div className="custom-compose"><label className="field"><span>想製作哪一種文件？</span><select value={docType} onChange={(event) => setDocType(event.target.value as DocumentType)}>{TYPES.map((type) => <option value={type.id} key={type.id}>{type.label}</option>)}</select></label><label className="field"><span>工作描述</span><textarea rows={6} placeholder="例如：為兩天的工作坊製作報價單，包含場地與教材準備。" value={text} onChange={(event) => setText(event.target.value)} /><small>避免輸入真實客戶或付款資料。建議只用合成內容。</small></label><button className="primary-button" type="button" onClick={() => void askSuggestion()} disabled={busy || !text.trim()}>{busy ? '整理文字建議…' : '取得文字建議'}</button></div>
    <LocalAiSetup compact showDemoLink={false} />
    {suggestion && <section className="suggestion-panel"><div className="suggestion-title"><div><p className="eyebrow">草稿建議</p><h3>逐項選擇要套用的文字</h3></div><span className="ai-tag">AI 建議</span></div>{suggestion.fields.map((field, index) => <label className="suggestion-item selectable-suggestion" key={`${index}-${field.path}-${field.value}`}><input type="checkbox" checked={selectedFields.includes(index)} onChange={(event) => setSelectedFields(event.target.checked ? [...selectedFields, index] : selectedFields.filter((item) => item !== index))} /><span className="suggestion-copy"><strong>{field.path === 'termsText' ? '條款文字' : '項目描述'}</strong><p>{field.value}</p><blockquote>來源：「{field.sourceExcerpt}」</blockquote></span><span className="pending-tag">{selectedFields.includes(index) ? '將套用' : '尚未套用'}</span></label>)}<div className="missing-fields"><strong>仍需你提供</strong><div>{(suggestion.missingFields.length ? suggestion.missingFields : ['買方名稱', '幣別', '數量與價格']).map((field) => <span key={field}>{field}</span>)}</div><p>未選取的建議不會進入草稿。數量、金額、稅務、買方及付款資料不由 AI 補齊。</p></div><button type="button" className="primary-button" onClick={() => void applySuggestion()} disabled={busy || selectedFields.length === 0}>{busy ? '套用中…' : '確認所選文字並套用'}</button>{applied && <p className="applied-note" role="status">已套用並開啟草稿。所有金額欄位仍為空白。</p>}</section>}
  </div>
}

type DraftEditorProps = {
  draft: Draft; sample: SampleDocument | null; updateDraft: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  updateItem: (index: number, patch: Partial<Draft['items'][number]>) => void; total: number | null;
  totals: Draft['totals']; completeForReview: boolean; draftDirty: boolean; saveDraft: () => Promise<void>;
  reviewDraft: () => Promise<void>; createSample: () => void; deleteDraft: (draft: Draft) => Promise<void>;
  busy: boolean; mobilePane: 'edit' | 'preview'; setMobilePane: (pane: 'edit' | 'preview') => void;
  onBack: () => void; onError: (message: string) => void; sourceDiff: { original: Order; current: Order } | null;
  reviewCheckedPaths: string[]; setReviewCheckedPaths: (paths: string[]) => void; previewChecked: boolean; setPreviewChecked: (checked: boolean) => void;
  onCreateFromLatest: (order: Order) => void;
}

function DraftEditor(props: DraftEditorProps) {
  const { draft, updateDraft, updateItem } = props
  const [moneyText, setMoneyText] = useState<Record<string, string>>({})
  const [rateText, setRateText] = useState<string | null>(null)
  const isSample = props.sample != null || draft.status === 'sample_created'
  const readOnly = isSample
  const orderVersion = draft.sourceOrder ? `訂單 ${draft.sourceOrder.id} · v${draft.sourceOrder.revision}` : '自訂工作描述'
  const provenance = (path: string) => sourceLabel(draft.provenance[path])
  const fieldTag = (path: string) => <small className="provenance-inline">{provenance(path)}</small>
  const requiredPaths = populatedReviewPaths(draft)
  const allFieldsConfirmed = requiredPaths.length > 0 && requiredPaths.every((path) => props.reviewCheckedPaths.includes(path))
  const reviewValues = requiredPaths.map((path) => ({ path, value: reviewFieldValue(draft, path), source: draft.provenance[path] }))
  function inputProps() { return { disabled: readOnly } }
  function changeCurrency(currency: string) {
    if (currency !== draft.currency && (draft.items.some((item) => item.unitPriceMinor != null) || draft.paymentAmountMinor != null)) {
      if (!window.confirm('變更幣別會清除所有已輸入價格與實收金額。確認後需重新輸入金額。')) return
      updateDraft('items', draft.items.map((item) => ({ ...item, unitPriceMinor: null })))
      updateDraft('paymentAmountMinor', null)
      setMoneyText({})
    }
    updateDraft('currency', currency || null)
  }
  function changeTaxMode(value: string) {
    const taxMode = (value || null) as Draft['taxMode']
    updateDraft('taxMode', taxMode)
    if (taxMode === 'none') updateDraft('taxRateBasisPoints', null)
    else if (draft.taxMode === 'none') updateDraft('taxRateBasisPoints', null)
  }
  function parseMoney(value: string, update: (minor: number | null) => void) {
    try { update(moneyFromInput(value, draft.currency)) }
    catch (reason) { props.onError(reason instanceof Error ? reason.message : '金額格式不正確。') }
  }
  return <div className={`draft-view ${props.mobilePane === 'preview' ? 'mobile-preview' : ''}`}>
    <div className="draft-toolbar"><div><button type="button" className="back-link" onClick={props.onBack}><ArrowLeft size={15} />文件工作區</button><h2>{typeName(draft.type)}{isSample ? '範例' : '草稿'}</h2><p>{orderVersion} <span className="toolbar-dot" />第 {draft.revision} 版 <StatusTag status={draft.status} /></p></div><div className="draft-toolbar-actions">{isSample ? <button className="primary-button" type="button" onClick={() => window.print()}><Printer size={15} />列印／另存 PDF</button> : <><button className="secondary-button" type="button" onClick={() => void props.deleteDraft(draft)} disabled={props.busy}><Trash2 size={14} />刪除草稿</button><button className="primary-button" type="button" onClick={() => void props.saveDraft()} disabled={props.busy || !props.draftDirty}>{props.busy ? '儲存中…' : '儲存草稿'}</button></>}</div></div>
    {draft.sourceOrder && <div className="source-banner"><span className="source-icon">↳</span><span><strong>來源訂單已保留</strong><small>{draft.sourceOrder.id} · 第 {draft.sourceOrder.revision} 版；訂單後續修改不會改寫這份草稿。</small></span></div>}
    {props.sourceDiff && draft.sourceOrder && props.sourceDiff.current.revision > draft.sourceOrder.revision && <section className="source-diff" aria-label="來源訂單版本差異"><div className="source-diff-heading"><div><strong>來源訂單已更新</strong><p>草稿仍保留 v{draft.sourceOrder.revision}；目前訂單是 v{props.sourceDiff.current.revision}。</p></div><button className="outline-button" type="button" onClick={() => props.onCreateFromLatest(props.sourceDiff!.current)}>以最新版建立新草稿</button></div><div className="source-diff-list">{orderDiffRows(props.sourceDiff.original, props.sourceDiff.current).map((row) => <div className="source-diff-row" key={row.label}><strong>{row.label}</strong><span>v{props.sourceDiff!.original.revision}: {row.before}</span><span>v{props.sourceDiff!.current.revision}: {row.after}</span></div>)}{orderDiffRows(props.sourceDiff.original, props.sourceDiff.current).length === 0 && <p>訂單版本已變更，但這份預覽無可比較的欄位差異。</p>}</div></section>}
    <div className="mobile-pane-switch"><button type="button" className={props.mobilePane === 'edit' ? 'on' : ''} onClick={() => props.setMobilePane('edit')}>編輯欄位</button><button type="button" className={props.mobilePane === 'preview' ? 'on' : ''} onClick={() => props.setMobilePane('preview')}>文件預覽</button></div>
    <div className="draft-grid"><section className="draft-form-column" aria-label="編輯文件欄位">
      <section className="editor-section"><div className="editor-section-heading"><span className="section-index">1</span><div><h3>文件資料</h3><p>只使用 HKD 或 TWD；未知欄位留白</p></div></div><div className="field-grid">
        <label className="field"><span>幣別 <small>必填</small>{fieldTag('currency')}</span><select value={draft.currency ?? ''} {...inputProps()} onChange={(event) => changeCurrency(event.target.value)}><option value="">選擇幣別</option><option value="HKD">HKD</option><option value="TWD">TWD</option></select></label>
        <label className="field"><span>開立日期 <small>必填</small>{fieldTag('issueDate')}</span><input type="date" required value={draft.issueDate ?? ''} {...inputProps()} onChange={(event) => updateDraft('issueDate', event.target.value || null)} /></label>
        {draft.type === 'quotation' ? <label className="field"><span>有效期限 {fieldTag('validUntil')}</span><input type="date" value={draft.validUntil ?? ''} {...inputProps()} onChange={(event) => updateDraft('validUntil', event.target.value || null)} /></label> : draft.type === 'invoice' ? <label className="field"><span>付款期限 {fieldTag('dueDate')}</span><input type="date" value={draft.dueDate ?? ''} {...inputProps()} onChange={(event) => updateDraft('dueDate', event.target.value || null)} /></label> : <>
          <label className="field"><span>收款日期 <small>必填</small>{fieldTag('paymentDate')}</span><input type="date" value={draft.paymentDate ?? ''} {...inputProps()} onChange={(event) => updateDraft('paymentDate', event.target.value || null)} /></label>
          <label className="field"><span>實收金額 <small>必填</small>{fieldTag('paymentAmountMinor')}</span><input inputMode="decimal" placeholder="由你確認後輸入" value={moneyText.paymentAmount ?? moneyInput(draft.paymentAmountMinor)} {...inputProps()} onChange={(event) => setMoneyText((values) => ({ ...values, paymentAmount: event.target.value }))} onBlur={() => { const raw = moneyText.paymentAmount ?? moneyInput(draft.paymentAmountMinor); parseMoney(raw, (minor) => { updateDraft('paymentAmountMinor', minor); setMoneyText((values) => ({ ...values, paymentAmount: moneyInput(minor) })) }) }} /></label>
          <label className="field"><span>收款方式 <small>必填</small>{fieldTag('paymentMethod')}</span><input value={draft.paymentMethod ?? ''} {...inputProps()} onChange={(event) => updateDraft('paymentMethod', event.target.value || null)} /></label>
        </>}</div></section>

      <section className="editor-section"><div className="editor-section-heading"><span className="section-index">2</span><div><h3>買方</h3><p>檢查每個欄位的來源與確認狀態</p></div></div><div className="field-grid">
        <label className="field wide"><span>買方名稱 <small>必填</small>{fieldTag('buyer.name')}</span><input value={draft.buyer.name ?? ''} {...inputProps()} onChange={(event) => updateDraft('buyer', { ...draft.buyer, name: event.target.value || null })} /></label>
        <label className="field wide"><span>地址 {fieldTag('buyer.address')}</span><textarea rows={2} value={draft.buyer.address ?? ''} {...inputProps()} onChange={(event) => updateDraft('buyer', { ...draft.buyer, address: event.target.value || null })} /></label>
        <label className="field wide"><span>聯絡方式 {fieldTag('buyer.contact')}</span><input value={draft.buyer.contact ?? ''} {...inputProps()} onChange={(event) => updateDraft('buyer', { ...draft.buyer, contact: event.target.value || null })} /></label>
      </div></section>

      <section className="editor-section"><div className="editor-section-heading"><span className="section-index">3</span><div><h3>工作項目</h3><p>單價留空表示未知；數量必須是正整數</p></div></div><div className="draft-items">
        {draft.items.map((item, index) => <div className="draft-item" key={item.id}><div className="draft-item-top"><span className="item-number">{String(index + 1).padStart(2, '0')}</span><div className="item-fields"><label className="field"><span>項目名稱 {fieldTag(`items[${index}].name`)}</span><input value={item.name ?? ''} {...inputProps()} onChange={(event) => updateItem(index, { name: event.target.value || null })} /></label><label className="field"><span>描述 {fieldTag(`items[${index}].description`)}</span><textarea rows={2} value={item.description ?? ''} {...inputProps()} onChange={(event) => updateItem(index, { description: event.target.value || null })} /></label></div>{!readOnly && <button className="icon-button" type="button" aria-label={`移除項目 ${index + 1}`} onClick={() => updateDraft('items', draft.items.filter((_, idx) => idx !== index))}><Trash2 size={14} /></button>}</div>
          <div className="draft-item-fields"><label className="field"><span>數量 {fieldTag(`items[${index}].quantity`)}</span><input type="number" min="1" max="1000000" step="1" value={item.quantity ?? ''} {...inputProps()} onChange={(event) => updateItem(index, { quantity: event.target.value ? Number(event.target.value) : null })} /></label><label className="field"><span>單價 {fieldTag(`items[${index}].unitPriceMinor`)}</span><input inputMode="decimal" placeholder="未知" value={moneyText[`item-${item.id}`] ?? moneyInput(item.unitPriceMinor)} {...inputProps()} onChange={(event) => setMoneyText((values) => ({ ...values, [`item-${item.id}`]: event.target.value }))} onBlur={() => { const key = `item-${item.id}`; parseMoney(moneyText[key] ?? moneyInput(item.unitPriceMinor), (minor) => { updateItem(index, { unitPriceMinor: minor }); setMoneyText((values) => ({ ...values, [key]: moneyInput(minor) })) }) }} /></label><div className="line-total"><span>小計</span><strong>{formatMoney(lineTotal(item), draft.currency)}</strong></div></div>
        </div>)}
        {!draft.items.length && <p className="no-items">尚未加入工作項目。</p>}
        {!readOnly && <button type="button" className="text-button add-draft-item" disabled={draft.items.length >= MAX_ORDER_ITEMS} onClick={() => updateDraft('items', [...draft.items, { id: createId(), name: '', description: '', quantity: null, unitPriceMinor: null }])}><Plus size={14} />新增項目</button>}
      </div>
      <div className="field-grid tax-fields"><label className="field"><span>稅務方式 {fieldTag('taxMode')}</span><select value={draft.taxMode ?? ''} {...inputProps()} onChange={(event) => changeTaxMode(event.target.value)}><option value="">未設定</option><option value="none">不計稅</option><option value="included">稅額內含</option><option value="excluded">另加稅額</option></select></label>{draft.taxMode && draft.taxMode !== 'none' && <label className="field"><span>稅率 (%) {fieldTag('taxRateBasisPoints')}</span><input type="text" inputMode="decimal" placeholder="例如 5 或 5.25" value={rateText ?? (draft.taxRateBasisPoints == null ? '' : (draft.taxRateBasisPoints / 100).toFixed(2).replace(/\.00$/, ''))} {...inputProps()} onChange={(event) => setRateText(event.target.value)} onBlur={() => { try { const value = basisPointsFromInput(rateText ?? ''); updateDraft('taxRateBasisPoints', value); setRateText(value == null ? '' : String(value / 100)) } catch (reason) { props.onError(reason instanceof Error ? reason.message : '稅率格式不正確。') } }} /></label>}</div></section>

      <section className="editor-section last-editor-section"><div className="editor-section-heading"><span className="section-index">4</span><div><h3>條款與日期</h3><p>文件上的文字需逐項確認</p></div></div><label className="field"><span>條款 {fieldTag('termsText')}</span><textarea rows={3} value={draft.termsText ?? ''} {...inputProps()} onChange={(event) => updateDraft('termsText', event.target.value || null)} /></label></section>

      {!readOnly && <div className="review-card"><div><strong>{props.draftDirty ? '草稿有未儲存的修改' : '逐欄確認此版本'}</strong><p>{!props.completeForReview ? '補齊買方、幣別、項目數量與價格並明確設定稅務。收據還需人手確認收款日期、方式及實收金額。' : props.draftDirty ? '先儲存目前內容；儲存後的草稿才能進入覆核。' : '逐項確認已填欄位，並檢查右側紙面預覽及合計。任何修改都會清除覆核。'}</p></div>
        {reviewValues.length > 0 && <div className="field-checklist">{reviewValues.map((entry) => <label className="review-check-row" key={entry.path}><input type="checkbox" checked={props.reviewCheckedPaths.includes(entry.path)} disabled={props.busy || props.draftDirty || draft.status === 'reviewed'} onChange={(event) => props.setReviewCheckedPaths(event.target.checked ? [...props.reviewCheckedPaths, entry.path] : props.reviewCheckedPaths.filter((path) => path !== entry.path))} /><span><strong>{reviewFieldLabel(entry.path)}</strong><small>{entry.value} · {sourceLabel(entry.source)}</small></span></label>)}</div>}
        <label className="preview-confirm"><input type="checkbox" checked={props.previewChecked} disabled={props.busy || props.draftDirty || draft.status === 'reviewed'} onChange={(event) => props.setPreviewChecked(event.target.checked)} /><span>我已檢查右側文件預覽與合計</span></label>
        <button type="button" className="secondary-button" onClick={() => void props.reviewDraft()} disabled={props.busy || !props.completeForReview || props.draftDirty || !allFieldsConfirmed || !props.previewChecked || draft.status === 'reviewed'}><Check size={14} />{draft.status === 'reviewed' ? '已覆核此版本' : '覆核已儲存版本'}</button>{draft.status === 'reviewed' && <button type="button" className="sample-button" onClick={props.createSample} disabled={props.busy}>建立範例文件 <ChevronRight size={15} /></button>}</div>}
    </section>

    <aside className="preview-column" aria-label="文件紙面預覽"><div className="preview-heading"><div><p className="eyebrow">精確草稿預覽</p><h3>{typeName(draft.type)}</h3></div>{isSample && <button className="primary-button print-action" onClick={() => window.print()}><Printer size={14} />列印</button>}<div className="preview-size">A4</div></div><PaperPreview draft={draft} totals={props.totals} sample={isSample} sampleNumber={props.sample?.sampleNumber ?? draft.sampleNumber} /><div className="preview-note"><span className="preview-pin" />只有已儲存並逐欄覆核的版本可建立範例文件。</div></aside></div>
  </div>
}

function StatusTag({ status }: { status: Draft['status'] }) {
  const label = status === 'reviewed' ? '已覆核' : status === 'sample_created' ? '範例' : '草稿'
  return <span className={`status-tag status-${status}`}>{label}</span>
}

function PaperPreview({ draft, totals, sample, sampleNumber }: { draft: Draft; totals: Draft['totals']; sample: boolean; sampleNumber?: string }) {
  const currency = draft.currency
  return <article className={`paper-preview ${sample ? 'paper-sample' : ''}`} aria-label={`${typeName(draft.type)}紙面預覽`}>
    {sample && <div className="sample-watermark">SAMPLE</div>}
    <div className="paper-inner"><div className="paper-head"><div><div className="paper-brand">INK<span>VOICE</span></div><p>文件工作台</p></div><div className="paper-kind"><h4>{typeName(draft.type)}</h4><span>{sampleNumber ?? '草稿預覽'}</span></div></div>
      {sample && <div className="not-payment">SAMPLE / NOT FOR PAYMENT</div>}
      <div className="paper-rule" /><div className="paper-parties"><div><small>FROM</small><strong>發行方資料待設定</strong><span>尚未選擇賣方資料</span></div><div><small>TO</small><strong>{draft.buyer.name || '買方名稱待填'}</strong><span>{draft.buyer.address || draft.buyer.contact || '買方地址待填'}</span></div></div>
      <div className="paper-meta"><div><small>文件日期</small><span>{draft.issueDate || '待填寫'}</span></div><div><small>{draft.type === 'quotation' ? '有效期限' : draft.type === 'receipt' ? '收款日期' : '付款期限'}</small><span>{(draft.type === 'quotation' ? draft.validUntil : draft.type === 'receipt' ? draft.paymentDate : draft.dueDate) || '待填寫'}</span></div><div><small>幣別</small><span>{currency || '待填寫'}</span></div></div>
      <table className="paper-table"><thead><tr><th>項目</th><th>數量</th><th>單價</th><th>金額</th></tr></thead><tbody>{draft.items.map((item, index) => <tr key={item.id}><td><strong>{item.name || item.description || `項目 ${index + 1}`}</strong>{item.name && item.description && <small className="paper-description">{item.description}</small>}</td><td>{item.quantity ?? '—'}</td><td>{formatMoney(item.unitPriceMinor, currency)}</td><td>{formatMoney(lineTotal(item), currency)}</td></tr>)}{!draft.items.length && <tr><td colSpan={4} className="paper-empty">工作項目將顯示於此</td></tr>}</tbody></table>
      <div className="paper-totals"><div><span>小計</span><span>{formatMoney(totals?.subtotalMinor, currency)}</span></div>{draft.taxMode !== 'none' && <div><span>稅額</span><span>{formatMoney(totals?.taxMinor, currency)}</span></div>}<div className="paper-grand-total"><strong>合計</strong><strong>{formatMoney(totals?.totalMinor, currency)}</strong></div>{draft.type === 'receipt' && <div className="paper-grand-total"><strong>實收金額</strong><strong>{formatMoney(draft.paymentAmountMinor, currency)}</strong></div>}</div>
      {draft.type === 'receipt' && <div className="paper-payment"><strong>付款方式</strong><span>{draft.paymentMethod || '待填寫'}</span></div>}
      <div className="paper-notes"><small>條款</small><p>{draft.termsText || '尚未輸入條款。'}</p></div><div className="paper-footer"><span>{sample ? '合成範例，已覆核快照' : draft.status === 'reviewed' ? '已覆核草稿預覽' : '尚未覆核的草稿預覽'}</span><span>{sample ? '合成範例' : '預覽草稿'}</span></div>
    </div>
  </article>
}
