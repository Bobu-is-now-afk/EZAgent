export const AGENT_TOOL_IDS = [
  'parse_invoice_rows',
  'normalize_invoice_fields',
  'filter_invoice_rows',
  'validate_required_fields',
  'export_csv',
] as const

export type AgentToolId = (typeof AGENT_TOOL_IDS)[number]

export type SourceType = 'csv' | 'text'

export type WorkflowParameters = {
  thresholdMinor?: number
  currency?: string
}

export type ToolParameters =
  | { tool: 'parse_invoice_rows'; parameters?: Record<string, never> }
  | { tool: 'normalize_invoice_fields'; parameters?: Record<string, never> }
  | {
      tool: 'filter_invoice_rows'
      parameters: { thresholdMinor: number; currency: string }
    }
  | { tool: 'validate_required_fields'; parameters: { fields: string[] } }
  | { tool: 'export_csv'; parameters?: { columns?: string[] } }

export type AcceptanceCriterion =
  | { id: string; type: 'required_fields'; fields: string[] }
  | { id: string; type: 'currency_exact'; currency: string }
  | { id: string; type: 'minimum_amount_minor'; thresholdMinor: number }
  | { id: string; type: 'csv_formula_safe' }

export type WorkflowStep = {
  id: string
  dependencies: string[]
  tool: AgentToolId
  inputRefs: string[]
  parameters?: Record<string, unknown>
  acceptance: AcceptanceCriterion[]
}

export type WorkflowDefinition = {
  pills?: import('./logic-pills').LogicPill[]
  version: 1
  goal: string
  steps: WorkflowStep[]
  parameters: WorkflowParameters
  allowedTools: AgentToolId[]
  acceptance: AcceptanceCriterion[]
}

export type RunStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'running'
  | 'needs_input'
  | 'failed'
  | 'cancelling'
  | 'cancelled'
  | 'interrupted'
  | 'completed'

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'validating'
  | 'passed'
  | 'retry_pending'
  | 'needs_input'
  | 'failed'

export type ValidationResult = {
  pass: boolean
  code: string
  evidence: string[]
  retryable: boolean
}

export type ValidationOutcome = ValidationResult

export type Task = {
  id: string
  dependencies: string[]
  tool: AgentToolId
  inputRefs: string[]
  acceptance: AcceptanceCriterion[]
} & TaskState

export type SourceReference =
  | { fileName: string; rowNumber: number }
  | { fileName: string; lineNumber: number }

export type Artifact = {
  id: string
  type: string
  location: string
  sourceRefs: SourceReference[]
  validation: ValidationOutcome
}

export type Run = {
  id: string
  workflowVersion: number
  status: RunStatus
  limits: RunLimits
  currentTask: string | null
  createdAt: string
  updatedAt: string
  workflow: WorkflowDefinition
  taskStates: Record<string, TaskState>
  artifacts: Artifact[]
}

export type RunEvent = {
  id: string
  sequence: number
  runId: string
  taskId?: string
  time: string
  type: string
  payload: unknown
}

export type RunLimits = {
  maxActiveRuns: number
  maxModelRequests: number
  maxTasks: number
  maxAttemptsPerTask: number
  maxModelCallsPerRun: number
  modelRequestTimeoutMs: number
  runTimeoutMs: number
}

export const DEFAULT_RUN_LIMITS: Readonly<RunLimits> = Object.freeze({
  maxActiveRuns: 1,
  maxModelRequests: 1,
  maxTasks: 5,
  maxAttemptsPerTask: 3,
  maxModelCallsPerRun: 20,
  // Provisional finite values; measure on the demo machine before release.
  modelRequestTimeoutMs: 120_000,
  runTimeoutMs: 600_000,
})

export type TaskState =
  | { status: 'passed'; attempts: number; validation: ValidationResult }
  | { status: Exclude<TaskStatus, 'passed'>; attempts: number; validation?: ValidationResult }

export type ValidationIssue = {
  path: string
  code: string
  message: string
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] }
