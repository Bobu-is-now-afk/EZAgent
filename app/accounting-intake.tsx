'use client'

import { useState } from 'react'
import { FileText, Upload } from 'lucide-react'

export type IntakeEntry = { date: string; type: 'income' | 'expense'; description: string; amount: string }

function parseDescription(text: string, month: string): IntakeEntry {
  const amount = text.match(/(?:HK\$|NT\$|US\$|HKD|TWD|USD|\$)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:HKD|TWD|USD|dollars?|元|塊)|(?:paid|spent|received|earned|cost|total|amount|花了|支付|收到|合計|總額)\s*[:：]?\s*([\d,]+(?:\.\d{1,2})?)/i)
  const date = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/)
  const parsedDate = date ? `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` : `${month}-15`
  const income = /\b(received|earned|income|revenue|sale|paid me|customer paid)\b|收入|收款|收到|營收|入帳/i.test(text)
  return { date: parsedDate, type: income ? 'income' : 'expense', description: text.trim().replace(/\s+/g, ' ').slice(0, 90), amount: (amount?.[1] || amount?.[2] || amount?.[3] || '').replaceAll(',', '') }
}

export default function AccountingIntake({ month, onAdd }: { month: string; onAdd: (entry: IntakeEntry) => void }) {
  const [mode, setMode] = useState<'receipt' | 'words'>('receipt')
  const [words, setWords] = useState('')
  const [candidate, setCandidate] = useState<IntakeEntry | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  function prepareText(text: string) {
    if (!text.trim()) { setMessage('Describe the transaction first.'); return }
    setCandidate(parseDescription(text, /^\d{4}-\d{2}$/.test(month) ? month : '2026-10'))
    setMessage('Check the date, type, description and amount before adding it. If no date is found, the 15th of the selected month is suggested.')
  }

  async function handleFile(file?: File) {
    if (!file) return
    setCandidate(null)
    setMessage('Reading receipt in your browser…')
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') { setMessage('Choose an image or PDF receipt.'); return }
    if (file.size > 10 * 1024 * 1024) { setMessage('Choose a file smaller than 10 MB.'); return }
    setBusy(true)
    try {
      let extracted = ''
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
        const document = await loadingTask.promise
        try {
          for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 5); pageNumber++) {
            const page = await document.getPage(pageNumber)
            const content = await page.getTextContent()
            extracted += content.items.map((item) => 'str' in item ? item.str : '').join(' ') + '\n'
          }
        } finally { await loadingTask.destroy() }
        if (!extracted.trim()) { setMessage('This PDF has no selectable text. Enter the receipt details using Vague wording.'); return }
      } else {
        const { createWorker } = await import('tesseract.js')
        const worker = await createWorker('eng+chi_tra')
        try { extracted = (await worker.recognize(file)).data.text } finally { await worker.terminate() }
        if (!extracted.trim()) { setMessage('OCR could not read this image. Try a clearer photo or use Vague wording.'); return }
      }
      setCandidate(parseDescription(extracted, /^\d{4}-\d{2}$/.test(month) ? month : '2026-10'))
      setMessage(`Read ${file.name}. Check every suggested field before adding it; OCR and PDF extraction may miss details. If no date is found, the 15th is suggested.`)
    } catch {
      setMessage('Could not read this receipt. Try a clearer file or use Vague wording.')
    } finally { setBusy(false) }
  }

  return <div className="as-intake">
    <div className="as-intake-heading"><div><span className="eyebrow">ADD FROM SOURCE</span><h2>Turn a receipt or a rough note into an entry</h2><p>Review every suggested field before it reaches the statement.</p></div></div>
    <div className="as-intake-tabs" role="tablist" aria-label="Input method"><button type="button" role="tab" aria-selected={mode === 'receipt'} className={mode === 'receipt' ? 'selected' : ''} onClick={() => { setMode('receipt'); setCandidate(null); setMessage('') }}><Upload size={16} /> Upload receipt</button><button type="button" role="tab" aria-selected={mode === 'words'} className={mode === 'words' ? 'selected' : ''} onClick={() => { setMode('words'); setCandidate(null); setMessage('') }}><FileText size={16} /> Vague wording</button></div>
    {mode === 'receipt' ? <div className="as-intake-body"><label className="as-upload">Choose receipt image or PDF<input type="file" accept="image/*,application/pdf,.pdf" disabled={busy} onChange={(event) => void handleFile(event.target.files?.[0])} /></label><small>Image: browser OCR. Text PDF: browser text extraction. Maximum 10 MB; first 5 PDF pages.</small></div> : <div className="as-intake-body"><label>Describe what happened<textarea value={words} onChange={(event) => setWords(event.target.value)} placeholder="e.g. Paid HKD 180 for workshop supplies on 2026-10-14" rows={3} /></label><button type="button" className="as-intake-primary" onClick={() => prepareText(words)}>Suggest entry</button></div>}
    {message && <p className="as-intake-message" role="status">{message}</p>}
    {candidate && <div className="as-intake-review"><strong>Review suggested entry</strong><div className="as-entry-grid"><label>Date<input type="date" value={candidate.date} onChange={(event) => setCandidate({ ...candidate, date: event.target.value })} /></label><label>Type<select value={candidate.type} onChange={(event) => setCandidate({ ...candidate, type: event.target.value as IntakeEntry['type'] })}><option value="income">Income</option><option value="expense">Expense</option></select></label><label className="as-description">Description<input value={candidate.description} maxLength={90} onChange={(event) => setCandidate({ ...candidate, description: event.target.value })} /></label><label>Amount<input inputMode="decimal" value={candidate.amount} onChange={(event) => setCandidate({ ...candidate, amount: event.target.value })} placeholder="0.00" /></label></div><button type="button" className="as-intake-primary" disabled={!candidate.date || !candidate.description.trim() || !/^\d{1,7}(?:\.\d{1,2})?$/.test(candidate.amount) || Number(candidate.amount) > 1_000_000} onClick={() => { onAdd(candidate); setCandidate(null); setMessage('Entry added. It will appear in the statement if its date is in the selected month.') }}>Add reviewed entry</button></div>}
  </div>
}
