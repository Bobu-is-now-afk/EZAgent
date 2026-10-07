import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allWorkflowItems,
  buildWorkflowExplanationCard,
  buildWorkflowPrompt,
  canApplyCandidate,
  confirmWorkflow,
  confirmWorkflowPreviewParameter,
  isWorkflowConfirmed,
  mergeOrganizedRequirement,
  migrateStoredWorkflow,
  organizeRequirement,
  parseWorkflowBackup,
  renameWorkflow,
  removeWorkflowItem,
  summarizeWorkflow,
  updateWorkflowItem,
  updateWorkflowPreviewParameter,
  workflowValidationErrors,
  type WorkflowConfig,
} from '../../lib/yolanda-review/workflow-config'

const receiptRequirement = 'Organize monthly receipts, extract date, merchant, and amount. Ask me when information is missing and create a table.'

function confirmReceipt(config = organizeRequirement(receiptRequirement, 'workflow-test', 'en')) {
  let current = config
  current = confirmWorkflowPreviewParameter(current, 'dateInterpretation')
  current = confirmWorkflowPreviewParameter(current, 'acceptedCurrencies')
  current = confirmWorkflowPreviewParameter(current, 'missingMerchantHandling')
  return confirmWorkflow(current, '2026-10-07T00:00:00.000Z')
}

test('workflow confirmation requires every structured preview decision', () => {
  const config = organizeRequirement(receiptRequirement, 'workflow-test', 'en')
  assert.equal(isWorkflowConfirmed(config), false)
  assert.match(workflowValidationErrors(config).join(' '), /Confirm every key setting/)
  assert.throws(() => confirmWorkflow(config), /Confirm every key setting/)
  assert.equal(isWorkflowConfirmed(confirmReceipt(config)), true)
})

test('receipt template defaults remain suggestions rather than explicit user requirements', () => {
  const config = organizeRequirement('Organize receipts into a table.', 'workflow-source', 'en')
  assert.equal(allWorkflowItems(config).find((value) => value.id === 'receipt-fields')?.source, 'template-default')
  assert.equal(config.previewParameters?.acceptedCurrencies.source, 'template-default')
})

test('editing a rule advances one revision and invalidates confirmation', () => {
  const confirmed = confirmReceipt()
  const edited = updateWorkflowItem(confirmed, 'receipt-records', 'Keep one auditable row per receipt.')
  assert.equal(edited.revision, confirmed.revision + 1)
  assert.equal(edited.confirmation.revision, undefined)
  assert.equal(isWorkflowConfirmed(edited), false)
  assert.equal(allWorkflowItems(edited).find((value) => value.id === 'receipt-records')?.source, 'user-edit')
  assert.equal(allWorkflowItems(edited).find((value) => value.id === 'receipt-records')?.mapping.status, 'recorded-only')
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

test('summary card, prompt, and serialized configuration share structured parameters', () => {
  const config = updateWorkflowPreviewParameter(organizeRequirement(receiptRequirement, 'workflow-test', 'en'), 'acceptedCurrencies', ['HKD', 'USD'])
  const prompt = buildWorkflowPrompt(config)
  const card = buildWorkflowExplanationCard(config)
  const saved = JSON.stringify(config)
  assert.match(prompt, /HKD, USD/)
  assert.match(card.result, /HKD, USD/)
  assert.match(saved, /"USD"/)
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
  current = updateWorkflowPreviewParameter(current, 'dateInterpretation', 'MM/DD/YYYY')
  const candidate = organizeRequirement('Organize receipts and create a table.', 'candidate', 'en')
  const merged = mergeOrganizedRequirement(current, candidate)
  assert.equal(allWorkflowItems(merged).find((value) => value.id === 'receipt-records')?.text, 'Keep the original receipt order.')
  assert.equal(merged.previewParameters?.dateInterpretation.value, 'MM/DD/YYYY')
  assert.equal(merged.previewParameters?.dateInterpretation.source, 'user-edit')
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
  assert.equal(imported.previewParameters?.dateInterpretation.confirmation, 'pending')
  assert.equal(isWorkflowConfirmed(imported), false)
})

test('legacy 1.0 import retains rules and creates pending preview parameters', () => {
  const current = confirmReceipt()
  const legacy = JSON.stringify({ ...current, schemaVersion: '1.0', previewParameters: undefined })
  const imported = parseWorkflowBackup(legacy)
  assert.equal(imported.schemaVersion, '1.1')
  assert.equal(imported.rules.length, current.rules.length)
  assert.equal(imported.previewParameters?.acceptedCurrencies.confirmation, 'pending')
  assert.deepEqual(imported.confirmation, {})
})

test('legacy browser records are migrated before prompt and rule rendering', () => {
  const current = organizeRequirement(receiptRequirement, 'legacy-browser-record', 'en')
  const withoutMappings = (values: typeof current.rules) => values.map(({ mapping: _mapping, ...value }) => value)
  const legacy = {
    ...current,
    schemaVersion: '1.0',
    previewParameters: undefined,
    inputs: withoutMappings(current.inputs),
    rules: withoutMappings(current.rules),
    outputs: withoutMappings(current.outputs),
  } as unknown as WorkflowConfig
  const migrated = migrateStoredWorkflow(legacy)
  assert.doesNotThrow(() => buildWorkflowPrompt(migrated))
  assert.equal(migrated.schemaVersion, '1.1')
  assert.equal(allWorkflowItems(migrated).every((value) => value.mapping.status === 'recorded-only'), true)
  assert.equal(migrated.previewParameters?.dateInterpretation.confirmation, 'pending')
  assert.deepEqual(migrated.confirmation, {})
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
