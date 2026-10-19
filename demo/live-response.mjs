const isText = (value) => typeof value === 'string' && value.trim().length > 0
const ROLE_IDS = ['gm', 'research_manager', 'delivery_manager', 'analysis_worker', 'document_worker']

function requireLiveEnvelope(value) {
  if (!value || value.status !== 'live' || value.source !== 'gemini' || !isText(value.model)) {
    throw new Error('Gemini backend response did not confirm a live result.')
  }
}

export function parseChatResponse(value) {
  requireLiveEnvelope(value)
  if (!isText(value.answer)) throw new Error('Gemini chat response has no answer.')
  return { model: value.model, text: value.answer.trim() }
}

export function parseAgentResponse(value) {
  requireLiveEnvelope(value)
  if (!Array.isArray(value.roles) || value.roles.length !== ROLE_IDS.length || value.roles.some((role, index) => role?.id !== ROLE_IDS[index] || !isText(role?.label) || !isText(role?.responsibility))) {
    throw new Error('Gemini agent response has an invalid proposed role list.')
  }
  if (!Array.isArray(value.proposedSteps) || value.proposedSteps.length > 4 || value.proposedSteps.some((step) => !isText(step))) {
    throw new Error('Gemini agent response has invalid proposed steps.')
  }
  if (!Array.isArray(value.missing) || value.missing.length > 4 || value.missing.some((item) => !isText(item))) {
    throw new Error('Gemini agent response has an invalid missing-information list.')
  }

  const sections = [
    'Proposed roles',
    ...value.roles.map((role) => `- ${role.label}: ${role.responsibility}`),
    '',
    'Proposed steps',
    ...(value.proposedSteps.length ? value.proposedSteps.map((step) => `- ${step}`) : ['- No proposed steps were returned.']),
    '',
    'Missing information for human review',
    ...(value.missing.length ? value.missing.map((item) => `- ${item}`) : ['- No missing items were returned by this draft.']),
  ]
  return { model: value.model, text: sections.join('\n') }
}
