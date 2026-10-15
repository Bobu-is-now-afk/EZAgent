import { connection } from 'next/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import '../documents.css'

export const metadata = {
  title: '託管處理預覽 | EZAgent',
  description: '不提交資料的託管處理狀態示意。',
}

export default async function HostedPreviewPage() {
  await connection()
  if (process.env.EZAGENT_DOCUMENTS_HOSTED_UI_PREVIEW !== '1') notFound()

  return <main className="documents-shell min-h-screen">
    <header className="documents-topbar">
      <Link className="brand-link" href="/documents"><span className="brand-mark">E</span><span>EZAgent</span></Link>
      <div className="topbar-center"><span className="status-dot" />託管處理預覽 <span className="topbar-divider">/</span> 未連線</div>
      <div className="topbar-actions"><Link href="/documents" className="quiet-button">返回文件工作台</Link></div>
    </header>

    <section className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950" role="note">
        <p className="text-xs font-semibold uppercase tracking-wide">預覽 · 尚未提供託管處理</p>
        <h1 className="mt-2 text-2xl font-semibold">此頁不會提交或傳送資料</h1>
        <p className="mt-3 leading-7">以下只示意未來可能顯示的狀態，沒有連接 Mac mini 服務，也不會呼叫文件 API。若日後啟用託管處理，提交的資料將由 CantoNet Mac mini 處理。</p>
        <p className="mt-3 leading-7">資料保留與刪除政策尚未提供。請勿在此預覽或目前的文件示範中輸入真實客戶資料。</p>
      </div>

      <div className="mt-8 flex items-end justify-between gap-4">
        <div><p className="text-sm font-semibold text-zinc-500">狀態畫面示意</p><h2 className="mt-1 text-xl font-semibold">可能遇到的處理狀態</h2></div>
        <span className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600">靜態示意 · 非即時狀態</span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <article className="rounded-xl border border-zinc-200 bg-white p-5"><p className="text-xs font-semibold text-zinc-500">等待中 · 示意</p><h3 className="mt-2 text-lg font-semibold">正在等待處理</h3><p className="mt-2 text-sm leading-6 text-zinc-600">畫面可提示請稍候；不顯示等待時間或排隊位置承諾。</p></article>
        <article className="rounded-xl border border-zinc-200 bg-white p-5"><p className="text-xs font-semibold text-zinc-500">處理中 · 示意</p><h3 className="mt-2 text-lg font-semibold">正在整理文件資料</h3><p className="mt-2 text-sm leading-6 text-zinc-600">完成前保留明確的處理狀態；本預覽不會執行任何處理。</p></article>
        <article className="rounded-xl border border-zinc-200 bg-white p-5"><p className="text-xs font-semibold text-zinc-500">服務暫不可用 · 示意</p><h3 className="mt-2 text-lg font-semibold">目前無法連接服務</h3><p className="mt-2 text-sm leading-6 text-zinc-600">提示稍後重試。服務可用性與資料保留規則尚未提供。</p></article>
        <article className="rounded-xl border border-zinc-200 bg-white p-5"><p className="text-xs font-semibold text-zinc-500">重試 · 示意</p><h3 className="mt-2 text-lg font-semibold">可在確認後重試</h3><p className="mt-2 text-sm leading-6 text-zinc-600">重試方式與取消能力尚未實作；這張卡片不會執行重試。</p></article>
      </div>
    </section>
  </main>
}
