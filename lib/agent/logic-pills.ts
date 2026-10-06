import type { WorkflowDefinition } from './contracts'

const INVOICE_FIELD_ORDER = ['invoice_id', 'customer', 'amount', 'currency', 'description'] as const

export type LogicPill = {
  id: string
  label: string
  type: 'number' | 'text' | 'tags' | 'select'
  value: number | string | string[]
  options?: string[]
}

export function isLogicPills(value: unknown): value is LogicPill[] {
  if (!Array.isArray(value) || value.length > 100) return false
  const ids = new Set<string>()
  return value.every((p) => {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id || ids.has(p.id) || typeof p.label !== 'string' || !p.label.trim()) return false
    ids.add(p.id)
    if (p.options !== undefined && (!Array.isArray(p.options) || !p.options.every((v: unknown) => typeof v === 'string'))) return false
    if (p.type === 'number') return typeof p.value === 'number' && Number.isFinite(p.value)
    if (p.type === 'text') return typeof p.value === 'string'
    if (p.type === 'tags') return Array.isArray(p.value) && p.value.every((v: unknown) => typeof v === 'string' && v.trim()) && new Set(p.value).size === p.value.length
    return p.type === 'select' && typeof p.value === 'string' && Array.isArray(p.options) && p.options.includes(p.value)
  })
}

export function deriveLogicPills(workflow: WorkflowDefinition): LogicPill[] {
  return workflow.steps.flatMap((step) => Object.entries(step.parameters ?? {}).flatMap(([key, value]): LogicPill[] => {
    const id = `step:${step.id}:${key}`
    const label = `${step.id} · ${key}${key === 'thresholdMinor' ? '（最小貨幣單位）' : ''}`
    if (typeof value === 'number') return [{ id, label, type: 'number', value }]
    if (typeof value === 'string') return [{ id, label, type: 'text', value }]
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return [{ id, label, type: 'tags', value }]
    return []
  }))
}

function sameValue(left: LogicPill['value'], right: LogicPill['value']): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index])
  }
  return left === right
}

export function logicPillsMatchWorkflow(workflow: WorkflowDefinition): boolean {
  if (workflow.pills === undefined) return true
  const expected = new Map(deriveLogicPills(workflow).map((pill) => [pill.id, pill]))
  const actual = new Map(workflow.pills.map((pill) => [pill.id, pill]))
  if (expected.size !== [...expected.keys()].filter((id) => actual.has(id)).length) return false
  for (const pill of workflow.pills) {
    const bound = expected.get(pill.id)
    if (!bound) {
      if (pill.id.startsWith('step:')) return false
      continue
    }
    if (pill.type !== bound.type || !sameValue(pill.value, bound.value) || pill.options !== undefined) return false
  }
  return true
}

// Bind only known step parameter IDs. Custom pills remain plan annotations;
// they never grant a tool capability or bypass server validation.
export function applyLogicPills(workflow: WorkflowDefinition, pills: LogicPill[]) {
  const errors: string[] = []
  if (!isLogicPills(pills)) errors.push('請檢查 pill 名稱、數值、標籤與選項。')
  const next: WorkflowDefinition = structuredClone(workflow)
  next.pills = structuredClone(pills)
  for (const original of deriveLogicPills(workflow)) {
    const pill = pills.find(({ id }) => id === original.id)
    const step = next.steps.find((s) => original.id.startsWith(`step:${s.id}:`))!
    const key = original.id.slice(`step:${step.id}:`.length)
    if (!pill) {
      delete step.parameters?.[key]
      errors.push(`缺少工具參數：${original.label}。請還原提案或重新規劃。`)
      continue
    }
    if (pill.type !== original.type || typeof pill.value !== typeof original.value || Array.isArray(pill.value) !== Array.isArray(original.value)) {
      errors.push(`參數型別不相容：${pill.label}`)
      continue
    }
    let pillValue: LogicPill['value'] = pill.value
    if (key === 'fields' && Array.isArray(pill.value)) {
      const fieldOrder = new Map<string, number>(INVOICE_FIELD_ORDER.map((field, index) => [field, index]))
      if (pill.value.some((field) => !fieldOrder.has(field))) {
        errors.push('必填欄位包含 invoice 流程不支援的欄位。')
      } else {
        pillValue = [...pill.value].sort((left, right) => fieldOrder.get(left)! - fieldOrder.get(right)!)
        const storedFieldsPill = next.pills?.find((candidate) => candidate.id === original.id)
        if (storedFieldsPill?.type === 'tags') storedFieldsPill.value = pillValue
      }
    }
    step.parameters = { ...step.parameters, [key]: pillValue }
    if (key === 'thresholdMinor' && typeof pillValue === 'number') next.parameters.thresholdMinor = pillValue
    if (key === 'currency' && typeof pillValue === 'string') next.parameters.currency = pillValue
    const sync = (criteria: WorkflowDefinition['acceptance']) => criteria.map((criterion) => {
      if (key === 'thresholdMinor' && criterion.type === 'minimum_amount_minor') return { ...criterion, thresholdMinor: pillValue as number }
      if (key === 'currency' && criterion.type === 'currency_exact') return { ...criterion, currency: pillValue as string }
      if (key === 'fields' && criterion.type === 'required_fields') return { ...criterion, fields: pillValue as string[] }
      return criterion
    })
    step.acceptance = sync(step.acceptance)
    next.acceptance = sync(next.acceptance)
  }
  const fieldsPillId = 'step:validate:fields'
  const columnsPillId = 'step:export:columns'
  const editedFields = next.steps.find((step) => step.tool === 'validate_required_fields')?.parameters?.fields
  const editedColumnsPill = pills.find((pill) => pill.id === columnsPillId)
  if (Array.isArray(editedFields) && editedFields.every((field) => typeof field === 'string') && Array.isArray(editedColumnsPill?.value) && editedColumnsPill.value.every((column) => typeof column === 'string')) {
    const requestedColumns = editedColumnsPill.value as string[]
    const allowedColumns = new Set([...editedFields, 'description', 'source_file', 'source_row', 'validation_status'])
    if (requestedColumns.some((column) => !allowedColumns.has(column))) errors.push('CSV 匯出欄位包含 invoice 流程不支援的欄位。')
    const includeDescription = editedFields.includes('description') || requestedColumns.includes('description')
    const expectedColumns = [...new Set([
      ...editedFields,
      ...(includeDescription ? ['description'] : []),
      'source_file', 'source_row', 'validation_status',
    ])]
    const exportStep = next.steps.find((step) => step.tool === 'export_csv')
    if (exportStep) exportStep.parameters = { ...exportStep.parameters, columns: expectedColumns }
    const storedColumnsPill = next.pills?.find((pill) => pill.id === columnsPillId)
    if (storedColumnsPill?.type === 'tags') storedColumnsPill.value = expectedColumns
  }
  if (!logicPillsMatchWorkflow(next)) errors.push('Logic Pills 與 workflow 工具參數不一致。請修正或還原提案。')
  return { workflow: next, errors }
}
