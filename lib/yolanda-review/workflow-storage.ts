import type { WorkflowConfig, WorkflowSummary } from './workflow-config'
import { migrateStoredWorkflow, summarizeWorkflow } from './workflow-config'
import { normalizeWorkflowGovernance } from './workflow-governance'

export interface WorkflowStore {
  save(config: WorkflowConfig): Promise<void>
  list(): Promise<WorkflowSummary[]>
  get(workflowId: string): Promise<WorkflowConfig | undefined>
  saveVersion(config: WorkflowConfig): Promise<void>
  delete(workflowId: string): Promise<void>
}

const DATABASE_NAME = 'ezagent-yolanda-workflows'
const DATABASE_VERSION = 1
const LATEST_STORE = 'workflows'
const VERSION_STORE = 'workflowVersions'

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is not available in this browser.'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(LATEST_STORE)) database.createObjectStore(LATEST_STORE, { keyPath: 'workflowId' })
      if (!database.objectStoreNames.contains(VERSION_STORE)) database.createObjectStore(VERSION_STORE, { keyPath: 'versionKey' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open workflow storage.'))
  })
}

function cloneConfig(config: WorkflowConfig) {
  const cloned = JSON.parse(JSON.stringify(config)) as WorkflowConfig
  const migrated = migrateStoredWorkflow(cloned)
  return { ...migrated, governance: normalizeWorkflowGovernance(migrated.governance) }
}

async function saveVersion(config: WorkflowConfig) {
  const database = await openDatabase()
  const saved = cloneConfig(config)
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([LATEST_STORE, VERSION_STORE], 'readwrite')
    transaction.objectStore(LATEST_STORE).put(saved)
    transaction.objectStore(VERSION_STORE).put({ versionKey: `${saved.workflowId}@${saved.revision}`, workflowId: saved.workflowId, revision: saved.revision, config: saved })
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Could not save workflow.')) }
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('Workflow save was aborted.')) }
  })
}

async function get(workflowId: string) {
  const database = await openDatabase()
  return new Promise<WorkflowConfig | undefined>((resolve, reject) => {
    const transaction = database.transaction(LATEST_STORE, 'readonly')
    const request = transaction.objectStore(LATEST_STORE).get(workflowId)
    request.onsuccess = () => resolve(request.result ? cloneConfig(request.result as WorkflowConfig) : undefined)
    request.onerror = () => reject(request.error ?? new Error('Could not read workflow.'))
    transaction.oncomplete = () => database.close()
  })
}

async function list() {
  const database = await openDatabase()
  return new Promise<WorkflowSummary[]>((resolve, reject) => {
    const transaction = database.transaction(LATEST_STORE, 'readonly')
    const request = transaction.objectStore(LATEST_STORE).getAll()
    request.onsuccess = () => resolve((request.result as WorkflowConfig[]).map(cloneConfig).map(summarizeWorkflow).sort((left, right) => left.name.localeCompare(right.name)))
    request.onerror = () => reject(request.error ?? new Error('Could not list workflows.'))
    transaction.oncomplete = () => database.close()
  })
}

async function deleteWorkflow(workflowId: string) {
  const database = await openDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([LATEST_STORE, VERSION_STORE], 'readwrite')
    transaction.objectStore(LATEST_STORE).delete(workflowId)
    const cursor = transaction.objectStore(VERSION_STORE).openCursor()
    cursor.onsuccess = () => {
      const current = cursor.result
      if (!current) return
      if ((current.value as { workflowId?: string }).workflowId === workflowId) current.delete()
      current.continue()
    }
    cursor.onerror = () => transaction.abort()
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Could not delete workflow.')) }
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('Workflow deletion was aborted.')) }
  })
}

export const indexedDbWorkflowStore: WorkflowStore = {
  save: saveVersion,
  saveVersion,
  get,
  list,
  delete: deleteWorkflow,
}

export const saveWorkflow = (config: WorkflowConfig) => indexedDbWorkflowStore.save(config)
export const listSavedWorkflows = () => indexedDbWorkflowStore.list()
export const getSavedWorkflow = (workflowId: string) => indexedDbWorkflowStore.get(workflowId)
export const saveWorkflowVersion = (config: WorkflowConfig) => indexedDbWorkflowStore.saveVersion(config)
export const deleteSavedWorkflow = (workflowId: string) => indexedDbWorkflowStore.delete(workflowId)
