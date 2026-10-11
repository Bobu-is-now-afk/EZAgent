import { allWorkflowItems, isWorkflowConfirmed, type WorkflowConfig, type WorkflowLocale } from './workflow-config'

export interface InvoiceAgentHandoff {
  schemaVersion: 1
  workflowId: string
  revision: number
  workflowName: string
  goal: string
  status: 'ready' | 'blocked' | 'not-supported'
  parameters: { thresholdMinor: number; currency: string } | null
  mappedParameters: Array<{ builderParameter: string; agentParameter: string; value: string; meaning: string }>
  unsupportedRequirements: Array<{ id: string; text: string; reason: string }>
  blockers: string[]
  summary: string
}

const copy = (locale: WorkflowLocale, traditionalChinese: string, english: string) => locale === 'zh-Hant' ? traditionalChinese : english

export function createInvoiceAgentHandoff(config: WorkflowConfig, locale: WorkflowLocale = 'zh-Hant'): InvoiceAgentHandoff {
  const base = {
    schemaVersion: 1 as const,
    workflowId: config.workflowId,
    revision: config.revision,
    workflowName: config.name,
    goal: config.goal,
  }
  if (config.templateId !== 'invoice-filter-export' || !config.previewParameters?.invoiceThresholdMinor) {
    const unsupportedRequirements = allWorkflowItems(config)
      .filter((item) => item.mapping.status === 'mapped' && item.mapping.parameter === 'dateInterpretation')
      .map((item) => ({
        id: item.id,
        text: item.text,
        reason: copy(locale, '發票 Agent 不解釋收據日期，也不讀取圖片或 PDF。', 'The invoice Agent does not interpret receipt dates or read images/PDFs.'),
      }))
    return {
      ...base,
      status: 'not-supported',
      parameters: null,
      mappedParameters: [],
      unsupportedRequirements,
      blockers: [copy(locale, '此工作流程不是目前支援的發票 CSV／TXT 篩選模板。', 'This is not the currently supported invoice CSV/TXT filter template.')],
      summary: copy(locale, '規則仍可儲存與預演，但不能以完整工作流程交給發票 Agent。', 'Rules can still be saved and previewed, but this complete workflow cannot be handed to the invoice Agent.'),
    }
  }

  const parameters = config.previewParameters
  const thresholdParameter = parameters.invoiceThresholdMinor
  if (!thresholdParameter) throw new Error('Invoice handoff threshold is missing.')
  const unsupportedRequirements = allWorkflowItems(config)
    .filter((item) => (item.source === 'user-request' || item.source === 'user-edit') && item.mapping.status === 'recorded-only')
    .map((item) => ({
      id: item.id,
      text: item.text,
      reason: copy(locale, '這項自由文字要求尚未映射到發票 Agent 的固定工具。', 'This free-text requirement is not mapped to a fixed invoice Agent tool.'),
    }))
  const blockers: string[] = []
  if (!isWorkflowConfirmed(config)) blockers.push(copy(locale, '先確認目前工作流程版本。', 'Confirm the current workflow version first.'))
  if (parameters.acceptedCurrencies.value.length !== 1) blockers.push(copy(locale, '發票 Agent 每次只接受一個精確幣種。', 'The invoice Agent accepts one exact currency per run.'))
  if (parameters.missingMerchantHandling.value !== 'needs-review') blockers.push(copy(locale, '發票 Agent 的固定政策會保留缺失欄位並標記人工檢查；目前不能關閉這項檢查。', 'The invoice Agent has a fixed policy to retain missing fields and flag them for human review; this check cannot currently be disabled.'))
  if (unsupportedRequirements.length) blockers.push(copy(locale, '存在會影響結果但尚未支援的要求；不會靜默忽略。', 'Result-affecting requirements remain unsupported and will not be silently ignored.'))
  const currency = parameters.acceptedCurrencies.value[0] ?? ''
  const thresholdMinor = thresholdParameter.value
  if (!/^[A-Z]{3}$/.test(currency)) blockers.push(copy(locale, '幣種必須是三個大寫英文字母。', 'Currency must be a three-letter uppercase code.'))
  if (!Number.isSafeInteger(thresholdMinor) || thresholdMinor < 0 || thresholdMinor > 100_000_000_000) blockers.push(copy(locale, '金額門檻超出 Builder 支援範圍。', 'The amount threshold is outside the Builder supported range.'))
  const ready = blockers.length === 0
  const major = (thresholdMinor / 100).toLocaleString(locale === 'zh-Hant' ? 'zh-HK' : 'en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return {
    ...base,
    status: ready ? 'ready' : 'blocked',
    parameters: ready ? { thresholdMinor, currency } : null,
    mappedParameters: [
      { builderParameter: 'invoiceThresholdMinor', agentParameter: 'thresholdMinor', value: String(thresholdMinor), meaning: copy(locale, '使用最小貨幣單位，執行器採嚴格大於。', 'Uses minor units; the executor applies strictly greater than.') },
      { builderParameter: 'acceptedCurrencies', agentParameter: 'currency', value: currency || '—', meaning: copy(locale, '精確比對三字母幣種，不換匯。', 'Exact three-letter currency match; no conversion.') },
      { builderParameter: 'missingMerchantHandling', agentParameter: 'fixed-validation-policy', value: parameters.missingMerchantHandling.value, meaning: copy(locale, '固定執行政策：缺失欄位保留空白、來源與檢核標記，不由模型補造。', 'Fixed executor policy: missing fields keep blanks, sources, and validation flags; the model does not fill them.') },
    ],
    unsupportedRequirements,
    blockers,
    summary: ready
      ? copy(locale, `將篩選嚴格超過 ${currency} ${major} 的發票，保留缺失欄位標記並輸出 CSV。`, `Filter invoices strictly above ${currency} ${major}, retain missing-field flags, and export CSV.`)
      : copy(locale, '交接尚未完成。請修改阻塞設定並重新確認、儲存。', 'Handoff is not ready. Change the blocking settings, then reconfirm and save.'),
  }
}
