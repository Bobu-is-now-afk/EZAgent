import assert from 'node:assert/strict'
import test from 'node:test'
import { hostedPlanJobStatusLabel, isHostedPlanJobCancelable } from '../../lib/agent/hosted-plan-queue'

test('queue status includes position and clear terminal states', () => {
  assert.equal(hostedPlanJobStatusLabel('queued', 1), '排隊中 · 前方位置 1')
  assert.equal(hostedPlanJobStatusLabel('queued', 2), '排隊中 · 前方位置 2')
  assert.equal(hostedPlanJobStatusLabel('running', null), '處理中')
  assert.equal(hostedPlanJobStatusLabel('cancelling', null), '正在取消')
  assert.equal(hostedPlanJobStatusLabel('completed', null), '已完成')
  assert.equal(hostedPlanJobStatusLabel('interrupted', null), '服務重啟後中斷')
  assert.equal(hostedPlanJobStatusLabel('failed', null), '未完成')
})

test('only active queue jobs expose cancellation', () => {
  for (const status of ['queued', 'running', 'cancelling'] as const) assert.equal(isHostedPlanJobCancelable(status), true)
  for (const status of ['completed', 'failed', 'cancelled', 'interrupted'] as const) assert.equal(isHostedPlanJobCancelable(status), false)
})
