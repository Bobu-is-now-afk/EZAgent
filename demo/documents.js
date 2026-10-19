(() => {
  'use strict'

  const supportedCurrencies = ['USD', 'HKD', 'EUR', 'GBP']
  const fieldKeys = ['sellerName', 'buyer', 'date', 'currency', 'description', 'quantity', 'unitPrice', 'taxMode']
  const currencySymbols = { USD: '$', HKD: 'HK$', EUR: '€', GBP: '£' }
  const labels = {
    sellerName: 'Prepared by', buyer: 'Buyer', date: 'Valid until', currency: 'Currency',
    description: 'Line item', quantity: 'Quantity', unitPrice: 'Unit price', taxMode: 'Tax treatment', taxRate: 'Tax rate',
  }
  const proposalFields = { buyer: 'buyer', description: 'description', quantity: 'quantity' }
  const $ = (selector) => document.querySelector(selector)
  const inputs = Object.fromEntries([...document.querySelectorAll('[data-field]')].map((input) => [input.dataset.field, input]))
  const confirmed = Object.fromEntries([...fieldKeys, 'taxRate'].map((key) => [key, false]))
  const origins = Object.fromEntries([...fieldKeys, 'taxRate'].map((key) => [key, 'Synthetic sample']))
  let documentType = 'quotation'
  let draft = emptyDraft()
  let suggestion = null
  let proposalStatus = 'Pre-scripted suggestions are ready. No AI service is contacted.'
  let suggestionState = 'idle'
  let sampleRun = 0

  function emptyDraft() {
    return { sellerName: '', buyer: '', date: '', currency: '', description: '', quantity: '', unitPrice: '', taxMode: '', taxRate: '' }
  }

  function setAllUnconfirmed() {
    for (const key of [...fieldKeys, 'taxRate']) confirmed[key] = false
  }

  function toMinorUnits(value) {
    const text = String(value ?? '').trim()
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
    const [whole, fraction = ''] = text.split('.')
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
    return Number.isSafeInteger(amount) ? amount : null
  }

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  }

  function valueErrors() {
    const errors = []
    if (!draft.sellerName.trim()) errors.push('Prepared by')
    if (!draft.buyer.trim()) errors.push(documentType === 'receipt' ? 'Customer' : 'Buyer')
    if (!validDate(draft.date)) errors.push(documentType === 'receipt' ? 'Document date' : 'Valid until date')
    if (!supportedCurrencies.includes(draft.currency)) errors.push('Currency')
    if (!draft.description.trim()) errors.push('Line item description')
    const quantity = Number(draft.quantity)
    if (!draft.quantity || !Number.isSafeInteger(quantity) || quantity <= 0) errors.push('Positive whole-number quantity')
    const unitMinor = toMinorUnits(draft.unitPrice)
    if (unitMinor === null) errors.push('Non-negative unit price (up to two decimals)')
    if (!['none', 'rate'].includes(draft.taxMode)) errors.push('Tax treatment')
    if (draft.taxMode === 'rate' && (!/^\d+(\.\d{1,2})?$/.test(draft.taxRate.trim()) || !Number.isFinite(Number(draft.taxRate)) || Number(draft.taxRate) > 100)) {
      errors.push('Tax rate from 0 to 100%')
    }
    if (Number.isSafeInteger(quantity) && quantity > 0 && unitMinor !== null && !Number.isSafeInteger(quantity * unitMinor)) errors.push('Amount is outside the supported range')
    if (documentType === 'receipt') errors.push('Payment proof (not provided in this synthetic demo)')
    return errors
  }

  function fieldErrorLabel(key) {
    if (key === 'buyer' && documentType === 'receipt') return 'Customer'
    if (key === 'date' && documentType === 'receipt') return 'Document date'
    return labels[key]
  }

  function requiredKeys() {
    return draft.taxMode === 'rate' ? [...fieldKeys, 'taxRate'] : fieldKeys
  }

  function unconfirmedLabels() {
    return requiredKeys().filter((key) => !confirmed[key]).map((key) => labels[key] || key)
  }

  function calculate() {
    if (!supportedCurrencies.includes(draft.currency) || !['none', 'rate'].includes(draft.taxMode)) return null
    const quantity = Number(draft.quantity)
    const unitMinor = toMinorUnits(draft.unitPrice)
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || unitMinor === null) return null
    const subtotalMinor = quantity * unitMinor
    if (!Number.isSafeInteger(subtotalMinor)) return null
    let taxMinor = 0
    if (draft.taxMode === 'rate') {
      if (!/^\d+(\.\d{1,2})?$/.test(draft.taxRate.trim()) || !Number.isFinite(Number(draft.taxRate)) || Number(draft.taxRate) > 100) return null
      const basisPoints = Math.round(Number(draft.taxRate) * 100)
      if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) return null
      taxMinor = Number((BigInt(subtotalMinor) * BigInt(basisPoints) + 5000n) / 10000n)
    }
    const totalMinor = subtotalMinor + taxMinor
    if (!Number.isSafeInteger(totalMinor)) return null
    return { subtotalMinor, taxMinor, totalMinor }
  }

  function money(minor, currency = draft.currency) {
    if (!supportedCurrencies.includes(currency) || !Number.isSafeInteger(minor)) return '—'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)
  }

  function setText(selector, text) {
    const element = $(selector)
    if (element) element.textContent = String(text)
  }

  function renderForm() {
    for (const key of [...fieldKeys, 'taxRate']) {
      if (inputs[key] && inputs[key].value !== String(draft[key] ?? '')) inputs[key].value = draft[key] ?? ''
      const wrap = document.querySelector(`[data-field-wrap="${key}"]`)
      if (!wrap) continue
      const status = wrap.querySelector('.field-source')
      const confirmButton = wrap.querySelector('[data-confirm]')
      const isConfirmed = Boolean(confirmed[key])
      const hasValue = Boolean(String(draft[key] ?? '').trim())
      const originLabel = origins[key] === 'Scripted suggestion' ? 'scripted suggestion' : origins[key] === 'Entered manually' ? 'entered manually' : origins[key] === 'Synthetic sample' ? 'synthetic sample' : 'not provided'
      status.textContent = isConfirmed ? `Confirmed · ${originLabel}` : (hasValue ? `${originLabel} · not confirmed` : 'Not provided')
      status.dataset.state = isConfirmed ? 'confirmed' : (hasValue ? 'pending' : 'missing')
      status.dataset.origin = origins[key] === 'Scripted suggestion' ? 'scripted' : 'local'
      confirmButton.textContent = isConfirmed ? 'Confirmed' : 'Confirm'
      confirmButton.setAttribute('aria-pressed', String(isConfirmed))
      confirmButton.disabled = isConfirmed || !hasValue || valueErrors().includes(fieldErrorLabel(key))
    }
    const receipt = documentType === 'receipt'
    $('#buyer-label').textContent = receipt ? 'Customer' : 'Buyer'
    $('#date-label').textContent = receipt ? 'Document date' : 'Valid until'
    $('#tax-rate-field').hidden = draft.taxMode !== 'rate'
    $('#receipt-proof-note').hidden = !receipt
    $('#currency-symbol').textContent = currencySymbols[draft.currency] || '¤'
  }

  function renderProposal() {
    const result = $('#suggestion-result')
    result.replaceChildren()
    result.hidden = !suggestion
    if (!suggestion) return
    const intro = document.createElement('p')
    intro.className = 'proposal-intro'
    intro.textContent = 'Pre-scripted fields · fictional example'
    result.append(intro)
    const proposals = suggestion.suggestion
    for (const key of Object.keys(proposalFields)) {
      const value = proposals[key]
      if (value === null || value === undefined || String(value).trim() === '') continue
      const row = document.createElement('div')
      row.className = 'proposal-row'
      const copy = document.createElement('div')
      const label = document.createElement('span')
      label.textContent = `Proposed ${labels[key]}`
      const text = document.createElement('strong')
      text.textContent = String(value)
      copy.append(label, text)
      const apply = document.createElement('button')
      apply.type = 'button'
      apply.dataset.applyProposal = key
      apply.textContent = 'Apply proposal'
      apply.addEventListener('click', () => applyProposal(key, String(value)))
      row.append(copy, apply)
      result.append(row)
    }
    const missing = normalizeMissing(proposals.missing)
    if (missing.length) {
      const note = document.createElement('p')
      note.className = 'proposal-missing'
      note.textContent = `Not suggested · enter manually: ${missing.join(', ')}`
      result.append(note)
    }
  }

  function normalizeMissing(value) {
    if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    if (typeof value === 'string' && value.trim()) return [value.trim()]
    return []
  }

  function renderDocument() {
    const receipt = documentType === 'receipt'
    const result = calculate()
    const symbol = draft.currency || 'USD'
    const errors = valueErrors()
    const ready = errors.length === 0 && unconfirmedLabels().length === 0 && result !== null
    setText('#paper-overline', receipt ? 'SYNTHETIC RECEIPT' : 'SYNTHETIC QUOTATION')
    setText('#paper-title', receipt ? 'Receipt' : 'Quotation')
    setText('#paper-from-label', receipt ? 'RECEIVED BY' : 'PREPARED BY')
    setText('#paper-to-label', receipt ? 'FROM CUSTOMER' : 'PREPARED FOR')
    setText('#paper-date-label', receipt ? 'DOCUMENT DATE' : 'VALID UNTIL')
    setText('#paper-from', draft.sellerName || 'Missing value')
    setText('#paper-to', draft.buyer || 'Missing value')
    setText('#paper-date', draft.date || 'Missing date')
    setText('#paper-currency', draft.currency || 'Currency missing')
    setText('#paper-description', draft.description || 'Missing line item')
    setText('#paper-quantity', draft.quantity || '—')
    setText('#paper-unit-price', money(toMinorUnits(draft.unitPrice) ?? NaN, symbol))
    setText('#paper-subtotal', result ? money(result.subtotalMinor, symbol) : '—')
    setText('#subtotal', result ? money(result.subtotalMinor, symbol) : '—')
    setText('#tax', result ? money(result.taxMinor, symbol) : '—')
    setText('#total', result ? money(result.totalMinor, symbol) : '—')
    $('#receipt-disclaimer').hidden = !receipt
    const status = $('#preview-status')
    status.textContent = ready ? 'REVIEWED SAMPLE' : (errors.length ? 'INCOMPLETE DRAFT' : 'REVIEW PENDING')
    status.dataset.state = ready ? 'ready' : 'pending'
    $('#print-button').disabled = !ready
    $('#print-note').textContent = ready
      ? 'Print opens the browser dialog. Choose “Save as PDF” for a local sample copy.'
      : 'Confirm every required field and resolve missing values before printing this SAMPLE.'
    renderPrintDocument(result, receipt)
  }

  function renderReadiness() {
    const errors = valueErrors()
    const unconfirmed = unconfirmedLabels()
    const box = $('#missing-fields')
    box.replaceChildren()
    const ready = errors.length === 0 && unconfirmed.length === 0 && calculate() !== null
    box.dataset.ready = String(ready)
    const title = document.createElement('strong')
    title.textContent = ready ? 'All required fields confirmed' : 'Preview and print are locked'
    box.append(title)
    const details = document.createElement('span')
    if (errors.length) details.textContent = `Missing or invalid: ${errors.join('; ')}.`
    else if (unconfirmed.length) details.textContent = `Needs your confirmation: ${unconfirmed.join('; ')}.`
    else details.textContent = 'A person reviewed the values and deterministic totals.'
    box.append(details)
    $('#confirm-all').disabled = errors.length > 0
  }

  function renderRunNote() {
    const result = calculate()
    setText('#run-count', String(sampleRun).padStart(2, '0'))
    setText('#run-note', result ? (sampleRun ? `Same inputs · ${money(result.totalMinor)}` : `Ready · ${money(result.totalMinor)}`) : (sampleRun ? 'No total · inputs required' : 'Inputs required · no total'))
  }

  function renderSuggestionStatus() {
    const status = $('#suggestion-status')
    status.textContent = proposalStatus
    status.dataset.state = suggestionState
  }

  function render() {
    renderForm()
    renderProposal()
    renderSuggestionStatus()
    renderReadiness()
    renderDocument()
    renderRunNote()
  }

  function applyProposal(key, value) {
    const field = proposalFields[key]
    if (!field) return
    draft[field] = value
    confirmed[field] = false
    origins[field] = 'Scripted suggestion'
    proposalStatus = `Applied proposed ${labels[field]}; it remains unconfirmed until you review it.`
    suggestionState = 'ready'
    render()
    inputs[field]?.focus()
  }

  function requestSuggestions() {
    const button = $('#suggest-button')
    suggestion = { suggestion: { buyer: null, description: 'workshop days', quantity: 2, missing: ['buyer'] } }
    suggestionState = 'ready'
    proposalStatus = 'Pre-scripted suggestions are ready. Apply any field you want to review; nothing was auto-filled or sent to an AI service.'
    button.disabled = false
    render()
  }

  function makeNode(tag, className, text) {
    const element = document.createElement(tag)
    if (className) element.className = className
    if (text !== undefined) element.textContent = String(text)
    return element
  }

  function renderPrintDocument(result, receipt) {
    const root = $('#print-document')
    root.replaceChildren()
    const top = makeNode('div', 'print-top')
    top.append(makeNode('span', '', 'SAMPLE STUDIO'), makeNode('span', '', 'SAMPLE'))
    root.append(top)
    root.append(makeNode('p', 'print-kicker', `SYNTHETIC ${receipt ? 'RECEIPT' : 'QUOTATION'} · NO NUMBER`))
    root.append(makeNode('h1', '', receipt ? 'Receipt' : 'Quotation'))
    const parties = makeNode('div', 'print-parties')
    const from = makeNode('div')
    from.append(makeNode('span', '', receipt ? 'RECEIVED BY' : 'PREPARED BY'), makeNode('strong', '', draft.sellerName))
    const to = makeNode('div')
    to.append(makeNode('span', '', receipt ? 'FROM CUSTOMER' : 'PREPARED FOR'), makeNode('strong', '', draft.buyer))
    parties.append(from, to)
    root.append(parties)
    const date = makeNode('div', 'print-date')
    date.append(makeNode('span', '', receipt ? 'DOCUMENT DATE' : 'VALID UNTIL'), makeNode('strong', '', draft.date), makeNode('span', '', `Currency · ${draft.currency}`))
    root.append(date)
    const items = makeNode('div', 'print-items')
    const item = makeNode('div')
    item.append(makeNode('span', '', `${draft.description} × ${draft.quantity}`), makeNode('strong', '', result ? money(result.subtotalMinor) : '—'))
    items.append(item)
    root.append(items)
    const totals = makeNode('div', 'print-totals')
    for (const [label, amount] of [['Subtotal', result ? money(result.subtotalMinor) : '—'], ['Tax', result ? money(result.taxMinor) : '—'], ['Total', result ? money(result.totalMinor) : '—']]) {
      const row = makeNode('div')
      row.append(makeNode('span', '', label), makeNode('strong', '', amount))
      totals.append(row)
    }
    root.append(totals)
    if (receipt) root.append(makeNode('p', 'print-disclaimer', 'Fictional example only · Not proof of payment'))
    root.append(makeNode('p', 'print-foot', 'Synthetic demonstration · Draft only · Not issued · No payment requested'))
  }

  function updateField(key, value) {
    draft[key] = value
    confirmed[key] = false
    origins[key] = value.trim() ? 'Entered manually' : 'Not provided'
    render()
  }

  document.querySelectorAll('[data-type]').forEach((button) => button.addEventListener('click', () => {
    documentType = button.dataset.type
    document.querySelectorAll('[data-type]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)))
    setAllUnconfirmed()
    render()
  }))

  document.querySelectorAll('[data-field]').forEach((input) => {
    const eventName = input.tagName === 'SELECT' || input.type === 'date' ? 'change' : 'input'
    input.addEventListener(eventName, () => updateField(input.dataset.field, input.value))
  })

  document.querySelectorAll('[data-confirm]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.confirm
    if (!String(draft[key] ?? '').trim() || valueErrors().includes(labels[key])) return
    confirmed[key] = true
    render()
  }))

  $('#confirm-all').addEventListener('click', () => {
    if (valueErrors().length) return
    for (const key of requiredKeys()) confirmed[key] = true
    render()
  })

  $('#blank-button').addEventListener('click', () => {
    draft = emptyDraft()
    suggestion = null
    setAllUnconfirmed()
    for (const key of [...fieldKeys, 'taxRate']) origins[key] = 'Not provided'
    render()
  })

  $('#rerun-button').addEventListener('click', () => {
    suggestion = null
    setAllUnconfirmed()
    sampleRun += 1
    suggestionState = 'idle'
    proposalStatus = 'Deterministic calculation rerun. The current inputs are unchanged; all confirmations were cleared for review.'
    render()
  })

  $('#suggest-button').addEventListener('click', requestSuggestions)
  $('#print-button').addEventListener('click', () => {
    const ready = valueErrors().length === 0 && unconfirmedLabels().length === 0 && calculate() !== null
    if (ready) window.print()
  })

  render()
})()
