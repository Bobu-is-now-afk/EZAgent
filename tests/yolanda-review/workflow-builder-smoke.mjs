import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const scratch = 'D:\\work\\scratch-2026-10-07\\ezagent-yolanda-builder-browser'
const runId = Date.now()
const debugPort = 9400 + Math.floor(Math.random() * 400)
const profile = `${scratch}\\profile-${runId}`
const pageUrl = process.env.YOLANDA_BUILDER_URL ?? 'http://localhost:3108/yolanda-builder'
await mkdir(scratch, { recursive: true })

const browser = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  '--window-size=1440,1100', pageUrl,
], { stdio: 'ignore' })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let socket
let messageId = 0
const pending = new Map()

async function getPage() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json())
      const page = pages.find((value) => value.type === 'page' && value.url.includes('/yolanda-builder'))
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
async function clickButton(text, exact) {
  const point = await evaluate(`(() => { const element = [...document.querySelectorAll('button')].find((value) => ${exact ? `value.textContent.trim() === ${JSON.stringify(text)}` : `value.textContent.includes(${JSON.stringify(text)})`}); if (!element) return null; element.scrollIntoView({ block: 'center' }); const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } })()`)
  if (!point) return false
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  return true
}
const clickExact = (text) => clickButton(text, true)
const clickIncludes = (text) => clickButton(text, false)
async function replaceText(label, value) {
  const point = await evaluate(`(() => { const element = document.querySelector('[aria-label=${JSON.stringify(label)}]'); if (!element) return null; element.scrollIntoView({ block: 'center' }); const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + Math.min(rect.height / 2, 24) } })()`)
  if (!point) return false
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await command('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 })
  await command('Input.insertText', { text: value })
  return true
}
async function selectOption(label, value) {
  return evaluate(`(() => { const element = document.querySelector('select[aria-label=${JSON.stringify(label)}]'); if (!element) return false; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
}

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

  await until(bodyIncludes('建立工作流程'), 'builder heading')
  await until(`(() => { const button = [...document.querySelectorAll('button')].find((value) => value.textContent.trim() === '整理成步驟'); return button && Object.keys(button).some((key) => key.startsWith('__reactProps')); })()`, 'builder hydration')
  assert.equal(await evaluate(bodyIncludes('幫我整理每個月的收據')), true)
  assert.equal(await replaceText('你想重複處理什麼工作？', '幫我整理每個月的收據，提取日期、商戶和金額。缺少資訊時先問我，最後產生一份表格。'), true)
  await until(`[...document.querySelectorAll('button')].some((value) => value.textContent.trim() === '整理成步驟' && !value.disabled)`, 'organize button enabled')
  assert.equal(await clickExact('整理成步驟'), true)
  await until(`document.querySelector('[data-builder-step="confirm"]') !== null`, 'confirmation step')

  assert.equal(await evaluate(`(() => { const article = document.querySelector('[data-workflow-item="receipt-fields"]'); const button = article && [...article.querySelectorAll('button')].find((value) => value.textContent.trim() === '修改'); if (!button) return false; button.click(); return true })()`), true)
  assert.equal(await replaceText('規則內容 receipt-fields', '從每張收據提取日期、商戶、金額和稅額'), true)
  assert.equal(await clickExact('儲存修改'), true)
  assert.equal(await evaluate(`(() => { const buttons = [...document.querySelectorAll('[data-workflow-item] button')].filter((value) => value.textContent.trim() === '確認'); buttons.forEach((value) => value.click()); return buttons.length })()`), 1)
  assert.equal(await replaceText('你的答案 receipt-date-order', '採用 DD/MM/YYYY。'), true)
  assert.equal(await clickExact('確認答案'), true)
  await until(bodyIncludes('沒有未解決的關鍵問題。'), 'question resolved')
  assert.equal(await clickExact('確認並繼續'), true)
  await until(`document.querySelector('[data-builder-step="save"]') !== null`, 'save step')

  assert.equal(await replaceText('工作流程名稱', '測試每月收據整理'), true)
  await wait(300)
  assert.equal(await clickExact('儲存工作流配置'), true)
  await until(bodyIncludes('已儲存到本機工作流庫，可在此瀏覽器重新開啟。'), 'local save')
  const revision = await evaluate(`document.body.innerText.match(/v(\\d+) ·/)?.[1]`)

  await command('Page.reload', { ignoreCache: true })
  await until(bodyIncludes('建立工作流程'), 'builder after reload')
  await until(`(() => { const button = [...document.querySelectorAll('button')].find((value) => value.textContent.trim() === '本機工作流庫'); return button && Object.keys(button).some((key) => key.startsWith('__reactProps')); })()`, 'builder hydration after reload')
  assert.equal(await clickExact('本機工作流庫'), true)
  await until(bodyIncludes('測試每月收據整理'), 'saved workflow listed')
  assert.equal(await clickIncludes('測試每月收據整理'), true)
  await until(`document.querySelector('[data-managed-workflow]') !== null`, 'workflow management detail')
  assert.equal(await evaluate(bodyIncludes('EZAgent Demo Co.')), true)
  assert.equal(await evaluate(bodyIncludes('Finance Operations')), true)
  assert.equal(await evaluate(bodyIncludes('Yolanda')), true)
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find((value) => value.textContent.includes('刪除工作流'))?.disabled`), true)
  const library = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(`${scratch}\\workflow-library-desktop.png`, Buffer.from(library.result.data, 'base64'))
  assert.equal(await selectOption('演示身分', 'demo-manager'), true)
  await until(`[...document.querySelectorAll('button')].some((value) => value.textContent.includes('刪除工作流') && !value.disabled)`, 'manager delete permission')
  assert.equal(await selectOption('演示身分', 'demo-yolanda'), true)
  assert.equal(await clickExact('開啟'), true)
  await until(`document.querySelector('[data-builder-step="save"]') !== null`, 'saved workflow restored')
  assert.equal(await evaluate(`document.querySelector('[aria-label="工作流程名稱"]')?.value`), '測試每月收據整理')
  assert.equal(await evaluate(`(() => { const details = document.querySelector('details'); details.open = true; return [...details.querySelectorAll('textarea')].every((value) => value.value.includes('從每張收據提取日期、商戶、金額和稅額')) })()`), true)
  const workflowId = await evaluate(`JSON.parse(document.querySelectorAll('details textarea')[1].value).workflowId`)
  assert.equal(await clickExact('開始本機試跑'), true)
  await until(`document.querySelector('[data-trial-run] table') !== null`, 'trial result table')
  assert.equal(await evaluate(bodyIncludes('可輸出 1 · 需人工檢查 1')), true)

  assert.equal(await clickExact('EN'), true)
  await until(bodyIncludes('Create workflow'), 'English interface')
  const desktop = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(`${scratch}\\workflow-builder-desktop.png`, Buffer.from(desktop.result.data, 'base64'))

  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  assert.equal(await clickExact('繁中'), true)
  await until(bodyIncludes('建立工作流程'), 'Traditional Chinese mobile interface')
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true)
  const mobile = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(`${scratch}\\workflow-builder-mobile.png`, Buffer.from(mobile.result.data, 'base64'))

  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false })
  assert.equal(await clickExact('本機工作流庫'), true)
  await until(bodyIncludes('測試每月收據整理'), 'saved workflow before deletion')
  assert.equal(await clickIncludes('測試每月收據整理'), true)
  await until(`document.querySelector('[data-managed-workflow]') !== null`, 'workflow selected before deletion')
  assert.equal(await selectOption('演示身分', 'demo-manager'), true)
  await until(`[...document.querySelectorAll('button')].some((value) => value.textContent.includes('刪除工作流') && !value.disabled)`, 'delete enabled before deletion')
  await evaluate(`window.confirm = () => true`)
  assert.equal(await clickIncludes('刪除工作流'), true)
  await until(`!document.body.innerText.includes('測試每月收據整理')`, 'workflow deleted from local library')
  assert.equal(await evaluate(`new Promise((resolve) => { const open = indexedDB.open('ezagent-yolanda-workflows'); open.onerror = () => resolve(false); open.onsuccess = () => { const database = open.result; const transaction = database.transaction(['workflows', 'workflowVersions'], 'readonly'); const latest = transaction.objectStore('workflows').getAll(); const versions = transaction.objectStore('workflowVersions').getAll(); transaction.oncomplete = () => { const remains = [...latest.result, ...versions.result].some((value) => value.workflowId === ${JSON.stringify(workflowId)}); database.close(); resolve(!remains) }; transaction.onerror = () => resolve(false) } })`), true)

  console.log(JSON.stringify({ result: 'passed', revision, screenshots: [`${scratch}\\workflow-library-desktop.png`, `${scratch}\\workflow-builder-desktop.png`, `${scratch}\\workflow-builder-mobile.png`] }))
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close()
  browser.kill()
}
