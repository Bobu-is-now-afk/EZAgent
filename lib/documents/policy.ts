export const DOCUMENT_POLICY_VERSION = '2026-10-15-v1'

export const DOCUMENT_DATA_POLICY = {
  version: DOCUMENT_POLICY_VERSION,
  title: 'EZAgent 合成文件示範資料政策',
  audience: '本受控示範只接受合成測試資料。請勿輸入真實客戶、員工、財務或機密資訊。',
  processing: '瀏覽器請求由 Mac mini 上的 EZAgent 服務處理。使用者要求文字建議時，自訂描述只會送到該主機上綁定 loopback 的 Ollama 服務。本示範不會寄送文件、發起付款，亦不會聯絡外部模型服務。',
  stored: '每位使用者的資料快照包含合成訂單、文件草稿與版本、覆核來源記錄、AI 建議與摘錄、SAMPLE 文件、序號及冪等記錄。主機另存一份控制快照，包含非機密邀請 ID、使用者 ID、工作階段到期／撤銷資料、請求計數、每日建議計數及執行中／排隊中的建議工作。存取碼與簽署密鑰不會寫入儲存資料。',
  location: 'Hosted 示範檔案儲存在 EZAgent 執行資料目錄下的 .ezagent/documents/owners/<owner-id>/ 與 .ezagent/documents/hosted-control/。資料不會存進瀏覽器 localStorage，也不會納入公開原始碼儲存庫。',
  limits: '每個 JSON 請求上限為 64 KiB，URL 上限為 2 KiB。每位使用者最多 250 筆訂單、250 份草稿、1,000 項建議、1,000 份範例文件；單一快照上限為 10 MiB。Hosted 模式啟用前，必須設定工作階段、每分鐘請求、每日建議、同時執行數、佇列、等待及模型逾時上限。',
  retention: '登出或工作階段到期只會撤銷瀏覽器存取權，不會刪除使用者資料。本示範沒有自動清除期限，也沒有逾期工作階段的自助復原功能。操作人員須移除該使用者資料目錄及控制快照中的邀請／使用者記錄，才會清除資料。',
  backup: '本示範不定義或保證主機備份、記錄保留或事故處理方式。請勿從本頁推定這些控制已存在。',
} as const

export function documentPolicyAvailable(configuredVersion: string | undefined): boolean {
  return Boolean(configuredVersion && configuredVersion === DOCUMENT_POLICY_VERSION &&
    DOCUMENT_DATA_POLICY.version === DOCUMENT_POLICY_VERSION &&
    Object.values(DOCUMENT_DATA_POLICY).every((value) => typeof value === 'string' && value.length > 0))
}
