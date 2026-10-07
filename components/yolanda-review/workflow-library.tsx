'use client'

import { useEffect, useMemo, useState } from 'react'
import { Building2, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { buildWorkflowExplanationCard, type WorkflowConfig, type WorkflowLocale, type WorkflowSummary } from '@/lib/yolanda-review/workflow-config'
import { deleteSavedWorkflow, getSavedWorkflow, listSavedWorkflows, saveWorkflowVersion } from '@/lib/yolanda-review/workflow-storage'
import { canWorkflowAction, DEMO_WORKFLOW_IDENTITIES, normalizeWorkflowGovernance, updateWorkflowAccess, type DemoWorkflowIdentity, type WorkflowRole } from '@/lib/yolanda-review/workflow-governance'

const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-45'
const dangerButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-700 disabled:cursor-not-allowed disabled:opacity-45'
const selectClass = 'rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-zinc-950'

const COPY = {
  'zh-Hant': {
    title: '工作流庫', description: '重新開啟儲存在目前瀏覽器的工作流。', identity: '演示身分', demoControls: '演示控制（不是真實登入）', create: '建立新工作流', empty: '尚未儲存任何工作流。', select: '選擇要管理的工作流', creator: '建立者', modified: '上次修改', modifiedBy: '修改者', organization: '公司', department: '部門', revision: '版本', unknown: '未知／舊版未記錄', permissions: '組織角色權限', management: '管理詳情', view: '查看', run: '試跑', edit: '編輯', remove: '刪除', manage: '權限管理', allowed: '允許', denied: '不允許', open: '開啟', deleteWorkflow: '刪除工作流', confirmDelete: '永久刪除此本機工作流及其本機版本記錄？此操作不能復原。', minimumRun: '最低試跑角色', minimumEdit: '最低編輯角色', saveAccess: '儲存權限', savedAccess: '權限設定已儲存。', role: { staff: '員工', lead: '組長', manager: '部門經理', admin: '組織管理員' }, loadError: '無法載入工作流庫。', deleteError: '無法刪除工作流。', accessError: '無法儲存權限設定。', localOnly: '僅此瀏覽器。更換瀏覽器、網站地址或清除網站資料後，可能無法在這裡找到；可下載配置備份。',
  },
  en: {
    title: 'Workflow library', description: 'Reopen workflows saved in this browser.', identity: 'Demo identity', demoControls: 'Demo controls (not a real sign-in)', create: 'Create workflow', empty: 'No saved workflows yet.', select: 'Choose a workflow to manage', creator: 'Creator', modified: 'Last modified', modifiedBy: 'Modified by', organization: 'Company', department: 'Department', revision: 'Revision', unknown: 'Unknown / not recorded by legacy version', permissions: 'Role access', management: 'Management details', view: 'View', run: 'Trial', edit: 'Edit', remove: 'Delete', manage: 'Manage access', allowed: 'Allowed', denied: 'Not allowed', open: 'Open', deleteWorkflow: 'Delete workflow', confirmDelete: 'Permanently delete this local workflow and its local version records? This cannot be undone.', minimumRun: 'Minimum trial role', minimumEdit: 'Minimum edit role', saveAccess: 'Save access', savedAccess: 'Access settings saved.', role: { staff: 'Staff', lead: 'Team lead', manager: 'Department manager', admin: 'Organization admin' }, loadError: 'Could not load the workflow library.', deleteError: 'Could not delete the workflow.', accessError: 'Could not save access settings.', localOnly: 'This browser only. It may disappear after changing browser, site address, or clearing site data; download a configuration backup.',
  },
} as const

interface WorkflowLibraryProps {
  locale: WorkflowLocale
  actor: DemoWorkflowIdentity
  refreshKey: number
  onActorChange: (actor: DemoWorkflowIdentity) => void
  onCreate: () => void
  onOpen: (config: WorkflowConfig, mode: 'view' | 'edit' | 'run') => void
  onChanged: (config: WorkflowConfig) => void
  onDeleted: (workflowId: string) => void
}

function formatTime(value: string | null, locale: WorkflowLocale, fallback: string) {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : new Intl.DateTimeFormat(locale === 'zh-Hant' ? 'zh-Hant' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function WorkflowLibrary({ locale, actor, refreshKey, onActorChange, onCreate, onOpen, onChanged, onDeleted }: WorkflowLibraryProps) {
  const c = COPY[locale]
  const [summaries, setSummaries] = useState<WorkflowSummary[]>([])
  const [selected, setSelected] = useState<WorkflowConfig>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [runRole, setRunRole] = useState<WorkflowRole>('staff')
  const [editRole, setEditRole] = useState<WorkflowRole>('lead')

  useEffect(() => { listSavedWorkflows().then(setSummaries).catch(() => setError(c.loadError)) }, [c.loadError, refreshKey])
  useEffect(() => {
    if (!selected) return
    const governance = normalizeWorkflowGovernance(selected.governance)
    setRunRole(governance.minimumRunRole)
    setEditRole(governance.minimumEditRole)
  }, [selected])

  const permissions = useMemo(() => selected ? {
    view: canWorkflowAction(actor, 'view', selected),
    run: canWorkflowAction(actor, 'run', selected),
    edit: canWorkflowAction(actor, 'edit', selected),
    delete: canWorkflowAction(actor, 'delete', selected),
    manage: canWorkflowAction(actor, 'manage-access', selected),
  } : undefined, [actor, selected])
  const visibleSummaries = useMemo(() => summaries.filter((summary) => {
    const governance = summary.governance
    if (!governance.organizationId || !governance.departmentId) return true
    if (governance.organizationId !== actor.organizationId) return false
    return actor.role === 'admin' || governance.departmentId === actor.departmentId
  }), [actor, summaries])

  useEffect(() => {
    if (selected && !canWorkflowAction(actor, 'view', selected)) setSelected(undefined)
  }, [actor, selected])

  async function selectWorkflow(workflowId: string) {
    try {
      const config = await getSavedWorkflow(workflowId)
      if (!config) throw new Error(c.loadError)
      setSelected(config)
      setError('')
      setNotice('')
    } catch { setError(c.loadError) }
  }

  async function openWorkflow(workflowId: string) {
    try {
      const config = await getSavedWorkflow(workflowId)
      if (!config || !canWorkflowAction(actor, 'view', config)) throw new Error(c.loadError)
      onOpen(config, 'view')
    } catch { setError(c.loadError) }
  }

  async function removeWorkflow() {
    if (!selected || !permissions?.delete || !window.confirm(c.confirmDelete)) return
    try {
      await deleteSavedWorkflow(selected.workflowId)
      setSummaries(await listSavedWorkflows())
      onDeleted(selected.workflowId)
      setSelected(undefined)
      setError('')
    } catch { setError(c.deleteError) }
  }

  async function saveAccess() {
    if (!selected || !permissions?.manage) return
    try {
      const next = updateWorkflowAccess(selected, actor, runRole, editRole)
      await saveWorkflowVersion(next)
      setSelected(next)
      setSummaries(await listSavedWorkflows())
      onChanged(next)
      setNotice(c.savedAccess)
      setError('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : c.accessError) }
  }

  const governance = selected ? normalizeWorkflowGovernance(selected.governance) : undefined
  const roles: WorkflowRole[] = ['staff', 'lead', 'manager', 'admin']

  return <section data-workflow-library className="mb-6 rounded-2xl border border-zinc-300 bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{c.title}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600">{c.description}</p><p className="mt-1 text-xs text-zinc-500">{c.localOnly}</p></div><button type="button" onClick={onCreate} disabled={!canWorkflowAction(actor, 'create')} className={buttonClass}><Plus className="size-4" />{c.create}</button></div>
    <details className="mt-5 max-w-lg rounded-xl border border-zinc-200 bg-zinc-50 p-4"><summary className="cursor-pointer text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-zinc-950">{c.demoControls}</summary><label className="mt-4 block text-xs font-semibold text-zinc-600">{c.identity}<select aria-label={c.identity} value={actor.userId} onChange={(event) => onActorChange(DEMO_WORKFLOW_IDENTITIES.find((identity) => identity.userId === event.target.value) ?? actor)} className={`${selectClass} mt-1 w-full`}>{DEMO_WORKFLOW_IDENTITIES.map((identity) => <option key={identity.userId} value={identity.userId}>{identity.displayName} · {c.role[identity.role]} · {identity.departmentName}</option>)}</select></label></details>
    {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mt-4 rounded-xl border px-3 py-2 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{error || notice}</p>}

    {visibleSummaries.length > 0 && <details className="mt-5 max-w-lg rounded-xl border border-zinc-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-zinc-950">{c.management}</summary><p className="mt-2 text-xs text-zinc-500">{c.select}</p><div className="mt-3 flex flex-wrap gap-2">{visibleSummaries.map((summary) => <button key={summary.workflowId} type="button" onClick={() => selectWorkflow(summary.workflowId)} className={buttonClass}>{summary.name}</button>)}</div></details>}

    <div className={`mt-6 grid min-w-0 gap-5 ${selected ? 'lg:grid-cols-[320px_minmax(0,1fr)]' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
      <div className={selected ? 'space-y-3' : 'contents'}>{visibleSummaries.length ? visibleSummaries.map((summary) => <article key={summary.workflowId} className="rounded-xl border border-zinc-200 p-4"><h3 className="font-semibold">{summary.name}</h3><p className="mt-2 line-clamp-2 text-sm leading-5 text-zinc-600">{summary.goal}</p><p className="mt-3 text-xs text-zinc-500">{c.modified}: {formatTime(summary.governance.updatedAt, locale, c.unknown)}</p><button type="button" onClick={() => openWorkflow(summary.workflowId)} className={`${buttonClass} mt-4`}>{c.open}</button></article>) : <p className="rounded-xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-600">{c.empty}</p>}</div>

      {selected && governance && permissions ? <article className="min-w-0 rounded-2xl border border-zinc-200 bg-zinc-50 p-5" data-managed-workflow={selected.workflowId}>
        <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-zinc-950 text-white"><Building2 className="size-5" /></span><div><h3 className="text-lg font-semibold">{selected.name}</h3><p className="mt-1 text-sm text-zinc-600">{buildWorkflowExplanationCard(selected, locale).capability}</p></div></div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-zinc-500">{c.organization}</dt><dd className="mt-1 font-medium">{governance.organizationName ?? c.unknown}</dd></div><div><dt className="text-xs text-zinc-500">{c.department}</dt><dd className="mt-1 font-medium">{governance.departmentName ?? c.unknown}</dd></div><div><dt className="text-xs text-zinc-500">{c.creator}</dt><dd className="mt-1 font-medium">{governance.creatorName ?? c.unknown}</dd></div><div><dt className="text-xs text-zinc-500">{c.modified}</dt><dd className="mt-1 font-medium">{formatTime(governance.updatedAt, locale, c.unknown)}</dd></div><div><dt className="text-xs text-zinc-500">{c.modifiedBy}</dt><dd className="mt-1 font-medium">{governance.updatedByName ?? c.unknown}</dd></div><div><dt className="text-xs text-zinc-500">{c.revision}</dt><dd className="mt-1 font-medium">v{selected.revision}</dd></div></dl>

        <details className="mt-6 rounded-xl border border-zinc-200 bg-white p-4"><summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-zinc-950"><ShieldCheck className="size-4" />{c.permissions}</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{([['view', c.view], ['run', c.run], ['edit', c.edit], ['delete', c.remove], ['manage', c.manage]] as const).map(([key, label]) => <div key={key} className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"><span>{label}</span><strong>{permissions[key] ? c.allowed : c.denied}</strong></div>)}</div>{permissions.manage && <div className="mt-5 border-t border-zinc-200 pt-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-zinc-600">{c.minimumRun}<select value={runRole} onChange={(event) => setRunRole(event.target.value as WorkflowRole)} className={`${selectClass} mt-1 w-full`}>{roles.map((role) => <option key={role} value={role}>{c.role[role]}</option>)}</select></label><label className="text-xs font-semibold text-zinc-600">{c.minimumEdit}<select value={editRole} onChange={(event) => setEditRole(event.target.value as WorkflowRole)} className={`${selectClass} mt-1 w-full`}>{roles.map((role) => <option key={role} value={role}>{c.role[role]}</option>)}</select></label></div><button type="button" onClick={saveAccess} className={`${buttonClass} mt-3`}>{c.saveAccess}</button></div>}</details>

        <details className="mt-6 rounded-xl border border-zinc-200 bg-white p-4"><summary className="cursor-pointer text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-zinc-950">{c.remove}</summary><p className="mt-3 text-xs leading-5 text-zinc-600">{c.confirmDelete}</p><button type="button" onClick={removeWorkflow} disabled={!permissions.delete} className={`${dangerButton} mt-3`}><Trash2 className="size-4" />{c.deleteWorkflow}</button></details>
      </article> : null}
    </div>
  </section>
}
