'use client'

import { useEffect, useState, type ChangeEvent as ReactChangeEvent } from 'react'
import { AlertTriangle, Check, ChevronRight, ClipboardCheck, Download, FileText, History, LoaderCircle, LockKeyhole, RotateCcw, Save, ShieldCheck, UserRound } from 'lucide-react'
import { demoAdapter } from '@/lib/yolanda-review/adapter'
import { demoBatch, SYNTHETIC_NOTICE } from '@/lib/yolanda-review/demo-data'
import { effectiveFields, MAX_DATE_WINDOW_DAYS, MAX_TOLERANCE_CENTS, validateAssumptions } from '@/lib/yolanda-review/engine'
import { buildDraftsText, buildResultsCsv, buildReviewJson, buildWorkingCopy, downloadText } from '@/lib/yolanda-review/export'
import { approvalBlockers, canExport, createInitialState, reviewReducer } from '@/lib/yolanda-review/state'
import type { ApprovalSnapshot, ChangeEvent, EditorScope, ExtractedFields, ReviewBatch, ReviewDocument } from '@/lib/yolanda-review/types'
import { parseWorkingCopy } from '@/lib/yolanda-review/working-copy'
import { useReducer } from 'react'
import { LogicPillStudio } from './logic-pill-studio'

const inputClass = 'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10 disabled:bg-zinc-100'
const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45'

