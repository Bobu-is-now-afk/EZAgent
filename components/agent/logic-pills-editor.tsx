'use client'

import { useState } from 'react'
import type { LogicPill } from '@/lib/agent/logic-pills'

const inputClass = 'min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 disabled:opacity-60'

function TagsInput({ value, disabled, onChange, label }: { value: string[]; disabled: boolean; onChange: (value: string[]) => void; label: string }) {
  const [draft, setDraft] = useState('')
  function add() {
    const tags = draft.split(',').map((v) => v.trim()).filter(Boolean)
    if (tags.length) { onChange([...new Set([...value, ...tags])]); setDraft('') }
  }
  return <div><div className="mb-2 flex flex-wrap gap-2">{value.map((tag, index) => <span key={`${index}:${tag}`} className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1 text-xs">{tag}<button type="button" disabled={disabled} aria-label={`移除 ${tag}`} onClick={() => onChange(value.filter((_, i) => i !== index))} className="px-1 disabled:hidden">×</button></span>)}</div><div className="flex gap-2"><input aria-label={`${label} 新標籤`} disabled={disabled} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); add() } }} placeholder="新增標籤，按 Enter 或新增" className={inputClass} /><button type="button" disabled={disabled || !draft.trim()} onClick={add} className="shrink-0 text-xs underline disabled:opacity-40">新增標籤</button></div></div>
}

export function LogicPillsEditor({ pills, disabled, onChange }: { pills: LogicPill[]; disabled: boolean; onChange: (pills: LogicPill[]) => void }) {
  const [newType, setNewType] = useState<LogicPill['type']>('text')
  const update = (id: string, patch: Partial<LogicPill>) => onChange(pills.map((pill) => pill.id === id ? { ...pill, ...patch } : pill))
  return <div className="mt-4 space-y-3">
    {pills.length === 0 && <p className="rounded-xl border border-dashed p-4 text-sm text-zinc-500">尚無 Logic Pills。可新增不執行的註記。</p>}
    {pills.map((pill) => <fieldset key={pill.id} disabled={disabled} className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4">
      <div className="mb-3 flex items-center gap-2"><input aria-label={`Pill 名稱 ${pill.id}`} value={pill.label} onChange={(e) => update(pill.id, { label: e.target.value })} className={`${inputClass} font-semibold`} /><span className="text-xs text-zinc-500">{pill.type}</span><button type="button" aria-label={`刪除 ${pill.label}`} onClick={() => onChange(pills.filter(({ id }) => id !== pill.id))} className="shrink-0 rounded-lg px-2 py-2 text-xs hover:bg-red-50 hover:text-red-700 disabled:opacity-40">刪除</button></div>
      {pill.type === 'tags' ? <TagsInput label={pill.label} value={Array.isArray(pill.value) ? pill.value : []} disabled={disabled} onChange={(value) => update(pill.id, { value })} /> : pill.type === 'select' ? <><select aria-label={pill.label} value={String(pill.value)} onChange={(e) => update(pill.id, { value: e.target.value })} className={inputClass}>{(pill.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select>{pill.id.startsWith('custom:') && <input aria-label={`${pill.label} 選項`} value={(pill.options ?? []).join(',')} onChange={(e) => { const options = [...new Set(e.target.value.split(',').map((v) => v.trim()))]; update(pill.id, { options, value: options.includes(String(pill.value)) ? pill.value : options[0] ?? '' }) }} className={`${inputClass} mt-2`} placeholder="選項，以逗號分隔" />}</> : <input aria-label={pill.label} type={pill.type} step={pill.type === 'number' ? 'any' : undefined} value={typeof pill.value === 'number' && !Number.isFinite(pill.value) ? '' : String(pill.value)} onChange={(e) => update(pill.id, { value: pill.type === 'number' ? (e.target.value === '' ? Number.NaN : Number(e.target.value)) : e.target.value })} className={inputClass} />}
      {pill.id.startsWith('custom:') && <p className="mt-2 text-xs text-zinc-500">自訂計畫註記；尚未綁定執行工具。</p>}
    </fieldset>)}
    <div className="flex gap-2"><select aria-label="新增 Pill 類型" disabled={disabled} value={newType} onChange={(e) => setNewType(e.target.value as LogicPill['type'])} className={inputClass}><option value="text">文字</option><option value="number">數字</option><option value="tags">標籤</option><option value="select">選單</option></select><button type="button" disabled={disabled || pills.length >= 100} onClick={() => onChange([...pills, { id: `custom:${crypto.randomUUID()}`, label: '自訂註記（不執行）', type: newType, value: newType === 'tags' ? [] : newType === 'number' ? 0 : newType === 'select' ? '選項 1' : '', ...(newType === 'select' ? { options: ['選項 1', '選項 2'] } : {}) }])} className="shrink-0 rounded-lg border border-zinc-300 px-4 text-sm disabled:opacity-40">＋ 新增註記（不執行）</button></div>
  </div>
}
