import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const scratch = 'D:\\work\\scratch-2026-10-07\\ezagent-yolanda-builder-preview'
const debugPort = 9400 + Math.floor(Math.random() * 400)
const siteUrl = (process.env.YOLANDA_BUILDER_URL ?? 'http://localhost:3108/yolanda-builder').replace(/\/yolanda-builder\/?$/, '')
const pageUrl = `${siteUrl}/`
await mkdir(scratch, { recursive: true })
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${scratch}\\profile-${Date.now()}`, '--window-size=1440,1100', pageUrl], { stdio: 'ignore' })
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let socket
let messageId = 0
const pending = new Map()

async function getPage() {
  for (let attempt = 0; attempt < 50; attempt++) {
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
  for (let attempt = 0; attempt < 70; attempt++) {
    if (await evaluate(expression)) return
    await wait(200)
  }
  throw new Error(`Timed out: ${description}`)
}

const bodyIncludes = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`
const clickExact = (text) => evaluate(`(() => { const element = [...document.querySelectorAll('button')].find((value) => value.textContent.trim() === ${JSON.stringify(text)}); if (!element) return false; element.click(); return true })()`)
const clickSummary = (text) => evaluate(`(() => { const element = [...document.querySelectorAll('summary')].find((value) => value.textContent.trim() === ${JSON.stringify(text)}); if (!element) return false; element.click(); return true })()`)
const clickLabel = (text) => evaluate(`(() => { const element = [...document.querySelectorAll('label')].find((value) => value.textContent.trim() === ${JSON.stringify(text)}); if (!element) return false; element.click(); return true })()`)
const replaceText = (label, value) => evaluate(`(() => { const element = document.querySelector('[aria-label=${JSON.stringify(label)}]'); if (!element) return false; const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
const selectOption = (label, value) => evaluate(`(() => { const element = document.querySelector('select[aria-label=${JSON.stringify(label)}]'); if (!element) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)

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

  await until(bodyIncludes('Build Something (Main Stage)'), 'workspace main-stage card')
  await until(`(() => { const heading = [...document.querySelectorAll('h2')].find((value) => value.textContent.trim() === 'Build Something (Main Stage)'); const button = heading?.closest('button'); return button && Object.keys(button).some((key) => key.startsWith('__reactProps')); })()`, 'workspace hydration')
  assert.equal(await evaluate(`(() => { const heading = [...document.querySelectorAll('h2')].find((value) => value.textContent.trim() === 'Build Something (Main Stage)'); const button = heading?.closest('button'); if (!button) return false; button.click(); return true })()`), true)
  await until(`location.pathname === '/yolanda-builder'`, 'main-stage navigation')
  await until(bodyIncludes('你想讓助手重複完成什麼？'), 'builder heading')
  await until(`(() => { const button = [...document.querySelectorAll('button')].find((value) => value.textContent.trim() === '整理需求'); return button && Object.keys(button).some((key) => key.startsWith('__reactProps')); })()`, 'builder hydration')
  assert.equal(await evaluate(bodyIncludes('輸出示例，不是已處理的業務資料。')), true)
  assert.equal(await clickExact('整理需求'), true)
  await until(`document.querySelector('[data-builder-step="confirm"]') !== null`, 'confirmation step')
  assert.equal(await evaluate(bodyIncludes('2026-10-09')), true)
  assert.equal(await selectOption('日期 09/10/2026 如何解釋？', 'MM/DD/YYYY'), true)
  await until(bodyIncludes('2026-09-10'), 'date preview changed')
  assert.equal(await clickLabel('USD'), true)
  await until(bodyIncludes('納入 USD 20.00，不換匯'), 'currency preview changed')
  await evaluate(`(() => { const buttons = [...document.querySelectorAll('button')].filter((value) => value.textContent.trim() === '採用建議'); buttons.forEach((value) => value.click()); return buttons.length })()`)
  assert.equal(await clickExact('確認並繼續'), true)
  await until(`document.querySelector('[data-builder-step="save"]') !== null`, 'save step')
  assert.equal(await evaluate(bodyIncludes('工作流說明卡')), true)
  assert.equal(await evaluate(bodyIncludes('HKD, USD')), true)
  assert.equal(await replaceText('工作流程名稱', '測試每月收據整理'), true)
  assert.equal(await clickExact('儲存工作流'), true)
  await until(bodyIncludes('已儲存到此瀏覽器'), 'local save')
  assert.equal(await clickExact('查看工作流'), true)
  await until(bodyIncludes('測試每月收據整理'), 'saved workflow listed')
  assert.equal(await evaluate(bodyIncludes('上次修改')), true)
  assert.equal(await clickSummary('管理詳情'), true)
  assert.equal(await clickExact('測試每月收據整理'), true)
  await until(`document.querySelector('[data-managed-workflow]') !== null`, 'management details')
  assert.equal(await evaluate(bodyIncludes('EZAgent Demo Co.')), true)
  const desktop = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(`${scratch}\\workflow-library-desktop.png`, Buffer.from(desktop.result.data, 'base64'))
  assert.equal(await clickExact('開啟'), true)
  await until(`document.querySelector('[data-builder-step="save"]') !== null`, 'saved workflow reopened')
  assert.equal(await clickExact('EN'), true)
  await until(bodyIncludes('Create workflow'), 'English interface')
  assert.equal(await clickExact('繁中'), true)
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true)
  const mobile = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(`${scratch}\\workflow-builder-mobile.png`, Buffer.from(mobile.result.data, 'base64'))
  console.log(JSON.stringify({ result: 'passed', screenshots: [`${scratch}\\workflow-library-desktop.png`, `${scratch}\\workflow-builder-mobile.png`] }))
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close()
  browser.kill()
}
