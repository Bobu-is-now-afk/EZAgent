// Public invented fixtures only. No caller text, tools, URLs, or model options.
const FIXTURES = Object.freeze({
  design: { request: 'One fictional design session', item: 'design', amount: 800 },
  print: { request: 'One fictional print bundle', item: 'print', amount: 120 },
  consultation: { request: 'One fictional consultation', item: 'consultation', amount: 500 },
})

export function syntheticRequest(body) {
  if (!body || Array.isArray(body) || Object.keys(body).length !== 1 ||
      typeof body.scenario !== 'string' || !Object.hasOwn(FIXTURES, body.scenario)) return null
  return {
    messages: [
      { role: 'system', content: 'Classify the fictional request. Return only JSON with one key item, equal to design, print, or consultation. No tools.' },
      { role: 'user', content: FIXTURES[body.scenario].request },
    ],
    response_format: { type: 'json_object' }, temperature: 0, max_tokens: 512,
  }
}

export function syntheticResult(scenario, result) {
  const fixture = FIXTURES[scenario]
  const message = result?.choices?.[0]?.message
  if (!fixture || message?.tool_calls?.length || typeof message?.content !== 'string' ||
      message.content.length > 512) return null
  let parsed
  try { parsed = JSON.parse(message.content) } catch { return null }
  if (!parsed || Object.keys(parsed).length !== 1 || parsed.item !== fixture.item) return null
  return { demoOnly: true, status: 'draft_only', source: 'live_model',
    scenario, item: fixture.item, currency: 'HKD', amount: fixture.amount }
}
