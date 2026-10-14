import { createHash } from 'node:crypto'

type CompletedPlan = {
  status: string
  planVersion: number
  sourceName: string
  sourceType: 'csv' | 'text'
  sourceSha256: string
}

export function matchesCompletedPlanBinding(input: {
  job: CompletedPlan | null
  binding: unknown
  source: unknown
}): boolean {
  const { job, binding, source } = input
  if (!job || job.status !== 'completed' || job.planVersion !== 1 || !binding || typeof binding !== 'object' || Array.isArray(binding) ||
      !source || typeof source !== 'object' || Array.isArray(source)) return false
  const plan = binding as Record<string, unknown>
  const selected = source as Record<string, unknown>
  if (plan.planVersion !== job.planVersion || plan.sourceSha256 !== job.sourceSha256 ||
      typeof selected.name !== 'string' || selected.name !== job.sourceName || selected.type !== job.sourceType || typeof selected.content !== 'string') return false
  const sourceSha256 = createHash('sha256').update(selected.content, 'utf8').digest('hex')
  return sourceSha256 === job.sourceSha256
}
