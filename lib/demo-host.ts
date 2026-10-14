export function isLocalHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '::1'
    || normalized === '0.0.0.0'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

export function isHostedDemoHostname(hostname: string) {
  return !isLocalHostname(hostname)
}
