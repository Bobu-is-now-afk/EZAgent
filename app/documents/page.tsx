import { connection } from 'next/server'
import { DocumentWorkbench } from '@/components/documents/document-workbench'
import './documents.css'

export const metadata = {
  title: '文件工作台 | EZAgent',
  description: '建立並覆核合成報價單、發票及收據草稿。',
}

export default async function DocumentsPage() {
  await connection()
  return <DocumentWorkbench
    localAppMode={process.env.EZAGENT_LOCAL_APP_MODE === '1'}
    hostedMode={process.env.EZAGENT_HOSTED_DOCUMENTS_ENABLED === '1'}
    policyVersion={process.env.EZAGENT_DOCUMENTS_POLICY_VERSION ?? ''}
  />
}
