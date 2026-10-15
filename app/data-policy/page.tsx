import Link from 'next/link'
import { DOCUMENT_DATA_POLICY } from '../../lib/documents/policy'

export const metadata = { title: '資料政策 | EZAgent' }

export default function DataPolicyPage() {
  const sections = [
    ['適用對象', DOCUMENT_DATA_POLICY.audience],
    ['資料處理位置', DOCUMENT_DATA_POLICY.processing],
    ['儲存內容', DOCUMENT_DATA_POLICY.stored],
    ['儲存位置', DOCUMENT_DATA_POLICY.location],
    ['使用限制', DOCUMENT_DATA_POLICY.limits],
    ['保留與刪除', DOCUMENT_DATA_POLICY.retention],
    ['備份與營運', DOCUMENT_DATA_POLICY.backup],
  ] as const

  return <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-zinc-900">
    <header className="mb-10 border-b border-zinc-200 pb-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">EZAgent · 版本 {DOCUMENT_DATA_POLICY.version}</p>
      <h1 className="mt-3 text-3xl font-semibold">{DOCUMENT_DATA_POLICY.title}</h1>
      <p className="mt-3 text-sm leading-6 text-zinc-600">本頁說明受控 hosted 文件示範。除非伺服器已設定相符的政策版本與安全設定，否則 hosted 文件存取會維持停用。</p>
    </header>
    <div className="space-y-8">
      {sections.map(([heading, text]) => <section key={heading}>
        <h2 className="text-lg font-semibold">{heading}</h2>
        <p className="mt-2 text-sm leading-7 text-zinc-700">{text}</p>
      </section>)}
    </div>
    <footer className="mt-10 border-t border-zinc-200 pt-6 text-sm text-zinc-600">
      <Link href="/documents" className="font-medium text-emerald-800 underline underline-offset-4">返回文件工作台</Link>
    </footer>
  </main>
}
