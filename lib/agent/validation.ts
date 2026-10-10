import { isLogicPills } from './logic-pills'
import {
  AGENT_TOOL_IDS,
  type AcceptanceCriterion,
  type AgentToolId,
  type Result,
  type RunLimits,
  type ValidationIssue,
  type ValidationResult,
  type WorkflowDefinition,
  type WorkflowParameters,
  type WorkflowStep,
} from './contracts'

const knownTools = new Set<string>(AGENT_TOOL_IDS)
const currencyPattern = /^[A-Z]{3}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message }
}

function validateCurrency(value: unknown, path: string, issues: ValidationIssue[]): value is string {
  if (typeof value !== 'string' || !currencyPattern.test(value)) {
    issues.push(issue(path, 'invalid_currency', 'Currency must be a three-letter uppercase code.'))
    return false
  }
  return true
}

function validateThreshold(value: unknown, path: string, issues: ValidationIssue[]): value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    issues.push(issue(path, 'invalid_threshold', 'Threshold must be a non-negative safe integer in minor units.'))
    return false
  }
  return true
}

function validateStringArray(value: unknown, path: string, issues: ValidationIssue[]): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isNonEmptyString)) {
    issues.push(issue(path, 'invalid_string_array', 'Expected a non-empty array of non-empty strings.'))
    return false
  }
  return true
}

function validateCriterion(value: unknown, path: string, issues: ValidationIssue[]): value is AcceptanceCriterion {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.type)) {
    issues.push(issue(path, 'invalid_acceptance', 'Acceptance criteria require an id and a supported type.'))
    return false
  }

  switch (value.type) {
    case 'required_fields': {
      if (!hasOnlyKeys(value, ['id', 'type', 'fields'])) {
        issues.push(issue(path, 'unknown_acceptance_field', 'Acceptance criterion contains an unsupported field.'))
        return false
      }
      return validateStringArray(value.fields, `${path}.fields`, issues)
    }
    case 'currency_exact':
      if (!hasOnlyKeys(value, ['id', 'type', 'currency'])) {
        issues.push(issue(path, 'unknown_acceptance_field', 'Acceptance criterion contains an unsupported field.'))
        return false
      }
      return validateCurrency(value.currency, `${path}.currency`, issues)
    case 'minimum_amount_minor':
      if (!hasOnlyKeys(value, ['id', 'type', 'thresholdMinor'])) {
        issues.push(issue(path, 'unknown_acceptance_field', 'Acceptance criterion contains an unsupported field.'))
        return false
      }
      return validateThreshold(value.thresholdMinor, `${path}.thresholdMinor`, issues)
    case 'csv_formula_safe':
      if (!hasOnlyKeys(value, ['id', 'type'])) {
        issues.push(issue(path, 'unknown_acceptance_field', 'Acceptance criterion contains an unsupported field.'))
        return false
      }
      return true
    default:
      issues.push(issue(`${path}.type`, 'unknown_acceptance_type', 'Acceptance criterion type is not supported.'))
      return false
  }
}

function validateToolParameters(
  tool: AgentToolId,
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): boolean {
  if (value === undefined) {
    if (tool === 'filter_invoice_rows' || tool === 'validate_required_fields') {
      issues.push(issue(path, 'missing_tool_parameters', 'This tool requires parameters.'))
      return false
    }
    return true
  }
  if (!isRecord(value)) {
    issues.push(issue(path, 'invalid_tool_parameters', 'Tool parameters must be an object.'))
    return false
  }

  switch (tool) {
    case 'parse_invoice_rows':
    case 'normalize_invoice_fields':
      if (Object.keys(value).length !== 0) {
        issues.push(issue(path, 'unknown_tool_parameter', 'This tool does not accept parameters.'))
        return false
      }
      return true
    case 'filter_invoice_rows': {
      let valid = hasOnlyKeys(value, ['thresholdMinor', 'currency'])
      if (!valid) issues.push(issue(path, 'unknown_tool_parameter', 'Filter parameters contain an unsupported field.'))
      valid = validateThreshold(value.thresholdMinor, `${path}.thresholdMinor`, issues) && valid
      valid = validateCurrency(value.currency, `${path}.currency`, issues) && valid
      return valid
    }
    case 'validate_required_fields':
      if (!hasOnlyKeys(value, ['fields'])) {
        issues.push(issue(path, 'unknown_tool_parameter', 'Validation parameters contain an unsupported field.'))
        return false
      }
      return validateStringArray(value.fields, `${path}.fields`, issues)
    case 'export_csv':
      if (!hasOnlyKeys(value, ['columns'])) {
        issues.push(issue(path, 'unknown_tool_parameter', 'Export parameters contain an unsupported field.'))
        return false
      }
      if (value.columns === undefined) return true
      return validateStringArray(value.columns, `${path}.columns`, issues)
  }
}

