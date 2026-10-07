'use client'

import { useEffect, useMemo, useState } from 'react'
import { Building2, Pencil, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import type { WorkflowConfig, WorkflowLocale, WorkflowSummary } from '@/lib/yolanda-review/workflow-config'
import { deleteSavedWorkflow, getSavedWorkflow, listSavedWorkflows, saveWorkflowVersion } from '@/lib/yolanda-review/workflow-storage'
import { canWorkflowAction, DEMO_WORKFLOW_IDENTITIES, normalizeWorkflowGovernance, updateWorkflowAccess, type DemoWorkflowIdentity, type WorkflowRole } from '@/lib/yolanda-review/workflow-governance'

const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 outline-none hover:bg-zinc-50 focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-45'
const dangerButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-700 disabled:cursor-not-allowed disabled:opacity-45'
const selectClass = 'rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-zinc-950'

const COPY = {
  'zh-Hant': {
    title: '本機工作流庫', description: '管理目前瀏覽器內的工作流資產。這是演示資料與前端權限，不是真實身分認證。', identity: '演示身分', create: '建立新工作流', empty: '尚未儲存任何工作流。', select: '選擇工作流查看管理資料。', creator: '建立者', modified: '上次修改', modifiedBy: '修改者', organization: '公司', department: '部門', revision: '版本', unknown: '未知／舊版未記錄', permissions: '組織角色權限', view: '查看', run: '試跑', edit: '編輯', remove: '刪除', manage: '權限管理', allowed: '允許', denied: '不允許', open: '開啟', editRules: '編輯規則', runWorkflow: '開啟試跑', deleteWorkflow: '刪除工作流', confirmDelete: '永久刪除此本機工作流及其本機版本記錄？此操作不能復原。', minimumRun: '最低試跑角色', minimumEdit: '最低編輯角色', saveAccess: '儲存權限', savedAccess: '權限設定已儲存。', role: { staff: '員工', lead: '組長', manager: '部門經理', admin: '組織管理員' }, loadError: '無法載入本機工作流庫。', deleteError: '無法刪除工作流。', accessError: '無法儲存權限設定。', localOnly: '同一瀏覽器與同一網站來源',
  },
  en: {
    title: 'Local workflow library', description: 'Manage workflow assets stored in this browser. Identity and access checks are demo-only, not real authentication.', identity: 'Demo identity', create: 'Create workflow', empty: 'No saved workflows yet.', select: 'Select a workflow to view its management record.', creator: 'Creator', modified: 'Last modified', modifiedBy: 'Modified by', organization: 'Company', department: 'Department', revision: 'Revision', unknown: 'Unknown / not recorded by legacy version', permissions: 'Role access', view: 'View', run: 'Run trial', edit: 'Edit', remove: 'Delete', manage: 'Manage access', allowed: 'Allowed', denied: 'Not allowed', open: 'Open', editRules: 'Edit rules', runWorkflow: 'Open trial', deleteWorkflow: 'Delete workflow', confirmDelete: 'Permanently delete this local workflow and its local version records? This cannot be undone.', minimumRun: 'Minimum run role', minimumEdit: 'Minimum edit role', saveAccess: 'Save access', savedAccess: 'Access settings saved.', role: { staff: 'Staff', lead: 'Team lead', manager: 'Department manager', admin: 'Organization admin' }, loadError: 'Could not load the local workflow library.', deleteError: 'Could not delete the workflow.', accessError: 'Could not save access settings.', localOnly: 'Same browser and site origin only',
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
    <label className="mt-5 block max-w-sm text-xs font-semibold text-zinc-600">{c.identity}<select aria-label={c.identity} value={actor.userId} onChange={(event) => onActorChange(DEMO_WORKFLOW_IDENTITIES.find((identity) => identity.userId === event.target.value) ?? actor)} className={`${selectClass} mt-1 w-full`}>{DEMO_WORKFLOW_IDENTITIES.map((identity) => <option key={identity.userId} value={identity.userId}>{identity.displayName} · {c.role[identity.role]} · {identity.departmentName}</option>)}</select></label>
    {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mt-4 rounded-xl border px-3 py-2 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{error || notice}</p>}

    <div className="mt-6 grid min-w-0 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-2">{visibleSummaries.length ? visibleSummaries.map((summary) => {
        const item = summary.governance
        return <button key={summary.workflowId} type="button" aria-pressed={selected?.workflowId === summary.workflowId} onClick={() => selectWorkflow(summary.workflowId)} className={`w-full rounded-xl border p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 ${selected?.workflowId === summary.workflowId ? 'border-zinc-950 bg-zinc-50' : 'border-zinc-200 hover:border-zinc-400'}`}><span className="block font-semibold">{summary.name}</span><span className="mt-2 block text-xs text-zinc-600">{item.departmentName ?? c.unknown}</span><span className="mt-1 block text-xs text-zinc-500">v{summary.revision} · {formatTime(item.updatedAt, locale, c.unknown)}</span></button>
      }) : <p className="rounded-xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-600">{c.empty}</p>}</div>

      {selected && governance && permissions ? <article className="min-w-0 rounded-2xl border border-zinc-200 bg-zinc-50 p-5" data-managed-workflow={selected.workflowId}>
        <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-zinc-950 text-white"><Building2 className="size-5" /></span><div><h3 className="text-lg font-semibold">{selected.name}</h3><p className="mt-1 text-sm text-zinc-600">{selected.goal}</p></div></div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-zinc-500">{c.organization}</dt><dd className="mt-1 font-medium">{governance.organizationName ?? c.unknown}</dd></div><div><dt className="text-xs text-zinc-500">{c.department}</dt><dd className="mt-1 font-medium">{governance.departmentName ?? c.unknown}</dd></div><div><dt className="text-xs text-zinc-500">{c.creator}</dt><dd className="mt-1 font-medium">{governance.creatorName ?? c.unknown}</dd></div><div><dt className="text-xs text-zinc-500">{c.modified}</dt><dd className="mt-1 font-medium">{formatTime(governance.updatedAt, locale, c.unknown)}</dd></div><div><dt className="text-xs text-zinc-500">{c.modifiedBy}</dt><dd className="mt-1 font-medium">{governance.updatedByName ?? c.unknown}</dd></div><div><dt className="text-xs text-zinc-500">{c.revision}</dt><dd className="mt-1 font-medium">v{selected.revision}</dd></div></dl>

        <div className="mt-6"><h4 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4" />{c.permissions}</h4><div className="mt-3 grid gap-2 sm:grid-cols-2">{([['view', c.view], ['run', c.run], ['edit', c.edit], ['delete', c.remove], ['manage', c.manage]] as const).map(([key, label]) => <div key={key} className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"><span>{label}</span><strong>{permissions[key] ? c.allowed : c.denied}</strong></div>)}</div></div>

        {permissions.manage && <div className="mt-5 rounded-xl border border-zinc-200 bg-white p-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-zinc-600">{c.minimumRun}<select value={runRole} onChange={(event) => setRunRole(event.target.value as WorkflowRole)} className={`${selectClass} mt-1 w-full`}>{roles.map((role) => <option key={role} value={role}>{c.role[role]}</option>)}</select></label><label className="text-xs font-semibold text-zinc-600">{c.minimumEdit}<select value={editRole} onChange={(event) => setEditRole(event.target.value as WorkflowRole)} className={`${selectClass} mt-1 w-full`}>{roles.map((role) => <option key={role} value={role}>{c.role[role]}</option>)}</select></label></div><button type="button" onClick={saveAccess} className={`${buttonClass} mt-3`}>{c.saveAccess}</button></div>}

        <div className="mt-6 flex flex-wrap gap-2"><button type="button" onClick={() => onOpen(selected, 'view')} disabled={!permissions.view} className={buttonClass}>{c.open}</button><button type="button" onClick={() => onOpen(selected, 'edit')} disabled={!permissions.edit} className={buttonClass}><Pencil className="size-4" />{c.editRules}</button><button type="button" onClick={() => onOpen(selected, 'run')} disabled={!permissions.run} className={buttonClass}><Play className="size-4" />{c.runWorkflow}</button><button type="button" onClick={removeWorkflow} disabled={!permissions.delete} className={dangerButton}><Trash2 className="size-4" />{c.deleteWorkflow}</button></div>
      </article> : <p className="rounded-xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-600">{c.select}</p>}
    </div>
  </section>
}
