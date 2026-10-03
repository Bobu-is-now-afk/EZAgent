import { calculateBatch } from './engine'
import type { CalculationResult, ReviewBatch } from './types'

export interface ReviewAdapter {
  calculate(batch: ReviewBatch, requestId: string): Promise<CalculationResult>
}

export const demoAdapter: ReviewAdapter = {
  calculate(batch, requestId) {
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
        if (sessionStorage.getItem('yolanda-demo-fail-next') === 'true') {
          sessionStorage.removeItem('yolanda-demo-fail-next')
          reject(new Error('Synthetic adapter failure requested for demo.'))
          return
        }
        resolve(calculateBatch(batch, requestId))
      }, 450)
    })
  },
}

export function validateImportedBatch(value: unknown): ReviewBatch {
  const text = JSON.stringify(value)
  if (text.length > 2_000_000) throw new Error('Working copy exceeds the 2 MB limit.')
  if (!value || typeof value !== 'object') throw new Error('Working copy must be a JSON object.')
  const candidate = value as Partial<ReviewBatch>
  if (candidate.schemaVersion !== '1.0' || !candidate.batchId || !Number.isInteger(candidate.revision)) throw new Error('Unsupported or incomplete working copy.')
  if (!Array.isArray(candidate.documents) || !Array.isArray(candidate.evidence) || !Array.isArray(candidate.ledgerRows) || !Array.isArray(candidate.drafts)) throw new Error('Working copy collections are invalid.')
  if (candidate.documents.length > 100) throw new Error('Working copy exceeds the 100-document limit.')
  const ids = candidate.documents.map((document) => document.recordId)
  if (new Set(ids).size !== ids.length) throw new Error('Document IDs must be unique.')
  const evidenceIds = new Set(candidate.evidence.map((evidence) => evidence.evidenceId))
  if (candidate.documents.some((document) => !evidenceIds.has(document.evidenceId))) throw new Error('A document references missing evidence.')
  if (candidate.drafts.some((draft) => draft.body.length > 10_000)) throw new Error('A draft exceeds the 10,000-character limit.')
  return structuredClone(candidate as ReviewBatch)
}
