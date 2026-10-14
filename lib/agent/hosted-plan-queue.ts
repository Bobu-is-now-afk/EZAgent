export type HostedPlanJobStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export function hostedPlanJobStatusLabel(status: HostedPlanJobStatus, position: number | null): string {
  if (status === 'queued') return `排隊中${position ? ` · 前方位置 ${position}` : ''}`
  if (status === 'running') return '處理中'
  if (status === 'cancelling') return '正在取消'
  if (status === 'completed') return '已完成'
  if (status === 'interrupted') return '服務重啟後中斷'
  if (status === 'cancelled') return '已取消'
  return '未完成'
}

export function isHostedPlanJobCancelable(status: HostedPlanJobStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'cancelling'
}
