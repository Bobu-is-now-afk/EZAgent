const views = [...document.querySelectorAll('.view')]
const nav = [...document.querySelectorAll('.nav')]
const byId = id => document.getElementById(id)
let documentType = 'quotation'
let pendingSuggestion = null
let reviewed = false

function go(id) {
  views.forEach(view => view.classList.toggle('active', view.id === id))
  nav.forEach(button => button.classList.toggle('active', button.dataset.go === id))
  history.replaceState(null, '', `#${id}`)
  window.scrollTo({ top: 0, behavior: 'instant' })
}
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => go(button.dataset.go)))
const initial = location.hash.slice(1)
if (views.some(view => view.id === initial)) go(initial)

byId('detect').addEventListener('click', () => {
  byId('detect-status').textContent = '劇本已選用 Mac mini M6／32 GB。這不是瀏覽器硬體偵測結果。'
  byId('recommend').hidden = false
  byId('download').disabled = false
})
byId('download').addEventListener('click', () => {
  const button = byId('download')
  button.disabled = true
  let value = 0
  byId('download-status').textContent = '模擬下載中；不會取得或安裝任何模型檔。'
  const timer = setInterval(() => {
    value = Math.min(100, value + 10)
    byId('progress-bar').style.width = `${value}%`
    if (value === 100) {
      clearInterval(timer)
      byId('download-status').textContent = '模擬完成。真正的本機安裝與離線驗收尚未包含在網站版。'
      button.disabled = false
      button.textContent = '重新播放下載動畫'
    }
  }, 180)
})

async function callApi(path, text) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
  const data = await response.json()
  if (!response.ok) {
    const errors = { gemini_not_configured: '尚未設定 GEMINI_API_KEY；可先展示模擬流程。', demo_busy: '示範流量已滿，請稍後再試。', gemini_unavailable: 'Gemini 暫時無法回應，請使用備援影片。', invalid_input: '請輸入較短的內容。' }
    throw new Error(errors[data.error] ?? '請稍後重試。')
  }
  return data
}

byId('chat-form').addEventListener('submit', async event => {
  event.preventDefault()
  const text = byId('chat-input').value.trim()
  if (!text) return
  const area = byId('conversation')
  const user = document.createElement('div')
  user.className = 'bubble user'; user.textContent = text; area.append(user)
  const reply = document.createElement('div')
  reply.className = 'bubble assistant'; reply.textContent = 'Gemini 處理中…'; area.append(reply)
  const button = event.target.querySelector('button'); button.disabled = true
  try { reply.textContent = (await callApi('/api/chat', text)).answer } catch (error) { reply.textContent = error.message }
  finally { button.disabled = false; area.scrollTop = area.scrollHeight }
})

document.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => {
  documentType = button.dataset.type
  document.querySelectorAll('[data-type]').forEach(item => item.classList.toggle('selected', item === button))
  byId('paper-type').textContent = { quotation: 'QUOTATION', invoice: 'INVOICE', receipt: 'RECEIPT' }[documentType]
  invalidate()
}))

function money(value) { return (Math.round(Number(value) * 100) / 100).toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function invalidate() {
  reviewed = false
  byId('review-status').textContent = '欄位有變更；請重新核對。此原型不簽發真實文件。'
}
function updatePaper() {
  byId('paper-buyer').textContent = byId('buyer').value.trim() || '待填客戶'
  byId('paper-description').textContent = byId('description').value.trim() || '待填工作項目'
  byId('paper-quantity').textContent = byId('quantity').value || '—'
  const quantity = Number(byId('quantity').value)
  const price = Number(byId('price').value)
  const valid = byId('price').value !== '' && Number.isFinite(price) && price >= 0 && Number.isInteger(quantity) && quantity > 0 && quantity <= 99
  byId('paper-price').textContent = valid ? money(price) : '—'
  byId('paper-subtotal').textContent = valid ? money(price * quantity) : '—'
  byId('paper-total').textContent = valid ? money(price * quantity) : '待填單價'
  byId('paper-terms').textContent = byId('terms').value.trim() || '條款待確認'
}
document.querySelectorAll('.fields input,.fields textarea').forEach(input => input.addEventListener('input', () => { updatePaper(); invalidate() }))

byId('suggest-form').addEventListener('submit', async event => {
  event.preventDefault()
  const button = event.target.querySelector('button'); button.disabled = true
  const output = byId('suggestion'); output.textContent = 'Gemini 正在分析文字；未知價格會保持空白。'
  try {
    pendingSuggestion = (await callApi('/api/suggest', byId('custom-text').value.trim())).suggestion
    output.textContent = `建議客戶：${pendingSuggestion.buyer || '未提供'}\n建議項目：${pendingSuggestion.description || '未提供'}\n建議數量：${pendingSuggestion.quantity ?? '未提供'}\n仍待確認：${pendingSuggestion.missing.join('、') || '請自行核對'}\n價格：AI 不填寫。`
    const apply = document.createElement('button'); apply.className = 'secondary'; apply.type = 'button'; apply.textContent = '套用可確認的建議'
    apply.addEventListener('click', () => {
      if (pendingSuggestion.buyer) byId('buyer').value = pendingSuggestion.buyer
      if (pendingSuggestion.description) byId('description').value = pendingSuggestion.description
      if (pendingSuggestion.quantity) byId('quantity').value = String(pendingSuggestion.quantity)
      updatePaper(); invalidate(); output.append(document.createTextNode('\n已套用；請逐欄核對。')); apply.remove()
    })
    output.append(document.createElement('br'), apply)
  } catch (error) { output.textContent = error.message }
  finally { button.disabled = false }
})
byId('review').addEventListener('click', () => {
  const buyer = byId('buyer').value.trim(), description = byId('description').value.trim(), quantity = Number(byId('quantity').value), price = Number(byId('price').value)
  const missing = []
  if (!buyer) missing.push('客戶')
  if (!description) missing.push('工作項目')
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) missing.push('數量')
  if (byId('price').value === '' || !Number.isFinite(price) || price < 0) missing.push('單價')
  if (documentType === 'receipt') missing.push('付款日期與付款證明（此原型未提供）')
  if (missing.length) { reviewed = false; byId('review-status').textContent = `尚不能核對完成：${missing.join('、')}。` ; return }
  reviewed = true
  byId('review-status').textContent = `示範草稿已核對：HKD ${money(price * quantity)}。此動作沒有簽發、匯出或傳送文件。`
})
updatePaper()

document.querySelectorAll('[data-template]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-template]').forEach(item => item.classList.toggle('selected', item === button))
  byId('flow-title').textContent = { documents: '文件工作流', review: '文件核對工作流', other: '自訂任務草圖' }[button.dataset.template]
  byId('flow-status').textContent = '已切換展示模板；結構仍未部署。'
}))
byId('preview-flow').addEventListener('click', () => {
  const approval = byId('approval').value
  byId('approval-label').textContent = { manager: '經理確認', operator: '操作員檢查', none: '略過審批節點' }[approval]
  byId('approval-help').textContent = approval === 'manager' ? '示意節點，未驗證身分' : '此選項只改變展示配置'
  byId('flow-status').textContent = `預覽已更新：${byId('missing-rule').value === 'pause' ? '缺欄暫停' : '缺欄只建草稿'}；${byId('approval-label').textContent}。未執行工作流。`
})
