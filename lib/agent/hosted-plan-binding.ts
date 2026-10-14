export type HostedPlanSource = { name: string; type: 'csv' | 'text'; content: string }
export type HostedPlanSourceFingerprint = { nameSha256: string; type: 'csv' | 'text'; sha256: string }
export type HostedPlanSourceBinding = {
  jobId: string
  planVersion: 1
  sourceNameSha256: string
  sourceType: 'csv' | 'text'
  sourceSha256: string
}

export async function createHostedPlanSourceFingerprint(source: HostedPlanSource): Promise<HostedPlanSourceFingerprint> {
  const [nameDigest, contentDigest] = await Promise.all([
    globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source.name)),
    globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source.content)),
  ])
  const toHex = (digest: ArrayBuffer) => Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return { nameSha256: toHex(nameDigest), type: source.type, sha256: toHex(contentDigest) }
}

export function matchesHostedPlanSourceBinding(
  expected: HostedPlanSourceBinding | null,
  selected: HostedPlanSourceFingerprint | null,
): boolean {
  return Boolean(expected && selected && expected.sourceNameSha256 === selected.nameSha256 && expected.sourceType === selected.type && expected.sourceSha256 === selected.sha256)
}

export function isValidHostedPlanSourceBinding(value: unknown): value is HostedPlanSourceBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const binding = value as Record<string, unknown>
  return typeof binding.jobId === 'string' && /^[0-9a-f-]{36}$/i.test(binding.jobId) && binding.planVersion === 1 &&
    typeof binding.sourceNameSha256 === 'string' && /^[a-f0-9]{64}$/.test(binding.sourceNameSha256) &&
    (binding.sourceType === 'csv' || binding.sourceType === 'text') && typeof binding.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(binding.sourceSha256)
}
