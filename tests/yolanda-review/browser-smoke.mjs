import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, readdir, writeFile } from 'node:fs/promises'

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const scratch = 'D:\\work\\scratch-2026-10-05\\ezagent-yolanda-browser'
const runId = Date.now()
const downloads = `${scratch}\\downloads-${runId}`
const debugPort = 9300 + Math.floor(Math.random() * 500)
const profile = `${scratch}\\profile-${runId}`
await mkdir(downloads, { recursive: true })

const browser = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  '--window-size=1440,1000', 'http://localhost:3107/yolanda-review',
], { stdio: 'ignore' })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let socket
let messageId = 0
const pending = new Map()

async function getPage() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json())
      const page = pages.find((item) => item.type === 'page' && item.url.includes('/yolanda-review'))
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
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evaluate(expression)) return
    await wait(200)
  }
  throw new Error(`Timed out: ${description}`)
}

const click = (text) => evaluate(`(() => { const element = [...document.querySelectorAll('button')].find((item) => item.textContent.includes(${JSON.stringify(text)})); if (!element) return false; element.click(); return true })()`)
const chooseDocument = (recordId) => click(recordId)
const setControl = (label, value) => evaluate(`(() => { const element = document.querySelector('[aria-label=${JSON.stringify(label)}]'); if (!element) return false; const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true })()`)
const bodyIncludes = (text) => `document.body.innerText.includes(${JSON.stringify(text)})`

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
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
  await until(bodyIncludes('Review & Approval'), 'page heading')
  assert.equal(await evaluate(bodyIncludes('Synthetic demonstration data')), true)
  assert.equal(await evaluate(bodyIncludes('Confirm task assumptions.')), true)

  assert.equal(await click('Review & confirm'), true)
  assert.equal(await click('Save & confirm'), true)
  await until(bodyIncludes('Revision v2'), 'assumption revision')
  await until(`!document.body.innerText.includes('Calculating v2')`, 'assumption recalculation')

  await chooseDocument('rec-002')
  await click('Edit fields')
  await setControl('amount', '86.50')
  await evaluate(`sessionStorage.setItem('yolanda-demo-fail-next', 'true')`)
  await click('Save correction')
  await until(bodyIncludes('Calculation failed.'), 'synthetic calculation failure')
  assert.equal(await click('Retry calculation'), true)
  await until(`!document.body.innerText.includes('Calculating v3')`, 'successful calculation retry')

  await chooseDocument('rec-003')
  await click('Edit fields')
  await setControl('date', '2026-09-10')
  await click('Save correction')
  await until(`!document.body.innerText.includes('Calculating v4')`, 'date recalculation')

  for (const [recordId, reason] of [['rec-004', 'Duplicate copy of rec-001'], ['rec-006', 'No supporting ledger row; follow up outside batch'], ['rec-007', 'Unsupported USD item retained for follow-up']]) {
    await chooseDocument(recordId)
    await setControl('Exclusion reason', reason)
    await click('Exclude with evidence retained')
    await until(`!document.body.innerText.includes('Calculating v')`, `${recordId} exclusion recalculation`)
  }

  await chooseDocument('rec-005')
  await setControl('Eligible ledger candidate', 'led-004a')
  await setControl('Match decision reason', 'Evidence merchant and exact amount/date support this row')
  await click('Save match decision')
  await until(`!document.body.innerText.includes('Calculating v')`, 'manual match recalculation')
  assert.equal(await evaluate(bodyIncludes('0 blockers')), true)

  await chooseDocument('rec-008')
  await setControl('Warning acknowledgement reason', 'Instruction-like evidence was treated as plain text and ignored')
  await click('Save review notes')

  await click('Review numeric results')
  await click('Review draft')
  await setControl('Demo role', 'manager')
  await until(bodyIncludes('All current-version checks passed.'), 'approval gate')
  await click('Approve v')
  await until(bodyIncludes('Approved v'), 'approval')
  await setControl('Demo role', 'reviewer')
  await until(bodyIncludes('Manager role is required to export or revoke'), 'post-approval role guard')
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'JSON')?.disabled`), true)
  await setControl('Demo role', 'manager')
  assert.equal(await click('JSON'), true)
  for (let attempt = 0; attempt < 30 && !(await readdir(downloads)).some((name) => name.endsWith('-review.json')); attempt++) await wait(200)
  assert.ok((await readdir(downloads)).some((name) => name.endsWith('-review.json')), 'approved JSON download exists')

  await chooseDocument('rec-008')
  await click('Edit fields')
  await setControl('merchant', 'Safe Demo Shop — reviewed')
  await click('Save correction')
  await until(bodyIncludes('current approval is no longer valid'), 'approval invalidation')
  await until(`!document.body.innerText.includes('Calculating v9')`, 'post-approval edit recalculation')
  assert.equal(await evaluate(`document.body.innerText.includes('invalidated by v')`), true)
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].some((item) => item.textContent.trim() === 'JSON')`), false)

  assert.equal(await click('Save UNAPPROVED copy'), true)
  let workingCopy
  for (let attempt = 0; attempt < 30 && !workingCopy; attempt++) {
    workingCopy = (await readdir(downloads)).find((name) => name.includes('UNAPPROVED-working-copy'))
    if (!workingCopy) await wait(200)
  }
  assert.ok(workingCopy, 'unapproved working copy download exists')
  await evaluate(`window.confirm = () => true`)
  const documentNode = await command('DOM.getDocument')
  const fileInput = await command('DOM.querySelector', { nodeId: documentNode.result.root.nodeId, selector: 'input[type=file]' })
  await command('DOM.setFileInputFiles', { nodeId: fileInput.result.nodeId, files: [`${downloads}\\${workingCopy}`] })
  await until(bodyIncludes('Working copy restored as unapproved'), 'working copy restore')
  assert.equal(await evaluate(bodyIncludes('Approved v')), false)

  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(`${scratch}\\yolanda-review-smoke.png`, Buffer.from(screenshot.result.data, 'base64'))
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true)
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  assert.notEqual(await evaluate(`document.activeElement === document.body`), true)
  const mobileScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(`${scratch}\\yolanda-review-mobile.png`, Buffer.from(mobileScreenshot.result.data, 'base64'))
  console.log(JSON.stringify({ result: 'passed', revision: await evaluate(`document.body.innerText.match(/Revision v(\\d+)/)?.[1]`), downloaded: await readdir(downloads), screenshots: [`${scratch}\\yolanda-review-smoke.png`, `${scratch}\\yolanda-review-mobile.png`] }))
} finally {
  socket?.close()
  browser.kill()
}
