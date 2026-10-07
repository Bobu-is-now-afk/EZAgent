import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmWorkflow, confirmWorkflowPreviewParameter, organizeRequirement } from '../../lib/yolanda-review/workflow-config'
import { canWorkflowAction, DEMO_WORKFLOW_IDENTITIES, normalizeWorkflowGovernance, stampWorkflowSave, updateWorkflowAccess } from '../../lib/yolanda-review/workflow-governance'

function confirmedWorkflow() {
  let config = organizeRequirement('Organize receipts and create a table. Ask when data is missing.', 'governed-workflow', 'en')
  config = confirmWorkflowPreviewParameter(config, 'dateInterpretation')
  config = confirmWorkflowPreviewParameter(config, 'acceptedCurrencies')
  config = confirmWorkflowPreviewParameter(config, 'missingMerchantHandling')
  return confirmWorkflow(config, '2026-10-07T00:00:00.000Z')
}

const staff = DEMO_WORKFLOW_IDENTITIES.find((identity) => identity.role === 'staff')!
const lead = DEMO_WORKFLOW_IDENTITIES.find((identity) => identity.role === 'lead')!
const manager = DEMO_WORKFLOW_IDENTITIES.find((identity) => identity.role === 'manager')!
const admin = DEMO_WORKFLOW_IDENTITIES.find((identity) => identity.role === 'admin')!

test('first save stamps immutable creator, organization, department, and modification time', () => {
  const first = stampWorkflowSave(confirmedWorkflow(), lead, '2026-10-07T01:00:00.000Z')
  const second = stampWorkflowSave(first, manager, '2026-10-07T02:00:00.000Z')
  assert.equal(first.governance.creatorName, 'Yolanda')
  assert.equal(first.governance.departmentName, 'Finance Operations')
  assert.equal(second.governance.creatorName, 'Yolanda')
  assert.equal(second.governance.updatedByName, 'Alex Wong')
  assert.equal(second.governance.createdAt, first.governance.createdAt)
  assert.equal(second.governance.updatedAt, '2026-10-07T02:00:00.000Z')
})

test('role policy separates run, edit, delete, and access management', () => {
  const config = stampWorkflowSave(confirmedWorkflow(), lead)
  assert.equal(canWorkflowAction(staff, 'run', config), true)
  assert.equal(canWorkflowAction(staff, 'edit', config), false)
  assert.equal(canWorkflowAction(lead, 'edit', config), true)
  assert.equal(canWorkflowAction(lead, 'delete', config), false)
  assert.equal(canWorkflowAction(manager, 'delete', config), true)
  assert.equal(canWorkflowAction(manager, 'manage-access', config), false)
  assert.equal(canWorkflowAction(admin, 'manage-access', config), true)
})

test('only organization admin can update access and edit remains at least as restrictive as run', () => {
  const config = stampWorkflowSave(confirmedWorkflow(), lead)
  assert.throws(() => updateWorkflowAccess(config, manager, 'lead', 'manager'), /administrator/)
  assert.throws(() => updateWorkflowAccess(config, admin, 'manager', 'lead'), /broader/)
  const changed = updateWorkflowAccess(config, admin, 'lead', 'manager', '2026-10-07T03:00:00.000Z')
  assert.equal(changed.revision, config.revision + 1)
  assert.equal(changed.confirmation.revision, changed.revision)
  assert.equal(canWorkflowAction(staff, 'run', changed), false)
  assert.equal(canWorkflowAction(lead, 'run', changed), true)
  assert.equal(canWorkflowAction(lead, 'edit', changed), false)
})

test('legacy governance remains unknown instead of inventing ownership history', () => {
  const governance = normalizeWorkflowGovernance(undefined)
  assert.equal(governance.creatorName, null)
  assert.equal(governance.updatedAt, null)
  assert.equal(governance.minimumRunRole, 'staff')
  assert.equal(governance.minimumEditRole, 'lead')
  const legacy = { ...confirmedWorkflow(), governance }
  assert.equal(canWorkflowAction(staff, 'view', legacy), true)
  assert.equal(canWorkflowAction(lead, 'edit', legacy), true)
})
