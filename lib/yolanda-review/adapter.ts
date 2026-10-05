import { calculateBatch, validateAssumptions } from './engine'
import type { CalculationResult, ReviewBatch } from './types'

export interface ReviewAdapter {
  calculate(batch: ReviewBatch, requestId: string): Promise<CalculationResult>
}

export const demoAdapter: ReviewAdapter = {
  calculate(batch, requestId) {
    return new Promise((resolve, reject) => {
      window.setTimeout(() => {
        if (batch.mode !== 'synthetic') {
          reject(new Error('Real adapter is not connected. Synthetic calculation was not used.'))
          return
        }
        const assumptionErrors = validateAssumptions(batch)
        if (assumptionErrors.length) {
          reject(new Error(`Synthetic adapter refused calculation: ${assumptionErrors[0]}`))
          return
        }
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