function validateStep(value: unknown, index: number, issues: ValidationIssue[]): value is WorkflowStep {
  const path = `steps[${index}]`
  if (!isRecord(value)) {
    issues.push(issue(path, 'invalid_step', 'Workflow steps must be objects.'))
    return false
  }

  const allowedKeys = ['id', 'dependencies', 'tool', 'inputRefs', 'parameters', 'acceptance']
  let valid = hasOnlyKeys(value, allowedKeys)
  if (!valid) issues.push(issue(path, 'unknown_step_field', 'Workflow step contains an unsupported field.'))
  if (!isNonEmptyString(value.id)) {
    issues.push(issue(`${path}.id`, 'invalid_step_id', 'Step id must be a non-empty string.'))
    valid = false
  }
  if (!Array.isArray(value.dependencies) || !value.dependencies.every(isNonEmptyString)) {
    issues.push(issue(`${path}.dependencies`, 'invalid_dependencies', 'Dependencies must be an array of step ids.'))
    valid = false
  }
  if (!Array.isArray(value.inputRefs) || !value.inputRefs.every(isNonEmptyString)) {
    issues.push(issue(`${path}.inputRefs`, 'invalid_input_refs', 'Input references must be an array of non-empty strings.'))
    valid = false
  }
  if (typeof value.tool !== 'string' || !knownTools.has(value.tool)) {
    issues.push(issue(`${path}.tool`, 'unknown_tool', 'Workflow references an unknown tool.'))
    valid = false
  } else if (!validateToolParameters(value.tool as AgentToolId, value.parameters, `${path}.parameters`, issues)) {
    valid = false
  }
  if (!Array.isArray(value.acceptance)) {
    issues.push(issue(`${path}.acceptance`, 'invalid_acceptance', 'Step acceptance must be an array.'))
    valid = false
  } else {
    value.acceptance.forEach((criterion, criterionIndex) => {
      if (!validateCriterion(criterion, `${path}.acceptance[${criterionIndex}]`, issues)) valid = false
    })
  }
  return valid
}

