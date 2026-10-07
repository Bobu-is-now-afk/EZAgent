import type { WorkflowConfig } from './workflow-config'

export type WorkflowRole = 'staff' | 'lead' | 'manager' | 'admin'
export type WorkflowAction = 'view' | 'run' | 'create' | 'edit' | 'delete' | 'manage-access'

export interface DemoWorkflowIdentity {
  userId: string
  displayName: string
  role: WorkflowRole
  organizationId: string
  organizationName: string
  departmentId: string
  departmentName: string
}

export interface WorkflowGovernance {
  organizationId: string | null
  organizationName: string | null
  departmentId: string | null
  departmentName: string | null
  creatorId: string | null
  creatorName: string | null
  createdAt: string | null
  updatedById: string | null
  updatedByName: string | null
  updatedAt: string | null
  minimumRunRole: WorkflowRole
  minimumEditRole: WorkflowRole
}

export const DEMO_WORKFLOW_IDENTITIES: DemoWorkflowIdentity[] = [
  { userId: 'demo-staff', displayName: 'Mina Chan', role: 'staff', organizationId: 'ezagent-demo', organizationName: 'EZAgent Demo Co.', departmentId: 'finance-ops', departmentName: 'Finance Operations' },
  { userId: 'demo-yolanda', displayName: 'Yolanda', role: 'lead', organizationId: 'ezagent-demo', organizationName: 'EZAgent Demo Co.', departmentId: 'finance-ops', departmentName: 'Finance Operations' },
  { userId: 'demo-manager', displayName: 'Alex Wong', role: 'manager', organizationId: 'ezagent-demo', organizationName: 'EZAgent Demo Co.', departmentId: 'finance-ops', departmentName: 'Finance Operations' },
  { userId: 'demo-admin', displayName: 'Robin Lee', role: 'admin', organizationId: 'ezagent-demo', organizationName: 'EZAgent Demo Co.', departmentId: 'platform', departmentName: 'Platform' },
]

const rank: Record<WorkflowRole, number> = { staff: 1, lead: 2, manager: 3, admin: 4 }

export function unassignedWorkflowGovernance(): WorkflowGovernance {
  return {
    organizationId: null,
    organizationName: null,
    departmentId: null,
    departmentName: null,
    creatorId: null,
    creatorName: null,
    createdAt: null,
    updatedById: null,
    updatedByName: null,
    updatedAt: null,
    minimumRunRole: 'staff',
    minimumEditRole: 'lead',
  }
}

export function normalizeWorkflowGovernance(value: unknown): WorkflowGovernance {
  if (!value || typeof value !== 'object') return unassignedWorkflowGovernance()
  const candidate = value as Partial<WorkflowGovernance>
  const text = (input: unknown) => typeof input === 'string' && input.trim() ? input.trim() : null
  const role = (input: unknown, fallback: WorkflowRole): WorkflowRole => ['staff', 'lead', 'manager', 'admin'].includes(input as string) ? input as WorkflowRole : fallback
  return {
    organizationId: text(candidate.organizationId),
    organizationName: text(candidate.organizationName),
    departmentId: text(candidate.departmentId),
    departmentName: text(candidate.departmentName),
    creatorId: text(candidate.creatorId),
    creatorName: text(candidate.creatorName),
    createdAt: text(candidate.createdAt),
    updatedById: text(candidate.updatedById),
    updatedByName: text(candidate.updatedByName),
    updatedAt: text(candidate.updatedAt),
    minimumRunRole: role(candidate.minimumRunRole, 'staff'),
    minimumEditRole: role(candidate.minimumEditRole, 'lead'),
  }
}

export function stampWorkflowSave(config: WorkflowConfig, actor: DemoWorkflowIdentity, savedAt = new Date().toISOString()): WorkflowConfig {
  const current = normalizeWorkflowGovernance(config.governance)
  const firstSave = !current.creatorId
  return {
    ...config,
    governance: {
      ...current,
      organizationId: current.organizationId ?? actor.organizationId,
      organizationName: current.organizationName ?? actor.organizationName,
      departmentId: current.departmentId ?? actor.departmentId,
      departmentName: current.departmentName ?? actor.departmentName,
      creatorId: current.creatorId ?? actor.userId,
      creatorName: current.creatorName ?? actor.displayName,
      createdAt: current.createdAt ?? savedAt,
      updatedById: actor.userId,
      updatedByName: actor.displayName,
      updatedAt: savedAt,
    },
    confirmation: firstSave && config.confirmation.revision === config.revision ? { ...config.confirmation } : config.confirmation,
  }
}

function belongsToWorkflow(actor: DemoWorkflowIdentity, config: WorkflowConfig) {
  const governance = normalizeWorkflowGovernance(config.governance)
  if (!governance.organizationId || !governance.departmentId) return true
  if (actor.organizationId !== governance.organizationId) return false
  return actor.role === 'admin' || actor.departmentId === governance.departmentId
}

export function canWorkflowAction(actor: DemoWorkflowIdentity, action: WorkflowAction, config?: WorkflowConfig): boolean {
  if (action === 'create') return rank[actor.role] >= rank.lead
  if (!config || !belongsToWorkflow(actor, config)) return false
  const governance = normalizeWorkflowGovernance(config.governance)
  if (action === 'view') return true
  if (action === 'run') return rank[actor.role] >= rank[governance.minimumRunRole]
  if (action === 'edit') return rank[actor.role] >= rank[governance.minimumEditRole]
  if (action === 'delete') return actor.role === 'manager' || actor.role === 'admin'
  return actor.role === 'admin'
}

export function updateWorkflowAccess(config: WorkflowConfig, actor: DemoWorkflowIdentity, minimumRunRole: WorkflowRole, minimumEditRole: WorkflowRole, updatedAt = new Date().toISOString()): WorkflowConfig {
  if (!canWorkflowAction(actor, 'manage-access', config)) throw new Error('Only an organization administrator can change workflow access.')
  if (rank[minimumEditRole] < rank[minimumRunRole]) throw new Error('Edit access cannot be broader than run access.')
  const governance = normalizeWorkflowGovernance(config.governance)
  if (governance.minimumRunRole === minimumRunRole && governance.minimumEditRole === minimumEditRole) return config
  const revision = config.revision + 1
  return {
    ...config,
    revision,
    confirmation: config.confirmation.revision === config.revision ? { ...config.confirmation, revision } : config.confirmation,
    governance: { ...governance, minimumRunRole, minimumEditRole, updatedById: actor.userId, updatedByName: actor.displayName, updatedAt },
  }
}
