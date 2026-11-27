// An illustration of the Galax Login window (sample data only: documentation IP ranges, made-up
// profile names). Drawn at 1100×680 and scaled by FitWidth, so it is crisp at any size.
import { BotIcon, FolderIcon, LayersIcon, NetworkIcon, PlayIcon, PlusIcon, SearchIcon, SettingsIcon, TagIcon, WorkflowIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ICON } from './shared'

export const APP_W = 1100
export const APP_H = 680

const ROWS = [
  { name: 'shop-hn-01', group: 'Shop', proxy: '203.0.113.24', kind: 'HTTP', tags: ['shop'], running: true, last: '08:12' },
  { name: 'shop-hn-02', group: 'Shop', proxy: '203.0.113.57', kind: 'SOCKS5', tags: ['shop'], running: true, last: '08:12' },
  { name: 'ads-team-a', group: 'Ads', proxy: 'xoay · tm://…', kind: 'Xoay', tags: ['ads', 'vn'], running: true, last: '07:58' },
  { name: 'ads-team-b', group: 'Ads', proxy: 'xoay · kiot://…', kind: 'Xoay', tags: ['ads'], running: false, last: 'Hôm qua' },
  { name: 'seller-sg', group: 'Shop', proxy: '198.51.100.9', kind: 'HTTP', tags: ['sg'], running: false, last: 'Hôm qua' },
  { name: 'review-07', group: 'Review', proxy: '192.0.2.140', kind: 'SOCKS5', tags: ['review'], running: true, last: '07:41' },
  { name: 'review-08', group: 'Review', proxy: '192.0.2.141', kind: 'SOCKS5', tags: ['review'], running: false, last: '25/11' },
  { name: 'test-ipv6', group: 'Test', proxy: '2001:db8::1a', kind: 'IPv6', tags: ['ipv6'], running: false, last: '24/11' },
]
const TAG_COLOR: Record<string, string> = {
  shop: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', ads: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  vn: 'bg-rose-500/15 text-rose-700 dark:text-rose-300', sg: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  review: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', ipv6: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300',
}

export function AppWindow({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col overflow-hidden rounded-[14px] border bg-background text-[12px] shadow-2xl shadow-black/25 dark:shadow-black/60', className)}
      style={{ width: APP_W, height: APP_H }} aria-hidden>
      {/* title bar (Windows) */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b bg-muted/40 pl-3">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><img src={ICON} alt="" className="size-4 rounded" /> Galax Login</div>
        <div className="flex h-full text-muted-foreground">
          {['—', '▢', '✕'].map((c) => <span key={c} className="grid w-11 place-items-center text-[11px]">{c}</span>)}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* sidebar */}
        <aside className="flex w-48 shrink-0 flex-col gap-0.5 border-r bg-muted/30 p-2.5">
          <div className="mb-2 flex items-center gap-2 px-2 py-1.5"><img src={ICON} alt="" className="size-6 rounded-md" />
            <div><div className="text-[12.5px] font-semibold leading-tight">Galax Login</div><div className="text-[10px] text-muted-foreground">Pure Rust Core</div></div></div>
          {[
            [LayersIcon, 'Profile', '8'], [NetworkIcon, 'Kho proxy', '24'], [FolderIcon, 'Nhóm', '4'], [TagIcon, 'Tag', '6'],
            [WorkflowIcon, 'Kịch bản', '3'], [BotIcon, 'API & MCP', ''], [SettingsIcon, 'Cài đặt', ''],
          ].map(([Icon, label, n], i) => {
            const I = Icon as typeof LayersIcon
            return (
              <div key={label as string} className={cn('flex items-center gap-2.5 rounded-md px-2 py-1.5', i === 0 ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground')}>
                <I className="size-3.5" /> <span className="flex-1">{label as string}</span>{n && <span className="text-[10px] opacity-70">{n as string}</span>}
              </div>
            )
          })}
        </aside>
        {/* main */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-5 py-3">
            <div className="text-[15px] font-semibold">Quản lý Profile</div>
            <div className="flex items-center gap-2 text-[11px]">
              <span className="flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono"><span className="size-1.5 rounded-full bg-emerald-500" />127.0.0.1:19995</span>
              <span className="rounded-md border px-2 py-1">Đang chạy: 4</span>
            </div>
          </div>
          <div className="flex items-center gap-2 px-5 py-3">
            <span className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground"><PlusIcon className="size-3.5" /> Thêm mới</span>
            <span className="flex w-64 items-center gap-2 rounded-md border px-2.5 py-1.5 text-muted-foreground"><SearchIcon className="size-3.5" /> Tìm tên, nhóm, tag, ghi chú…</span>
            <span className="rounded-md border px-2.5 py-1.5">Tất cả nhóm (4)</span>
            <span className="rounded-md border px-2.5 py-1.5">Mới nhất</span>
            <span className="ml-auto rounded-md border px-2.5 py-1.5">Test proxy</span>
          </div>
          <div className="mx-5 flex-1 overflow-hidden rounded-lg border">
            <div className="grid grid-cols-[28px_1.4fr_1.3fr_1fr_0.8fr_64px] items-center gap-3 border-b bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="size-3.5 rounded border" /><span>Tên profile</span><span>Proxy</span><span>Tag</span><span>Lần chạy</span><span />
            </div>
            {ROWS.map((r) => (
              <div key={r.name} className="grid grid-cols-[28px_1.4fr_1.3fr_1fr_0.8fr_64px] items-center gap-3 border-b px-3 py-[9px] last:border-0">
                <span className="size-3.5 rounded border" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-medium"><span className={cn('size-1.5 rounded-full', r.running ? 'bg-emerald-500' : 'bg-muted-foreground/30')} />{r.name}</span>
                  <span className="text-[10px] text-muted-foreground">{r.group} · Win32 · 8 GB</span>
                </span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[9.5px] font-semibold text-muted-foreground">{r.kind}</span>
                  <span className="truncate font-mono text-[11px]">{r.proxy}</span>
                </span>
                <span className="flex gap-1">{r.tags.map((t) => <span key={t} className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', TAG_COLOR[t])}>#{t}</span>)}</span>
                <span className="text-muted-foreground tabular-nums">{r.last}</span>
                <span className={cn('flex items-center justify-center gap-1 rounded-md py-1 text-[11px] font-medium', r.running ? 'border text-muted-foreground' : 'bg-foreground text-background')}>
                  {r.running ? 'Đóng' : <><PlayIcon className="size-3" /> Mở</>}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-5 py-2.5 text-[11px] text-muted-foreground"><span>Tổng 8</span><span>Mỗi trang 50 · 1</span></div>
        </main>
      </div>
    </div>
  )
}