export function validateWorkflow(input: unknown): Result<WorkflowDefinition> {
  const issues: ValidationIssue[] = []
  if (!isRecord(input)) {
    return { ok: false, issues: [issue('$', 'invalid_workflow', 'Workflow must be an object.')] }
  }

  if (!hasOnlyKeys(input, ['version', 'goal', 'steps', 'parameters', 'allowedTools', 'acceptance', 'pills'])) {
    issues.push(issue('$', 'unknown_workflow_field', 'Workflow contains an unsupported field.'))
  }
  if (input.pills !== undefined && !isLogicPills(input.pills)) issues.push(issue('pills', 'invalid_pills', 'Logic pills must have unique IDs and valid typed values.'))
  if (input.version !== 1) issues.push(issue('version', 'unsupported_version', 'Only workflow version 1 is supported.'))
  if (!isNonEmptyString(input.goal)) issues.push(issue('goal', 'invalid_goal', 'Workflow goal must be non-empty.'))

  if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > 5) {
    issues.push(issue('steps', 'invalid_task_count', 'Workflow must contain between 1 and 5 ordered steps.'))
  } else {
    input.steps.forEach((step, index) => validateStep(step, index, issues))
  }

  let parameters: WorkflowParameters = {}
  if (!isRecord(input.parameters) || !hasOnlyKeys(input.parameters, ['thresholdMinor', 'currency'])) {
    issues.push(issue('parameters', 'invalid_parameters', 'Workflow parameters may only contain thresholdMinor and currency.'))
  } else {
    parameters = input.parameters as WorkflowParameters
    if (parameters.thresholdMinor !== undefined) validateThreshold(parameters.thresholdMinor, 'parameters.thresholdMinor', issues)
    if (parameters.currency !== undefined) validateCurrency(parameters.currency, 'parameters.currency', issues)
    if ((parameters.thresholdMinor === undefined) !== (parameters.currency === undefined)) {
      issues.push(issue('parameters', 'incomplete_filter_parameters', 'thresholdMinor and currency must be provided together.'))
    }
  }

  const allowedTools: AgentToolId[] = []
  if (!Array.isArray(input.allowedTools) || !input.allowedTools.every((tool) => typeof tool === 'string' && knownTools.has(tool))) {
    issues.push(issue('allowedTools', 'unknown_tool', 'allowedTools must contain only supported tool ids.'))
  } else {
    allowedTools.push(...(input.allowedTools as AgentToolId[]))
    if (new Set(allowedTools).size !== allowedTools.length) issues.push(issue('allowedTools', 'duplicate_tool', 'allowedTools cannot contain duplicates.'))
  }

  if (!Array.isArray(input.acceptance)) {
    issues.push(issue('acceptance', 'invalid_acceptance', 'Workflow acceptance must be an array.'))
  } else {
    input.acceptance.forEach((criterion, index) => validateCriterion(criterion, `acceptance[${index}]`, issues))
  }

  if (Array.isArray(input.steps)) {
    const ids = new Set<string>()
    const priorIds = new Set<string>()
    input.steps.forEach((step, index) => {
      if (!isRecord(step) || !isNonEmptyString(step.id)) return
      if (ids.has(step.id)) issues.push(issue(`steps[${index}].id`, 'duplicate_step_id', 'Step ids must be unique.'))
      ids.add(step.id)
      if (Array.isArray(step.dependencies)) {
        for (const dependency of step.dependencies) {
          if (dependency === step.id || !priorIds.has(dependency)) {
            issues.push(issue(`steps[${index}].dependencies`, 'invalid_dependency_order', 'Dependencies must reference earlier steps.'))
          }
        }
      }
      if (typeof step.tool === 'string' && knownTools.has(step.tool) && Array.isArray(input.allowedTools) && !input.allowedTools.includes(step.tool)) {
        issues.push(issue(`steps[${index}].tool`, 'tool_not_allowed', 'Every step tool must be listed in allowedTools.'))
      }
      priorIds.add(step.id)
    })
    if (Array.isArray(input.allowedTools)) {
      const usedTools = new Set(input.steps.filter(isRecord).map((step) => step.tool).filter((tool): tool is string => typeof tool === 'string'))
      for (const allowedTool of input.allowedTools) {
        if (typeof allowedTool === 'string' && !usedTools.has(allowedTool)) {
          issues.push(issue('allowedTools', 'unused_allowed_tool', 'allowedTools cannot grant unused tools.'))
        }
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: input as unknown as WorkflowDefinition,
  }
}

export type LimitUsage = {
  activeRuns: number
  activeModelRequests: number
  taskCount: number
  attemptsForCurrentTask: number
  modelCallsForRun: number
  modelRequestElapsedMs: number
  runElapsedMs: number
}

export function validateRunLimits(
  usage: LimitUsage,
  limits: RunLimits,
): Result<true> {
  const issues: ValidationIssue[] = []
  const numericEntries = Object.entries({ ...usage, ...limits })
  for (const [key, value] of numericEntries) {
    if (!Number.isFinite(value) || value < 0) issues.push(issue(key, 'invalid_limit_value', 'Limit values and usage counters must be finite and non-negative.'))
  }
  if (issues.length > 0) return { ok: false, issues }

  const checks: Array<[boolean, string, string]> = [
    [usage.activeRuns > limits.maxActiveRuns, 'active_run_limit', 'Maximum active run count exceeded.'],
    [usage.activeModelRequests > limits.maxModelRequests, 'model_concurrency_limit', 'Maximum concurrent model requests exceeded.'],
    [usage.taskCount > limits.maxTasks, 'task_limit', 'Maximum task count exceeded.'],
    [usage.attemptsForCurrentTask > limits.maxAttemptsPerTask, 'attempt_limit', 'Maximum task attempts exceeded.'],
    [usage.modelCallsForRun > limits.maxModelCallsPerRun, 'model_call_limit', 'Maximum model calls for this run exceeded.'],
    [usage.modelRequestElapsedMs > limits.modelRequestTimeoutMs, 'model_timeout', 'Model request timeout exceeded.'],
    [usage.runElapsedMs > limits.runTimeoutMs, 'run_timeout', 'Run timeout exceeded.'],
  ]
  const exceeded = checks.find(([isExceeded]) => isExceeded)
  if (exceeded) return { ok: false, issues: [issue('$', exceeded[1], exceeded[2])] }
  return { ok: true, value: true }
}

export function validateValidationResult(input: unknown): Result<ValidationResult> {
  if (
    !isRecord(input) ||
    typeof input.pass !== 'boolean' ||
    !isNonEmptyString(input.code) ||
    !Array.isArray(input.evidence) ||
    !input.evidence.every(isNonEmptyString) ||
    typeof input.retryable !== 'boolean' ||
    !hasOnlyKeys(input, ['pass', 'code', 'evidence', 'retryable'])
  ) {
    return { ok: false, issues: [issue('$', 'invalid_validation_outcome', 'Validation outcome must contain pass, code, evidence, and retryable fields.')] }
  }
  return { ok: true, value: input as unknown as ValidationResult }
}

export function isAgentToolId(value: unknown): value is AgentToolId {
  return typeof value === 'string' && knownTools.has(value)
}
