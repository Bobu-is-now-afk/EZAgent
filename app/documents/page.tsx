import { connection } from 'next/server'
import { DocumentWorkbench } from '@/components/documents/document-workbench'
import { readDocumentRuntimeMode } from '@/lib/documents/runtime-mode'
import './documents.css'

export const metadata = {
  title: '文件工作台 | EZAgent',
  description: '建立並覆核合成報價單、發票及收據草稿。',
}

export default async function DocumentsPage() {
  await connection()
  return <DocumentWorkbench
    localAppMode={process.env.EZAGENT_LOCAL_APP_MODE === '1'}
    hostedMode={readDocumentRuntimeMode() !== 'local'}
    policyVersion={process.env.EZAGENT_DOCUMENTS_POLICY_VERSION ?? ''}
  />
}
