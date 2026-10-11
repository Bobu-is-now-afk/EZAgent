import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const scratch = 'D:\\work\\scratch-2026-10-11\\ezagent-builder-agent-handoff'
const debugPort = 9600 + Math.floor(Math.random() * 300)
const siteUrl = process.env.EZAGENT_URL ?? 'http://127.0.0.1:3107'
await mkdir(scratch, { recursive: true })
const browser = spawn(edge, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${scratch}\\profile-${Date.now()}`,
  '--window-size=1440,1100',
  `${siteUrl}/yolanda-builder`,
], { stdio: 'ignore' })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let socket
let messageId = 0
const pending = new Map()

async function getPage() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json())
      const page = pages.find((value) => value.type === 'page' && value.url.startsWith(siteUrl))
      if (page) return page
    } catch {}
    await wait(250)
  }
  throw new Error('Edge debugging page did not become ready.')
}

function command(method, params = {}) {
  const id = ++messageId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result.result.value
}

async function until(expression, description) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (await evaluate(expression)) return
    await wait(200)
  }
  throw new Error(`Timed out: ${description}`)
}

const bodyIncludes = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`
const clickExact = (text) => evaluate(`(() => { const element = [...document.querySelectorAll('button')].find((value) => value.textContent.trim() === ${JSON.stringify(text)}); if (!element) return false; element.click(); return true })()`)

try {
  const page = await getPage()
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const handler = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) handler.reject(new Error(message.error.message))
    else handler.resolve(message)
  }
  await command('Runtime.enable')
  await command('Page.enable')
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false })

  await until(bodyIncludes('你想讓助手重複完成什麼？'), 'Builder first step')
  await until(`(() => { const button = [...document.querySelectorAll('button')].find((value) => value.textContent.trim() === '整理需求'); return button && Object.keys(button).some((key) => key.startsWith('__reactProps')); })()`, 'Builder hydration')
  assert.equal(await clickExact('整理需求'), true)
  await until(`document.querySelector('[data-builder-step="confirm"]') !== null`, 'Builder confirmation step')

  assert.equal(await evaluate(`(() => { const input = document.querySelector('[aria-label="金額門檻（嚴格大於）"]'); if (!input) return false; input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '13000.00'); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); input.blur(); return true })()`), true)
  await until(bodyIncludes('被篩選掉'), 'threshold preview change')
  for (let attempt = 0; attempt < 8; attempt++) {
    const clicked = await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find((value) => value.textContent.trim() === '採用建議'); if (!button) return false; button.click(); return true })()`)
    if (!clicked) break
    await wait(150)
  }
  await until(`[...document.querySelectorAll('button')].some((value) => value.textContent.trim() === '確認並繼續' && !value.disabled)`, 'confirmation ready')
  assert.equal(await clickExact('確認並繼續'), true)
  await until(`document.querySelector('[data-builder-step="save"]') !== null`, 'Builder save step')
  assert.equal(await evaluate(bodyIncludes('HKD 13000.00')), true)
  assert.equal(await clickExact('儲存工作流'), true)
  await until(bodyIncludes('已儲存到此瀏覽器'), 'workflow saved')
  await until(bodyIncludes('此版本可交給發票 Agent'), 'handoff ready')

  const desktop = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(`${scratch}\\builder-handoff-desktop.png`, Buffer.from(desktop.result.data, 'base64'))
  assert.equal(await clickExact('交給發票 Agent'), true)
  await until(`location.pathname === '/invoice-demo'`, 'Agent navigation')
  const query = await evaluate(`Object.fromEntries(new URLSearchParams(location.search))`)
  assert.deepEqual(Object.keys(query).sort(), ['revision', 'workflowId'])
  assert.match(query.workflowId, /^[a-z0-9-]{1,80}$/)
  assert.match(query.revision, /^[1-9][0-9]*$/)
  await until(bodyIncludes('準備本機 AI') + ' || ' + bodyIncludes('發票整理示範'), 'Agent entry')

  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true)
  const mobile = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(`${scratch}\\agent-entry-mobile.png`, Buffer.from(mobile.result.data, 'base64'))

  console.log(JSON.stringify({
    result: 'passed',
    queryKeys: Object.keys(query).sort(),
    screenshots: [`${scratch}\\builder-handoff-desktop.png`, `${scratch}\\agent-entry-mobile.png`],
  }))
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close()
  browser.kill()
}
