export type DocumentRuntimeMode = 'local' | 'hosted' | 'invalid'

/** Deployment mode is resolved separately from the hosted feature flag and never from request headers. */
export function readDocumentRuntimeMode(env: NodeJS.ProcessEnv = process.env): DocumentRuntimeMode {
  const configured = env.EZAGENT_DEPLOYMENT_MODE
  if (configured === 'local' || configured === 'hosted') return configured
  if (configured !== undefined) return 'invalid'
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') return 'local'
  return 'hosted'
}