function money(cents: number, currency = 'HKD') {
  return new Intl.NumberFormat('en-HK', { style: 'currency', currency }).format(cents / 100)
}

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function StatusPill({ tone, children }: { tone: 'neutral' | 'warning' | 'success' | 'danger'; children: React.ReactNode }) {
  const styles = { neutral: 'border-zinc-200 bg-zinc-100 text-zinc-700', warning: 'border-amber-200 bg-amber-50 text-amber-900', success: 'border-emerald-200 bg-emerald-50 text-emerald-800', danger: 'border-red-200 bg-red-50 text-red-800' }
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${styles[tone]}`}>{children}</span>
}

export function ReviewWorkbench() {
  const [state, dispatch] = useReducer(reviewReducer, demoBatch, createInitialState)
  const [selectedId, setSelectedId] = useState(demoBatch.documents[0].recordId)
  const [assumptionEditor, setAssumptionEditor] = useState(state.batch.assumptions)
  const [editingAssumptions, setEditingAssumptions] = useState(false)
  const [editingDocument, setEditingDocument] = useState(false)
  const selectedDocument = state.batch.documents.find((document) => document.recordId === selectedId) ?? state.batch.documents[0]
  const [fieldEditor, setFieldEditor] = useState<ExtractedFields>(() => effectiveFields(selectedDocument))
  const [matchChoice, setMatchChoice] = useState('')
  const [matchReason, setMatchReason] = useState('')
  const [exclusionReason, setExclusionReason] = useState('')
  const [warningReason, setWarningReason] = useState('')
  const [reviewReason, setReviewReason] = useState('')
  const [followUp, setFollowUp] = useState('')

  const selectedResult = state.calculation?.matches.find((match) => match.recordId === selectedDocument.recordId)
  const evidence = state.batch.evidence.find((item) => item.evidenceId === selectedDocument.evidenceId)
  const blockers = approvalBlockers(state)
  const hardBlockerCount = state.calculation?.matches.filter((match) => match.status === 'blocked').length ?? 0
  const currentApproval = state.approvalHistory.find((approval) => approval.approvalId === state.currentApprovalId)

  useEffect(() => {
    if (!state.dirtyEditors.includes('match')) setMatchChoice(selectedDocument.selectedLedgerRowId ?? selectedResult?.selectedLedgerRowId ?? '')
  }, [selectedDocument.recordId, selectedDocument.selectedLedgerRowId, selectedResult?.selectedLedgerRowId, state.dirtyEditors])

  useEffect(() => {
    if (state.status !== 'calculating' || state.pendingCalculation) return
    const requestId = id('calc')
    const pending = { batchId: state.batch.batchId, revision: state.batch.revision, requestId }
    dispatch({ type: 'START_CALCULATION', pending })
    demoAdapter.calculate(structuredClone(state.batch), requestId).then(
      (result) => dispatch({ type: 'CALCULATION_SUCCEEDED', result }),
      (error: unknown) => dispatch({ type: 'CALCULATION_FAILED', pending, message: error instanceof Error ? error.message : 'Calculation failed.' }),
    )
  }, [state.status, state.pendingCalculation, state.batch])

  const editorDirty = (editor: EditorScope) => state.dirtyEditors.includes(editor)
  const setDirty = (editor: EditorScope, dirty: boolean) => dispatch({ type: 'SET_EDITOR_DIRTY', editor, dirty })

  function commitBatch(nextWithoutRevision: ReviewBatch, details: Omit<ChangeEvent, 'eventId' | 'at' | 'actor' | 'identityMode' | 'revision'>, affectsFacts: boolean, editor?: EditorScope) {
    if (JSON.stringify({ ...nextWithoutRevision, revision: state.batch.revision }) === JSON.stringify(state.batch)) {
      if (editor) setDirty(editor, false)
      dispatch({ type: 'SET_NOTICE', notice: 'No saved values changed; revision unchanged.' })
      return false
    }
    const revision = state.batch.revision + 1
    const at = new Date().toISOString()
    const next = { ...nextWithoutRevision, revision }
    dispatch({
      type: 'COMMIT_BATCH',
      batch: next,
      affectsFacts,
      editor,
      event: { ...details, eventId: id('change'), at, actor: `demo-${state.role}`, identityMode: state.identityMode, revision },
    })
    return true
  }

  function chooseDocument(document: ReviewDocument) {
    const documentEditors: EditorScope[] = ['document', 'match', 'exception']
    if (documentEditors.some(editorDirty) && !window.confirm('Discard unsaved values for this document?')) return
    documentEditors.forEach((editor) => setDirty(editor, false))
    setEditingDocument(false)
    setSelectedId(document.recordId)
    setFieldEditor(effectiveFields(document))
    setMatchChoice(document.selectedLedgerRowId ?? '')
    setMatchReason(document.matchReason ?? '')
    setExclusionReason('')
    setWarningReason(document.warningAcknowledgement?.reason ?? '')
    setReviewReason(document.reviewNote?.reason ?? '')
    setFollowUp(document.reviewNote?.followUp ?? '')
  }

  function beginDocumentEdit() {
    setFieldEditor(effectiveFields(selectedDocument))
    setEditingDocument(true)
    setDirty('document', true)
  }

  function saveDocument() {
    const corrections = Object.fromEntries(Object.entries(fieldEditor).filter(([key, value]) => value !== selectedDocument.original[key as keyof ExtractedFields])) as Partial<ExtractedFields>
    const documents = state.batch.documents.map((document) => document.recordId === selectedDocument.recordId ? { ...document, corrections } : document)
    commitBatch({ ...state.batch, documents }, { action: 'correct fields', field: selectedDocument.recordId, before: JSON.stringify(effectiveFields(selectedDocument)), after: JSON.stringify(fieldEditor), reason: 'Reviewer correction from source evidence' }, true, 'document')
    setEditingDocument(false)
  }

  function saveMatch() {
    const documents = state.batch.documents.map((document) => document.recordId === selectedDocument.recordId ? { ...document, selectedLedgerRowId: matchChoice || undefined, matchDisposition: matchChoice ? 'manual' as const : 'pending' as const, matchReason: matchReason.trim() || undefined } : document)
    commitBatch({ ...state.batch, documents }, { action: 'set match', field: selectedDocument.recordId, before: selectedDocument.selectedLedgerRowId ?? '', after: matchChoice, reason: matchReason || 'Candidate selected after evidence review' }, true, 'match')
  }

  function excludeDocument() {
    if (!exclusionReason.trim()) return
    const documents = state.batch.documents.map((document) => document.recordId === selectedDocument.recordId ? { ...document, excluded: { reason: exclusionReason.trim() } } : document)
    commitBatch({ ...state.batch, documents }, { action: 'exclude record', field: selectedDocument.recordId, before: 'included', after: 'excluded', reason: exclusionReason.trim() }, true, 'exception')
    setExclusionReason('')
  }

  function restoreDocument() {
    const documents = state.batch.documents.map((document) => document.recordId === selectedDocument.recordId ? { ...document, excluded: undefined } : document)
    commitBatch({ ...state.batch, documents }, { action: 'restore record', field: selectedDocument.recordId, before: 'excluded', after: 'included', reason: 'Returned for review' }, true)
  }

  function saveExceptionReview() {
    const warningAcknowledgement = selectedResult?.warnings.length ? { reason: warningReason.trim() } : selectedDocument.warningAcknowledgement
    if (selectedResult?.warnings.length && !warningAcknowledgement?.reason) return
    const reviewNote = reviewReason.trim() || followUp.trim() ? { reason: reviewReason.trim(), followUp: followUp.trim() } : undefined
    const documents = state.batch.documents.map((document) => document.recordId === selectedDocument.recordId ? { ...document, warningAcknowledgement, reviewNote } : document)
    commitBatch({ ...state.batch, documents }, { action: 'record exception review', field: selectedDocument.recordId, before: JSON.stringify({ warningAcknowledgement: selectedDocument.warningAcknowledgement, reviewNote: selectedDocument.reviewNote }), after: JSON.stringify({ warningAcknowledgement, reviewNote }), reason: warningAcknowledgement?.reason || reviewNote?.reason || reviewNote?.followUp || 'Review note updated' }, false, 'exception')
  }

  function saveAssumptions() {
    const batch = { ...state.batch, assumptions: { ...assumptionEditor, confirmed: true } }
    if (validateAssumptions(batch).length) return
    commitBatch(batch, { action: 'confirm assumptions', field: 'assumptions', before: JSON.stringify(state.batch.assumptions), after: JSON.stringify(batch.assumptions), reason: 'Reviewer confirmed task scope and fixed demo limits' }, true, 'assumptions')
    setEditingAssumptions(false)
  }

  function cancelEditor(editor: 'assumptions' | 'document') {
    if (editor === 'assumptions') {
      setAssumptionEditor(state.batch.assumptions)
      setEditingAssumptions(false)
    } else {
      setFieldEditor(effectiveFields(selectedDocument))
      setEditingDocument(false)
    }
    setDirty(editor, false)
  }

  function saveDraft(subject: string, body: string) {
    const draft = state.batch.drafts[0]
    if (draft.subject === subject && draft.body === body && !draft.stale) {
      setDirty('draft', false)
      return
    }
    const recordIds = state.calculation?.matches.filter((match) => match.status === 'blocked').map((match) => match.recordId) ?? draft.recordIds
    const nextDraft = { ...draft, subject, body, recordIds, manuallyEdited: true, stale: false, basisRevision: state.batch.revision + 1, suggestedSubject: undefined, suggestedBody: undefined }
    commitBatch({ ...state.batch, drafts: [nextDraft] }, { action: 'edit draft', field: draft.draftId, before: `${draft.subject}\n${draft.body}`, after: `${subject}\n${body}`, reason: 'Reviewer edited message draft' }, false, 'draft')
  }

  function approve() {
    const freshBlockers = approvalBlockers(state)
    if (freshBlockers.length || !state.calculation) {
      dispatch({ type: 'SET_NOTICE', notice: `Approval refused: ${freshBlockers[0] ?? 'current calculation missing'}` })
      return
    }
    dispatch({ type: 'APPROVE', approvalId: id('approval'), approvedAt: new Date().toISOString() })
  }

  function exportApproval(kind: 'json' | 'csv' | 'txt') {
    if (!canExport(state) || !currentApproval) {
      dispatch({ type: 'SET_NOTICE', notice: 'Export refused: current version has no valid approval.' })
      return
    }
    const stem = `ezagent-${currentApproval.batchId}-v${currentApproval.revision}`
    if (kind === 'json') downloadText(`${stem}-review.json`, buildReviewJson(currentApproval), 'application/json;charset=utf-8')
    if (kind === 'csv') downloadText(`${stem}-results.csv`, buildResultsCsv(currentApproval), 'text/csv;charset=utf-8')
    if (kind === 'txt') downloadText(`${stem}-drafts.txt`, buildDraftsText(currentApproval), 'text/plain;charset=utf-8')
    dispatch({ type: 'SET_NOTICE', notice: `Generated ${kind.toUpperCase()} download for approved v${currentApproval.revision}. Browser save cannot be verified.` })
  }

  async function importWorkingCopy(event: ReactChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      if ((state.dirtyEditors.length || state.changes.length || state.currentApprovalId) && !window.confirm('Replace this session with the selected unapproved working copy?')) return
      if (file.size > 2_000_000) throw new Error('Working copy exceeds the 2 MB limit.')
      const { batch, changes } = parseWorkingCopy(JSON.parse(await file.text()))
      dispatch({ type: 'LOAD_WORKING_COPY', batch, changes, notice: 'Working copy restored as unapproved. Imported approval and identity are not trusted.' })
      setAssumptionEditor(batch.assumptions)
      setSelectedId(batch.documents[0]?.recordId ?? '')
      setFieldEditor(effectiveFields(batch.documents[0]))
      setMatchChoice(batch.documents[0]?.selectedLedgerRowId ?? '')
      setMatchReason(batch.documents[0]?.matchReason ?? '')
      setExclusionReason('')
      setWarningReason(batch.documents[0]?.warningAcknowledgement?.reason ?? '')
      setReviewReason(batch.documents[0]?.reviewNote?.reason ?? '')
      setFollowUp(batch.documents[0]?.reviewNote?.followUp ?? '')
      setEditingAssumptions(false)
      setEditingDocument(false)
    } catch (error) {
      dispatch({ type: 'SET_NOTICE', notice: `Import failed: ${error instanceof Error ? error.message : 'Invalid file.'}` })
    } finally {
      event.target.value = ''
    }
  }

  function resetDemoSession() {
    if ((state.dirtyEditors.length || state.changes.length || state.currentApprovalId) && !window.confirm('Clear this review session? Downloaded files and source evidence will not be deleted.')) return
    const batch = structuredClone(demoBatch)
    dispatch({ type: 'LOAD_WORKING_COPY', batch, changes: [], notice: 'Demo session cleared. Source files and prior downloads were not deleted.' })
    setAssumptionEditor(batch.assumptions)
    setSelectedId(batch.documents[0].recordId)
    setFieldEditor(effectiveFields(batch.documents[0]))
    setMatchChoice('')
    setMatchReason('')
    setExclusionReason('')
    setWarningReason('')
    setReviewReason('')
    setFollowUp('')
    setEditingAssumptions(false)
    setEditingDocument(false)
  }

  return <main className="min-h-screen bg-[#f4f2ed] text-zinc-950">
    <header className="border-b border-zinc-300/80 bg-[#faf9f6] px-5 py-5 sm:px-8">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-zinc-950 text-white"><ClipboardCheck className="size-5" /></div><div><p className="text-xs font-semibold uppercase tracking-[0.17em] text-zinc-500">EZAgent · Review control</p><h1 className="text-xl font-semibold tracking-tight">Review &amp; Approval</h1></div></div>
        <div className="flex flex-wrap items-center gap-2"><StatusPill tone={state.batch.mode === 'synthetic' ? 'warning' : 'danger'}>{state.batch.mode === 'synthetic' ? SYNTHETIC_NOTICE : 'Real-mode working copy · adapter disconnected'}</StatusPill><StatusPill tone={state.status === 'approved' ? 'success' : state.status === 'error' ? 'danger' : 'neutral'}>{state.status}</StatusPill><StatusPill tone={hardBlockerCount ? 'danger' : state.calculation ? 'success' : 'neutral'}>{state.calculation ? `${hardBlockerCount} blockers` : 'blockers pending'}</StatusPill></div>
      </div>
    </header>

    <div className="mx-auto max-w-[1500px] px-5 py-6 sm:px-8">
      <section aria-label="Task status" className="grid gap-3 rounded-2xl border border-zinc-300 bg-white p-4 shadow-[0_12px_40px_-32px_rgba(24,24,27,.45)] md:grid-cols-[1fr_auto]">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm"><span><b>{state.batch.batchId}</b></span><span>Revision <b>v{state.batch.revision}</b></span><span>Source <b>{state.batch.sourceVersion}</b></span><span className="inline-flex items-center gap-1.5"><LockKeyhole className="size-4" /> No sending · no ledger overwrite</span></div>
        <label className="flex items-center gap-2 text-sm font-medium"><UserRound className="size-4" /> Demo role <select aria-label="Demo role" value={state.role} onChange={(event) => dispatch({ type: 'SET_ROLE', role: event.target.value as 'reviewer' | 'manager' })} className="rounded-lg border border-zinc-300 bg-white px-3 py-2"><option value="reviewer">Operator</option><option value="manager">Manager</option></select></label>
        <p className="text-xs text-zinc-500 md:col-span-2">Demo identity, not real authentication. Browser checks are prototype behavior constraints, not a security boundary.</p>
      </section>

      {state.notice && <div role="status" className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">{state.notice}</div>}
      {state.status === 'calculating' && <div role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> Calculating v{state.batch.revision}. Old results cannot be approved.</div>}
      {state.status === 'error' && <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><span><b>Calculation failed.</b> {state.calculationError} Old results remain invalid.</span><button onClick={() => dispatch({ type: 'RETRY_CALCULATION' })} className={`${buttonClass} border border-red-300 bg-white`}>Retry calculation</button></div>}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,.7fr)]">
        <div className="space-y-6">
          <LogicPillStudio assumptions={state.batch.assumptions} />

          <AssumptionsPanel state={state} value={assumptionEditor} setValue={(value) => { setAssumptionEditor(value); setDirty('assumptions', true) }} editing={editingAssumptions} begin={() => { setEditingAssumptions(true); setDirty('assumptions', true) }} save={saveAssumptions} cancel={() => cancelEditor('assumptions')} />

          <section aria-labelledby="documents-title" className="rounded-2xl border border-zinc-300 bg-white p-5">
            <div className="flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">03 · Evidence</p><h2 id="documents-title" className="mt-1 text-lg font-semibold">Review documents</h2></div><span className="text-xs text-zinc-500">Original evidence stays read-only</span></div>
            <div className="mt-5 grid min-h-[570px] gap-4 lg:grid-cols-[220px_minmax(0,1fr)_minmax(260px,.8fr)]">
              <nav aria-label="Documents" className="space-y-2 border-b border-zinc-200 pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">{state.batch.documents.map((document) => {
                const result = state.calculation?.matches.find((match) => match.recordId === document.recordId)
                return <button key={document.recordId} onClick={() => chooseDocument(document)} className={`w-full rounded-xl border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 ${selectedId === document.recordId ? 'border-zinc-950 bg-zinc-950 text-white' : 'border-zinc-200 bg-zinc-50 hover:border-zinc-400'}`}><span className="flex items-center justify-between text-xs font-semibold"><span>{document.recordId}</span><span>{result?.status ?? (state.status === 'draft' ? 'pending' : 'recalculating')}</span></span><span className={`mt-1 block truncate text-xs ${selectedId === document.recordId ? 'text-zinc-300' : 'text-zinc-500'}`}>{effectiveFields(document).merchant}</span></button>
              })}</nav>

              <div className="min-w-0 space-y-4">
                <div className="rounded-xl border border-zinc-200 bg-[#f7f5f0] p-4"><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500"><FileText className="size-4" /> {evidence?.fileName}</div><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-zinc-800">{evidence?.rawText}</pre><p className="mt-3 text-xs text-zinc-500">Rendered as plain text. Document instructions cannot alter policy.</p></div>
                <div className="rounded-xl border border-zinc-200 p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">Extracted fields</h3>{!editingDocument && <button className={`${buttonClass} border border-zinc-300 bg-white hover:bg-zinc-100`} onClick={beginDocumentEdit}>Edit fields</button>}</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">{(['merchant', 'receiptNumber', 'date', 'amount', 'currency'] as const).map((field) => <label key={field} className="text-xs font-medium text-zinc-600">{field}<input aria-label={field} disabled={!editingDocument} value={editingDocument ? fieldEditor[field] : effectiveFields(selectedDocument)[field]} onChange={(event) => setFieldEditor({ ...fieldEditor, [field]: event.target.value })} className={inputClass} /></label>)}</div>
                  {editingDocument && <div className="mt-4 flex gap-2"><button onClick={saveDocument} className={`${buttonClass} bg-zinc-950 text-white hover:bg-zinc-700`}><Save className="size-4" /> Save correction</button><button onClick={() => cancelEditor('document')} className={`${buttonClass} border border-zinc-300 bg-white`}>Cancel</button></div>}
                  {Object.keys(selectedDocument.corrections).length > 0 && <p className="mt-3 text-xs text-amber-800">Original suggestion retained: {JSON.stringify(selectedDocument.original)}</p>}
                </div>
              </div>

              <aside className="space-y-4">
                <div className="rounded-xl border border-zinc-200 p-4"><h3 className="font-semibold">Match decision</h3>{selectedResult?.blockers.map((blocker) => <p key={blocker} className="mt-2 flex gap-2 text-sm text-red-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{blocker}</p>)}{selectedResult?.warnings.map((warning) => <p key={warning} className="mt-2 text-sm text-amber-800">Warning: {warning}</p>)}
                  <label className="mt-4 block text-xs font-medium text-zinc-600">Eligible ledger candidate<select aria-label="Eligible ledger candidate" value={editorDirty('match') ? matchChoice : selectedDocument.selectedLedgerRowId ?? selectedResult?.selectedLedgerRowId ?? ''} onChange={(event) => { setMatchChoice(event.target.value); setDirty('match', true) }} className={inputClass}><option value="">No selection / mark pending</option>{selectedResult?.candidateLedgerRowIds.map((candidateId) => { const row = state.batch.ledgerRows.find((item) => item.ledgerRowId === candidateId)!; return <option key={candidateId} value={candidateId}>{candidateId} · {row.merchant}</option> })}</select></label>
                  {selectedResult?.candidateLedgerRowIds.map((candidateId) => { const row = state.batch.ledgerRows.find((item) => item.ledgerRowId === candidateId)!; return <p key={candidateId} className="mt-2 text-xs text-zinc-500">{candidateId}: {row.date} · {row.currency} {row.amount} · receipt {row.receiptNumber}</p> })}
                  <label className="mt-3 block text-xs font-medium text-zinc-600">Decision reason<input aria-label="Match decision reason" value={matchReason || selectedDocument.matchReason || ''} onChange={(event) => { setMatchReason(event.target.value); setDirty('match', true) }} className={inputClass} /></label>
                  <button disabled={!editorDirty('match') || editingDocument || editingAssumptions} onClick={saveMatch} className={`${buttonClass} mt-3 w-full bg-zinc-950 text-white`}>Save match decision</button>
                </div>
                <div className="rounded-xl border border-zinc-200 p-4"><h3 className="font-semibold">Exception handling</h3>{selectedResult?.warnings.length ? <label className="mt-3 block text-xs font-medium text-zinc-600">Warning acknowledgement reason<textarea aria-label="Warning acknowledgement reason" value={warningReason} onChange={(event) => { setWarningReason(event.target.value); setDirty('exception', true) }} className={`${inputClass} min-h-16`} /></label> : null}<label className="mt-3 block text-xs font-medium text-zinc-600">Difference reason<input aria-label="Difference reason" value={reviewReason} onChange={(event) => { setReviewReason(event.target.value); setDirty('exception', true) }} className={inputClass} /></label><label className="mt-3 block text-xs font-medium text-zinc-600">Follow-up note<input aria-label="Follow-up note" value={followUp} onChange={(event) => { setFollowUp(event.target.value); setDirty('exception', true) }} className={inputClass} /></label><button disabled={!editorDirty('exception') || Boolean(selectedResult?.warnings.length && !warningReason.trim())} onClick={saveExceptionReview} className={`${buttonClass} mt-3 w-full border border-zinc-300 bg-white`}>Save review notes</button>{selectedDocument.excluded ? <><p className="mt-4 text-sm text-zinc-600">Excluded: {selectedDocument.excluded.reason}</p><button onClick={restoreDocument} className={`${buttonClass} mt-3 border border-zinc-300 bg-white`}><RotateCcw className="size-4" /> Restore</button></> : <><label className="mt-4 block text-xs font-medium text-zinc-600">Required exclusion reason<textarea aria-label="Exclusion reason" value={exclusionReason} onChange={(event) => { setExclusionReason(event.target.value); setDirty('exception', true) }} className={`${inputClass} min-h-20`} /></label><button disabled={!exclusionReason.trim()} onClick={excludeDocument} className={`${buttonClass} mt-3 border border-red-200 bg-red-50 text-red-800`}>Exclude with evidence retained</button></>}</div>
              </aside>
            </div>
          </section>
        </div>

        <ApprovalPanel state={state} blockers={blockers} currentApproval={currentApproval} saveDraft={saveDraft} approve={approve} exportApproval={exportApproval} importWorkingCopy={importWorkingCopy} resetDemoSession={resetDemoSession} dispatch={dispatch} />
      </div>
    </div>
  </main>
}

function AssumptionsPanel({ state, value, setValue, editing, begin, save, cancel }: { state: ReturnType<typeof createInitialState>; value: ReviewBatch['assumptions']; setValue: (value: ReviewBatch['assumptions']) => void; editing: boolean; begin: () => void; save: () => void; cancel: () => void }) {
  const errors = validateAssumptions({ ...state.batch, assumptions: value })
  return <section aria-labelledby="assumptions-title" className="rounded-2xl border border-zinc-300 bg-white p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">02 · Execution scope</p><h2 id="assumptions-title" className="mt-1 text-lg font-semibold">Finance preset settings</h2><p className="mt-1 text-sm text-zinc-500">These confirmed values drive the current synthetic reconciliation calculation. Logic Pills above remain a prompt-design layer.</p></div>{!editing && <button onClick={begin} className={`${buttonClass} border border-zinc-300 bg-white`}>{state.batch.assumptions.confirmed ? 'Edit execution settings' : 'Review & confirm'}</button>}</div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><label className="text-xs font-medium text-zinc-600">From<input type="date" disabled={!editing} value={value.dateFrom} onChange={(event) => setValue({ ...value, dateFrom: event.target.value, confirmed: false })} className={inputClass} /></label><label className="text-xs font-medium text-zinc-600">To<input type="date" disabled={!editing} value={value.dateTo} onChange={(event) => setValue({ ...value, dateTo: event.target.value, confirmed: false })} className={inputClass} /></label><label className="text-xs font-medium text-zinc-600">Date format<select disabled={!editing} value={value.dateInterpretation} onChange={(event) => setValue({ ...value, dateInterpretation: event.target.value as 'DD/MM/YYYY' | 'MM/DD/YYYY', confirmed: false })} className={inputClass}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option></select></label><label className="text-xs font-medium text-zinc-600">Currency<input disabled={!editing} value={value.currency} onChange={(event) => setValue({ ...value, currency: event.target.value.toUpperCase(), confirmed: false })} className={inputClass} /></label><label className="text-xs font-medium text-zinc-600">Tolerance (cents)<input type="number" min="0" max={MAX_TOLERANCE_CENTS} disabled={!editing} value={value.amountToleranceCents} onChange={(event) => setValue({ ...value, amountToleranceCents: Number(event.target.value), confirmed: false })} className={inputClass} /></label><label className="text-xs font-medium text-zinc-600">Date window (days)<input type="number" min="0" max={MAX_DATE_WINDOW_DAYS} disabled={!editing} value={value.dateWindowDays} onChange={(event) => setValue({ ...value, dateWindowDays: Number(event.target.value), confirmed: false })} className={inputClass} /></label></div>
    <fieldset className="mt-4"><legend className="text-xs font-semibold text-zinc-700">Field mapping</legend><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{(Object.keys(value.fieldMapping) as Array<keyof typeof value.fieldMapping>).map((field) => <label key={field} className="text-xs text-zinc-600">{field}<select disabled={!editing} value={value.fieldMapping[field]} onChange={(event) => setValue({ ...value, fieldMapping: { ...value.fieldMapping, [field]: event.target.value }, confirmed: false })} className={inputClass}>{['transaction_date', 'gross_amount', 'currency', 'receipt_no', 'vendor_name'].map((column) => <option key={column}>{column}</option>)}</select></label>)}</div></fieldset>
    <div className="mt-3 flex flex-wrap gap-2"><StatusPill tone={state.batch.assumptions.confirmed ? 'success' : 'warning'}>{state.batch.assumptions.confirmed ? 'User confirmed' : 'System suggested · unconfirmed'}</StatusPill><span className="text-xs text-zinc-500">Date interpretation: {value.dateInterpretation} · Fixed demo limits: HKD 1.00 / 7 days. Unsupported synthetic mappings are blocked, not fake-recalculated.</span></div>
    {errors.map((error) => <p role="alert" key={error} className="mt-2 text-sm text-red-700">{error}</p>)}{editing && <div className="mt-4 flex gap-2"><button disabled={Boolean(errors.length)} onClick={save} className={`${buttonClass} bg-zinc-950 text-white`}><Check className="size-4" /> Save & confirm</button><button onClick={cancel} className={`${buttonClass} border border-zinc-300 bg-white`}>Cancel</button></div>}
  </section>
}

function ApprovalPanel({ state, blockers, currentApproval, saveDraft, approve, exportApproval, importWorkingCopy, resetDemoSession, dispatch }: { state: ReturnType<typeof createInitialState>; blockers: string[]; currentApproval?: ApprovalSnapshot; saveDraft: (subject: string, body: string) => void; approve: () => void; exportApproval: (kind: 'json' | 'csv' | 'txt') => void; importWorkingCopy: (event: ReactChangeEvent<HTMLInputElement>) => void; resetDemoSession: () => void; dispatch: React.Dispatch<Parameters<typeof reviewReducer>[1]> }) {
  const draft = state.batch.drafts[0]
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  useEffect(() => {
    if (!state.dirtyEditors.includes('draft')) {
      setSubject(draft.subject)
      setBody(draft.body)
    }
  }, [draft.subject, draft.body, state.dirtyEditors])
  const downloadWorkingCopy = () => downloadText(`ezagent-${state.batch.batchId}-v${state.batch.revision}-UNAPPROVED-working-copy.json`, buildWorkingCopy(state), 'application/json;charset=utf-8')
  return <aside aria-labelledby="approval-title" className="self-start rounded-2xl border border-zinc-300 bg-[#faf9f6] p-5 xl:sticky xl:top-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">04 · Decision</p><h2 id="approval-title" className="mt-1 text-lg font-semibold">Approve &amp; export</h2>
    <div className="mt-4 grid grid-cols-3 gap-2">{[['Included', state.calculation?.includedCount ?? '—'], ['Excluded', state.calculation?.excludedCount ?? '—'], ['Total', state.calculation ? money(state.calculation.totalCents, state.batch.assumptions.currency) : '—']].map(([label, value]) => <div key={label} className="rounded-xl border border-zinc-200 bg-white p-3"><p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>)}</div>
    <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4"><h3 className="font-semibold">Message draft</h3>{draft.stale && <div role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"><p>Source facts changed. Existing hand-written text is preserved but stale.</p>{draft.suggestedBody && <><p className="mt-2 font-semibold">New suggestion for v{state.batch.revision}</p><p className="mt-1 whitespace-pre-wrap">{draft.suggestedBody}</p><button onClick={() => { setSubject(draft.suggestedSubject ?? subject); setBody(draft.suggestedBody ?? body); dispatch({ type: 'SET_EDITOR_DIRTY', editor: 'draft', dirty: true }) }} className={`${buttonClass} mt-2 border border-red-200 bg-white`}>Use new suggestion</button></>}</div>}<label className="mt-3 block text-xs font-medium text-zinc-600">Subject<input value={subject} onChange={(event) => { setSubject(event.target.value); dispatch({ type: 'SET_EDITOR_DIRTY', editor: 'draft', dirty: true }) }} className={inputClass} /></label><label className="mt-3 block text-xs font-medium text-zinc-600">Body<textarea value={body} onChange={(event) => { setBody(event.target.value); dispatch({ type: 'SET_EDITOR_DIRTY', editor: 'draft', dirty: true }) }} className={`${inputClass} min-h-36`} /></label><button disabled={!state.dirtyEditors.includes('draft')} onClick={() => saveDraft(subject, body)} className={`${buttonClass} mt-3 border border-zinc-300 bg-white`}><Save className="size-4" /> Save draft only</button><p className="mt-2 text-xs text-zinc-500">Preview only. Saving, approving, copying, or downloading does not send a message.</p></div>
    {state.calculation?.excludedCount ? <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4"><h3 className="font-semibold">Excluded records</h3><ul className="mt-2 space-y-2 text-xs text-zinc-600">{state.calculation.matches.filter((match) => match.status === 'excluded').map((match) => <li key={match.recordId}><b>{match.recordId}</b>: {match.exclusionReason}</li>)}</ul></div> : null}
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"><button disabled={state.status !== 'review' || state.calculation?.revision !== state.batch.revision} onClick={() => dispatch({ type: 'MARK_RESULTS_REVIEWED' })} className={`${buttonClass} border border-zinc-300 bg-white`}><Check className="size-4" /> {state.resultsReviewed ? 'Results reviewed' : 'Review numeric results'}</button><button disabled={state.status !== 'review' || state.calculation?.revision !== state.batch.revision || state.batch.drafts.some((item) => item.stale)} onClick={() => dispatch({ type: 'MARK_DRAFTS_REVIEWED' })} className={`${buttonClass} border border-zinc-300 bg-white`}><Check className="size-4" /> {state.draftsReviewed ? 'Draft reviewed' : 'Review draft'}</button></div>
    <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4"><h3 className="font-semibold">Approval gate</h3>{blockers.length ? <ul className="mt-2 space-y-1 text-sm text-zinc-700">{blockers.map((blocker) => <li key={blocker} className="flex gap-2"><ChevronRight className="mt-0.5 size-4 shrink-0" />{blocker}</li>)}</ul> : <p className="mt-2 text-sm text-emerald-800">All current-version checks passed.</p>}<button disabled={blockers.length > 0} onClick={approve} className={`${buttonClass} mt-4 w-full bg-zinc-950 text-white`}><ShieldCheck className="size-4" /> Approve v{state.batch.revision}</button>{state.role !== 'manager' && <button onClick={approve} className="mt-2 w-full text-xs font-medium text-zinc-500 underline">Demonstrate reducer refusal as operator</button>}</div>
    {currentApproval && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-sm font-semibold text-emerald-900">Approved v{currentApproval.revision}</p><p className="mt-1 text-xs text-emerald-800">For export and manual follow-up only. No sending or payment authorization.</p>{state.role !== 'manager' && <p className="mt-2 text-xs font-semibold text-red-800">Manager role is required to export or revoke this approval.</p>}<div className="mt-3 grid grid-cols-3 gap-2">{(['json', 'csv', 'txt'] as const).map((kind) => <button key={kind} disabled={!canExport(state)} onClick={() => exportApproval(kind)} className={`${buttonClass} bg-white text-zinc-900 shadow-sm`}><Download className="size-4" />{kind.toUpperCase()}</button>)}</div><button disabled={state.role !== 'manager'} onClick={() => dispatch({ type: 'REVOKE_APPROVAL', at: new Date().toISOString() })} className="mt-3 text-xs font-semibold text-red-700 underline disabled:opacity-45">Revoke current approval</button></div>}
    <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4"><h3 className="flex items-center gap-2 font-semibold"><History className="size-4" /> Version history</h3><div className="mt-2 max-h-32 space-y-2 overflow-auto text-xs text-zinc-600">{state.changes.length ? [...state.changes].reverse().map((change) => <p key={change.eventId}><b>v{change.revision}</b> {change.action} · {change.reason}</p>) : <p>No user changes yet.</p>}{state.approvalHistory.map((approval) => <p key={approval.approvalId}><b>Approval v{approval.revision}</b> {approval.invalidatedAt ? `invalidated by v${approval.invalidatedByRevision}` : 'current'}</p>)}</div></div>
    <div className="mt-4 flex flex-wrap gap-2"><button disabled={Boolean(state.dirtyEditors.length)} onClick={downloadWorkingCopy} className={`${buttonClass} border border-zinc-300 bg-white`}><Download className="size-4" /> Save UNAPPROVED copy</button><label className={`${buttonClass} cursor-pointer border border-zinc-300 bg-white`}>Restore copy<input type="file" accept="application/json,.json" onChange={importWorkingCopy} className="sr-only" /></label><button onClick={resetDemoSession} className={`${buttonClass} border border-red-200 bg-red-50 text-red-800`}>Reset demo session</button></div><p className="mt-3 text-xs leading-5 text-zinc-500">Session memory only. Refresh loses unexported progress. Host Analytics and whole-app offline claims require integration verification.</p>
  </aside>
}
