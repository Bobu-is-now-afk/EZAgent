// Local system actions are never available to remote origins, forms or DNS aliases.
export function isLocalRequest(request: Request, mutation = false) {
  const host = request.headers.get('host')
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false
  const origin = request.headers.get('origin')
  if (origin && origin !== `http://${host}` && origin !== `https://${host}`) return false
  if (mutation && (!origin || request.headers.get('content-type') !== 'application/json')) return false
  return request.headers.get('sec-fetch-site') !== 'cross-site'
}
