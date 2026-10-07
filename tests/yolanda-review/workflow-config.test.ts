import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allWorkflowItems,
  answerWorkflowQuestion,
  buildWorkflowPrompt,
  canApplyCandidate,
  confirmWorkflow,
  confirmWorkflowItem,
  isWorkflowConfirmed,
  mergeOrganizedRequirement,
  organizeRequirement,
  parseWorkflowBackup,
  renameWorkflow,
  removeWorkflowItem,
  summarizeWorkflow,
  updateWorkflowItem,
  workflowValidationErrors,
  type WorkflowConfig,
} from '../../lib/yolanda-review/workflow-config'

const receiptRequirement = 'Organize monthly receipts, extract date, merchant, and amount. Ask me when information is missing and create a table.'

function confirmReceipt(config = organizeRequirement(receiptRequirement, 'workflow-test', 'en')) {
  let current = config
  for (const value of allWorkflowItems(current)) {
    if (value.confirmation === 'pending') current = confirmWorkflowItem(current, value.id)
  }
  current = answerWorkflowQuestion(current, 'receipt-date-order', 'Use DD/MM/YYYY.')
  return confirmWorkflow(current, '2026-10-07T00:00:00.000Z')
}

test('workflow confirmation requires every critical question and inferred rule', () => {
  const config = organizeRequirement(receiptRequirement, 'workflow-test', 'en')
  assert.equal(isWorkflowConfirmed(config), false)
  assert.match(workflowValidationErrors(config).join(' '), /Resolve every required question/)
  assert.throws(() => confirmWorkflow(config), /Resolve every required question/)
  assert.equal(isWorkflowConfirmed(confirmReceipt(config)), true)
})

test('editing a rule advances one revision and invalidates confirmation', () => {
  const confirmed = confirmReceipt()
  const edited = updateWorkflowItem(confirmed, 'receipt-records', 'Keep one auditable row per receipt.')
  assert.equal(edited.revision, confirmed.revision + 1)
  assert.equal(edited.confirmation.revision, undefined)
  assert.equal(isWorkflowConfirmed(edited), false)
  assert.equal(allWorkflowItems(edited).find((value) => value.id === 'receipt-records')?.source, 'user-edit')
})

test('no-op rule edits and missing deletes do not advance revision', () => {
  const config = organizeRequirement(receiptRequirement, 'workflow-test', 'en')
  const rule = allWorkflowItems(config)[0]
  assert.equal(updateWorkflowItem(config, rule.id, `  ${rule.text}  `), config)
  assert.equal(removeWorkflowItem(config, 'missing-rule'), config)
})

test('renaming creates a version without invalidating confirmed behavior', () => {
  const config = confirmReceipt()
  const renamed = renameWorkflow(config, 'Monthly receipt review')
  assert.equal(renamed.revision, config.revision + 1)
  assert.equal(renamed.confirmation.revision, renamed.revision)
  assert.equal(isWorkflowConfirmed(renamed), true)
  assert.equal(renameWorkflow(renamed, 'Monthly receipt review'), renamed)
})

test('summary, prompt, and serialized configuration share the edited value', () => {
  const config = updateWorkflowItem(organizeRequirement(receiptRequirement, 'workflow-test', 'en'), 'receipt-fields', 'Extract date, merchant, total, and tax.')
  const prompt = buildWorkflowPrompt(config)
  const saved = JSON.stringify(config)
  assert.match(prompt, /Extract date, merchant, total, and tax/)
  assert.match(saved, /Extract date, merchant, total, and tax/)
  assert.equal(summarizeWorkflow(config).ruleCount, allWorkflowItems(config).length)
})

test('Traditional Chinese builder prompt localizes system headings and limits', () => {
  const config = organizeRequirement('幫我整理每個月的收據，缺少資訊時先問我，最後產生表格。', 'workflow-zh', 'zh-Hant')
  const prompt = buildWorkflowPrompt(config, 'zh-Hant')
  assert.match(prompt, /# 目標/)
  assert.match(prompt, /# 固定行為限制/)
  assert.match(prompt, /不得傳送訊息/)
  assert.equal(prompt.includes('# Fixed behavior limits'), false)
})

test('reorganizing preserves manually edited and manually answered rules', () => {
  let current = organizeRequirement(receiptRequirement, 'workflow-test', 'en')
  current = updateWorkflowItem(current, 'receipt-records', 'Keep the original receipt order.')
  current = answerWorkflowQuestion(current, 'receipt-date-order', 'Use DD/MM/YYYY.')
  const candidate = organizeRequirement('Organize receipts and create a table.', 'candidate', 'en')
  const merged = mergeOrganizedRequirement(current, candidate)
  assert.equal(allWorkflowItems(merged).find((value) => value.id === 'receipt-records')?.text, 'Keep the original receipt order.')
  assert.equal(merged.unresolvedQuestions.some((value) => value.id === 'receipt-date-order'), false)
  assert.equal(allWorkflowItems(merged).some((value) => value.id === 'answer-receipt-date-order'), true)
})

test('stale candidate responses are rejected by request and revision', () => {
  assert.equal(canApplyCandidate('request-2', 'request-2', 4, 4), true)
  assert.equal(canApplyCandidate('request-1', 'request-2', 4, 4), false)
  assert.equal(canApplyCandidate('request-2', 'request-2', 4, 5), false)
})

test('import validates content and clears confirmation and execution trust', () => {
  const original = confirmReceipt()
  const raw = JSON.stringify({ ...original, execution: { status: 'ready', note: 'Trusted elsewhere.' } })
  const imported = parseWorkflowBackup(raw)
  assert.equal(imported.revision, original.revision + 1)
  assert.deepEqual(imported.confirmation, {})
  assert.equal(imported.execution.status, 'not-connected')
  assert.equal(isWorkflowConfirmed(imported), false)
})

test('non-receipt drafts do not invent finance settings or trial-run support', () => {
  const config = organizeRequirement('Create a user registration workflow.', 'workflow-registration', 'en')
  assert.equal(config.templateId, null)
  assert.deepEqual(config.requiredCapabilities, ['workflow.custom'])
  assert.equal(config.execution.status, 'not-connected')
  assert.equal(JSON.stringify(config).includes('currency'), false)
  assert.equal(JSON.stringify(config).includes('tolerance'), false)
})

test('backup rejects duplicate IDs and unsupported schema versions', () => {
  const config = organizeRequirement(receiptRequirement, 'workflow-test', 'en')
  const duplicate = { ...config, rules: [...config.rules, { ...config.rules[0] }] }
  assert.throws(() => parseWorkflowBackup(JSON.stringify(duplicate)), /unique/)
  assert.throws(() => parseWorkflowBackup(JSON.stringify({ ...config, schemaVersion: '2.0' })), /Unsupported/)
})
