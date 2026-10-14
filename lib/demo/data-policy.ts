export const DEMO_DATA_POLICY_PATH = '/demo-data-policy'
export const DEMO_DATA_POLICY_REVISION = '2026-10-14-v1'

export const DEMO_DATA_POLICY = {
  revision: DEMO_DATA_POLICY_REVISION,
  title: 'EZAgent hosted invoice demo data notice',
  sections: [
    {
      heading: 'Do not submit sensitive data',
      body: 'Use synthetic or non-sensitive sample data only. This hosted demo is not approved for customer records, personal data, payment data, credentials, or confidential business information.',
    },
    {
      heading: 'Where processing happens',
      body: 'Submitted invoice content is processed by the EZAgent application and its configured local model on the demo host. The app does not intentionally send invoice source text to a third-party model API.',
    },
    {
      heading: 'Runs, source files, and artifacts',
      body: 'Agent run metadata, uploaded source files, and generated CSV artifacts are stored on the demo host under its local EZAgent data directory. The app currently has no automatic retention period or self-service deletion for these run records, source files, or artifacts. An operator must remove them.',
    },
    {
      heading: 'Plan queue',
      body: 'Queued plan input and completed plan results are held in process memory and are not written to the queue metadata file. Queue metadata contains a job ID, hashed owner identifier, status, timestamps, a plan version, the source type, SHA-256 hashes of the source contents and source name, and a safe error code. The source name itself is not stored. Terminal job metadata is removed at 24 hours while the process is running and is also trimmed on restart.',
    },
    {
      heading: 'Usage limits and logs',
      body: 'Daily quota state is stored on the demo host with hashed visitor identifiers and request counts. A later UTC-day quota write replaces the prior day snapshot; after inactivity, the prior file can remain until another quota write. Application code does not intentionally log submitted source contents or access codes. Host, reverse-proxy, and platform log settings have not been independently verified.',
    },
    {
      heading: 'Backups and deletion requests',
      body: 'The application does not create backups. Host or platform backup behavior has not been independently verified. There is no self-service deletion control; run data and artifacts remain until an operator removes them. Do not submit data that requires a guaranteed deletion deadline.',
    },
  ],
} as const

export function isPublishedDemoPolicy(path: string): boolean {
  return path === DEMO_DATA_POLICY_PATH && DEMO_DATA_POLICY.sections.length >= 6 && DEMO_DATA_POLICY.revision === DEMO_DATA_POLICY_REVISION
}

export async function verifyPublishedDemoPolicy(response: Response): Promise<boolean> {
  if (!response.ok || response.headers.get('X-EZAgent-Policy-Revision') !== DEMO_DATA_POLICY_REVISION ||
      !response.headers.get('content-type')?.startsWith('text/html')) return false
  const html = await response.text()
  return html.includes(`<h1>${DEMO_DATA_POLICY.title}</h1>`) && html.includes(`Policy revision: ${DEMO_DATA_POLICY.revision}`) &&
    DEMO_DATA_POLICY.sections.every(({ heading, body }) => html.includes(`<h2>${heading}</h2>`) && html.includes(`<p>${body}</p>`))
}
