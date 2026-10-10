import {
  DEFAULT_RUN_LIMITS,
  type RunLimits,
  type RunStatus,
  type Result,
  type TaskState,
  type TaskStatus,
  type ValidationResult,
  type ValidationIssue,
} from './contracts'
import { validateValidationResult } from './validation'

export type TaskEvent = 'start' | 'begin_validation' | 'pass' | 'retry' | 'need_input' | 'fail'

const transitions: Readonly<Record<TaskStatus, readonly TaskEvent[]>> = {
  pending: ['start', 'need_input', 'fail'],
  running: ['begin_validation', 'retry', 'need_input', 'fail'],
  validating: ['pass', 'retry', 'need_input', 'fail'],
  passed: [],
  retry_pending: ['start', 'need_input', 'fail'],
  needs_input: ['retry', 'fail'],
  failed: [],
}

const runTransitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  draft: ['awaiting_approval', 'failed'],
  awaiting_approval: ['running', 'failed'],
  running: ['needs_input', 'failed', 'cancelling', 'interrupted', 'completed'],
  needs_input: ['running', 'failed', 'cancelling', 'interrupted'],
  failed: [],
  cancelling: ['cancelled', 'failed', 'interrupted'],
  cancelled: [],
  interrupted: ['running', 'cancelled', 'failed'],
  completed: [],
}

function stateIssue(code: string, message: string): ValidationIssue {
  return { path: 'status', code, message }
}

export function transitionTask(
  state: TaskState,
  event: TaskEvent,
  outcome?: ValidationResult,
  limits: RunLimits = DEFAULT_RUN_LIMITS,
): Result<TaskState> {
  if (!transitions[state.status]?.includes(event)) {
    return { ok: false, issues: [stateIssue('illegal_task_transition', `Cannot apply ${event} while task is ${state.status}.`)] }
  }

  if (!Number.isInteger(state.attempts) || state.attempts < 0 || state.attempts > limits.maxAttemptsPerTask) {
    return { ok: false, issues: [stateIssue('invalid_attempt_count', 'Task attempts must be a non-negative integer within the configured limit.')] }
  }

  if (event === 'start') {
    if (state.attempts >= limits.maxAttemptsPerTask) {
      return { ok: false, issues: [stateIssue('attempt_limit', 'Task cannot start because its attempt limit is exhausted.')] }
    }
    return { ok: true, value: { status: 'running', attempts: state.attempts + 1 } }
  }

  if (event === 'pass') {
    if (!outcome) {
      return { ok: false, issues: [stateIssue('missing_validation_outcome', 'Passing a task requires a successful validation outcome with evidence.')] }
    }
    const validatedOutcome = validateValidationResult(outcome)
    if (!validatedOutcome.ok) return validatedOutcome
    if (!validatedOutcome.value.pass) {
      return { ok: false, issues: [stateIssue('validation_failed', 'A failed validation outcome cannot pass the task.')] }
    }
    if (validatedOutcome.value.evidence.length === 0) {
      return { ok: false, issues: [stateIssue('missing_validation_evidence', 'Passing a task requires at least one evidence item.')] }
    }
    return { ok: true, value: { ...state, status: 'passed', validation: validatedOutcome.value } }
  }

  const nextStatus: Record<Exclude<TaskEvent, 'start' | 'pass'>, Exclude<TaskStatus, 'passed'>> = {
    begin_validation: 'validating',
    retry: 'retry_pending',
    need_input: 'needs_input',
    fail: 'failed',
  }
  return { ok: true, value: { ...state, status: nextStatus[event] } }
}

export function transitionRun(
  from: RunStatus,
  to: RunStatus,
  taskStates?: Readonly<Record<string, TaskState>>,
): Result<RunStatus> {
  if (!runTransitions[from].includes(to)) {
    return {
      ok: false,
      issues: [{ path: 'status', code: 'illegal_run_transition', message: `Cannot change run from ${from} to ${to}.` }],
    }
  }
  if (from === 'running' && to === 'completed') {
    const states = taskStates ? Object.values(taskStates) : []
    const everyTaskHasPassingEvidence = states.length > 0 && states.every((taskState) => {
      if (taskState.status !== 'passed') return false
      const validation = validateValidationResult(taskState.validation)
      return validation.ok && validation.value.pass && validation.value.evidence.length > 0
    })
    if (!everyTaskHasPassingEvidence) {
      return {
        ok: false,
        issues: [{ path: 'taskStates', code: 'unfinished_tasks', message: 'A run can complete only after every task has passed.' }],
      }
    }
  }
  return { ok: true, value: to }
}
