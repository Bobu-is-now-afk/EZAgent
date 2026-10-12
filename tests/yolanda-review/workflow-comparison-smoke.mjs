import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

const edge = process.env.EZAGENT_EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const siteUrl = process.env.EZAGENT_URL ?? 'http://localhost:3112'
const scratch = process.env.EZAGENT_SCRATCH ?? 'D:\\个人开发探索\\ignite\\scratch-2026-10-12\\ezagent-workflow-comparison'
const debugPort = 9800 + Math.floor(Math.random() * 150)
await mkdir(scratch, { recursive: true })

const browser = spawn(edge, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${scratch}\\profile-${Date.now()}`,
  '--window-size=1440,1100', siteUrl,
], { stdio: 'ignore' })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let socket
let messageId = 0
const pending = new Map()

async function getPage() {
  for (let attempt = 0; attempt < 80; attempt++) {
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
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return
    await wait(200)
  }
  throw new Error(`Timed out: ${description}`)
}

const bodyIncludes = (value) => `document.body.innerText.includes(${JSON.stringify(value)})`
const clickExact = (value) => evaluate(`(() => { const element = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(value)}); if (!element) return false; element.click(); return true })()`)
const clickAriaLabel = (value) => evaluate(`(() => { const element = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === ${JSON.stringify(value)}); if (!element) return false; element.click(); return true })()`)

async function navigate(path) {
  await command('Page.navigate', { url: `${siteUrl}${path}` })
  await until(`location.pathname === ${JSON.stringify(path.split('?')[0])}`, `navigation to ${path}`)
}

async function screenshot(name) {
  const capture = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const path = `${scratch}\\${name}`
  await writeFile(path, Buffer.from(capture.result.data, 'base64'))
  return path
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

  await until(bodyIncludes('你今天想做什麼？'), 'original workspace home')
  await until(bodyIncludes('第一次使用？'), 'first-use guide')
  const order = await evaluate(`['本機 AI 狀態','本機 AI 對話','設計工作流程','試用預設工具'].map((value) => document.body.innerText.indexOf(value))`)
  assert.equal(order.every((value) => value >= 0), true)
  assert.deepEqual(order, [...order].sort((a, b) => a - b))
  assert.equal(await evaluate(`document.querySelector('a[href="/chat"]') !== null && document.querySelector('a[href="/yolanda-builder"]') !== null && document.querySelector('a[href="/invoice-demo"]') !== null`), true)
  const homeScreenshot = await screenshot('home-original-workspace-first-use.png')
  assert.equal(await clickExact('跳過，直接體驗工具'), true)
  await until(`localStorage.getItem('ezagent:first-use-guide:v1:handled') === 'true'`, 'guide handled flag')
  assert.equal(await evaluate(`document.activeElement?.getAttribute('aria-label') === '工具入口'`), true)
  await command('Page.reload')
  await until(bodyIncludes('你今天想做什麼？'), 'home reload')
  assert.equal(await evaluate(bodyIncludes('第一次使用？')), false)

  await navigate('/yolanda-builder')
  await until(`document.querySelector('[data-workflow-comparison]') !== null`, 'Builder comparison banner')
  assert.equal(await evaluate(bodyIncludes('示意，非真實模型評測。')), true)
  assert.equal(await evaluate(`document.querySelectorAll('[data-workflow-comparison]').length`), 1)
  assert.equal(await clickExact('重播'), true)
  await until(`document.querySelector('[data-workflow-comparison]')?.dataset.frame === '0'`, 'animation first input')
  const firstLeftInput = await evaluate(`document.querySelector('[data-workflow-comparison] article:first-of-type p:last-child')?.textContent`)
  await until(`document.querySelector('[data-workflow-comparison]')?.dataset.frame === '2'`, 'animation second input')
  const secondLeftInput = await evaluate(`document.querySelector('[data-workflow-comparison] article:first-of-type p:last-child')?.textContent`)
  assert.equal(secondLeftInput, firstLeftInput)

  assert.equal(await clickExact('暫停'), true)
  const pausedFrame = await evaluate(`document.querySelector('[data-workflow-comparison]')?.dataset.frame`)
  await wait(3_700)
  assert.equal(await evaluate(`document.querySelector('[data-workflow-comparison]')?.dataset.frame`), pausedFrame)
  assert.equal(await clickExact('EN'), true)
  assert.equal(await evaluate(`document.querySelector('[data-workflow-comparison]')?.dataset.frame`), pausedFrame)
  assert.equal(await evaluate(bodyIncludes('Continue')), true)
  assert.equal(await clickExact('繁中'), true)
  assert.equal(await clickAriaLabel('收起對比'), true)
  const collapsedFrame = await evaluate(`document.querySelector('[data-workflow-comparison]')?.dataset.frame`)
  await wait(3_700)
  assert.equal(await evaluate(`document.querySelector('[data-workflow-comparison]')?.dataset.frame`), collapsedFrame)
  assert.equal(await clickAriaLabel('展開對比'), true)
  assert.equal(await clickExact('繼續'), true)
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 500, deviceScaleFactor: 1, mobile: false })
  await evaluate(`document.querySelector('[data-builder-step="describe"]')?.scrollIntoView({ block: 'start' })`)
  await until(`document.querySelector('[data-workflow-comparison]').getBoundingClientRect().bottom <= 0`, 'banner leaves viewport')
  await wait(3_500)
  const offscreenFrame = await evaluate(`document.querySelector('[data-workflow-comparison]')?.dataset.frame`)
  await wait(3_700)
  assert.equal(await evaluate(`document.querySelector('[data-workflow-comparison]')?.dataset.frame`), offscreenFrame)
  await evaluate(`document.querySelector('[data-workflow-comparison]')?.scrollIntoView()`)
  await until(`document.querySelector('[data-workflow-comparison]')?.dataset.frame !== ${JSON.stringify(offscreenFrame)}`, 'resume after returning to viewport')
  assert.equal(await clickExact('暫停'), true)
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false })
  const desktopBannerHeight = await evaluate(`Math.round(document.querySelector('[data-workflow-comparison]').getBoundingClientRect().height)`)
  const builderScreenshot = await screenshot('builder-comparison-paused.png')

  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true)
  const mobileBannerHeight = await evaluate(`Math.round(document.querySelector('[data-workflow-comparison]').getBoundingClientRect().height)`)
  const mobileScreenshot = await screenshot('builder-comparison-mobile.png')

  await command('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await navigate('/invoice-demo')
  await until(`document.querySelector('[data-workflow-comparison]') !== null`, 'invoice comparison banner')
  await until(`document.querySelector('[data-workflow-comparison]')?.dataset.frame === '3'`, 'reduced-motion final frame')
  const reducedFrame = await evaluate(`document.querySelector('[data-workflow-comparison]')?.dataset.frame`)
  await wait(3_700)
  assert.equal(await evaluate(`document.querySelector('[data-workflow-comparison]')?.dataset.frame`), reducedFrame)
  assert.equal(await evaluate(bodyIncludes('已依系統設定停用動畫')), true)
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true)
  const invoiceScreenshot = await screenshot('invoice-comparison-reduced-mobile.png')

  console.log(JSON.stringify({
    result: 'passed',
    homeOrder: order,
    sameLeftInput: firstLeftInput === secondLeftInput,
    bannerHeights: { desktop: desktopBannerHeight, mobile: mobileBannerHeight },
    screenshots: [homeScreenshot, builderScreenshot, mobileScreenshot, invoiceScreenshot],
  }))
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close()
  browser.kill()
}
