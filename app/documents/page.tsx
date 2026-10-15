import { DocumentWorkbench } from '@/components/documents/document-workbench'
import './documents.css'

export const metadata = {
  title: '文件工作台 | EZAgent',
  description: '建立並覆核合成報價單、發票及收據草稿。',
}

export default function DocumentsPage() {
  return <DocumentWorkbench />
}
