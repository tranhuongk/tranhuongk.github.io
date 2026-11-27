import { useState } from 'react'
import {
  ArrowDownToLineIcon, BotIcon, CheckIcon, CopyIcon, FileSpreadsheetIcon, FingerprintIcon, GlobeIcon, LayersIcon,
  MonitorIcon, NetworkIcon, PlugIcon, RefreshCwIcon, ShieldCheckIcon, WorkflowIcon,
} from 'lucide-react'
import { AnimatedGridPattern } from '@/components/ui/animated-grid-pattern'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { megabytes, useRelease, vnDate, type Release } from './release'

const ICON = `${import.meta.env.BASE_URL}icon.png`

const FEATURES: { icon: React.ReactNode; title: string; text: string }[] = [
  { icon: <LayersIcon />, title: 'Profile cô lập', text: 'Mỗi profile một trình duyệt riêng: cookie, bộ nhớ, extension tách biệt. Tạo hàng loạt 1–200 profile, chia nhóm, ghim, thùng rác, nhập/xuất JSON & CSV.' },
  { icon: <FingerprintIcon />, title: 'Chống nhận diện gốc', text: 'Múi giờ, ngôn ngữ, vị trí, số nhân CPU, User-Agent và Client Hints đặt qua CDP trước khi trang chạy — không vá JavaScript. Tự khớp theo IP của proxy.' },
  { icon: <NetworkIcon />, title: 'Proxy & proxy xoay', text: 'HTTP/SOCKS5 có mật khẩu mà không hiện hộp đăng nhập. Hỗ trợ 19 nhà cung cấp proxy xoay ở Việt Nam, đổi IP ngay khi trình duyệt đang mở.' },
  { icon: <ShieldCheckIcon />, title: 'Kho proxy', text: 'Lưu proxy riêng khỏi profile, gắn tag màu, kiểm tra song song (IP, quốc gia, độ trễ), xem proxy nào đang được profile nào dùng, chia vòng cho nhiều profile.' },
  { icon: <PlugIcon />, title: 'Tương thích API GPM Login', text: 'Các đường /api/v1 cùng dạng dữ liệu với GPM 5.1.7: script viết cho GPM chạy được ngay, chỉ đổi cổng 9495 → 19995.' },
  { icon: <BotIcon />, title: 'REST API & MCP', text: 'REST /api/v3 và máy chủ MCP 48 công cụ (HTTP + Bearer token, hoặc stdio) để trợ lý AI điều khiển profile, proxy và kịch bản.' },
  { icon: <WorkflowIcon />, title: 'Kịch bản tự động', text: 'Chạy các bước goto, click, type, scroll… bằng sự kiện chuột/phím thật trên nhiều profile cùng lúc, hoặc chạy script Python/Node/Selenium của bạn cho từng profile.' },
  { icon: <MonitorIcon />, title: 'Đồng bộ & chia lưới', text: 'Thao tác trên một cửa sổ, các cửa sổ khác làm theo (click, cuộn, phím). Xếp lưới nhiều trình duyệt trên màn hình trong một lần bấm.' },
  { icon: <FileSpreadsheetIcon />, title: 'Nhập từ Excel', text: 'Tạo profile từ .xlsx/.csv (dùng được file mẫu của GPM), kèm cookie và bookmark. Thêm, xoá, thay bookmark cho nhiều profile cùng lúc.' },
]

export default function App() {
  const r = useRelease()
  return (
    <div className="min-h-svh">
      <Header r={r} />
      <Hero r={r} />
      <section id="tinh-nang" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Mọi thứ để chạy nhiều tài khoản</h2>
          <p className="mt-3 text-muted-foreground">Viết bằng Tauri v2 và Rust: nhẹ, mở nhanh, không cần cài thêm gì ngoài Chrome hoặc Edge có sẵn.</p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title} className="gap-3 transition-shadow hover:shadow-md">
              <CardHeader className="gap-3">
                <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary [&_svg]:size-5">{f.icon}</div>
                <CardTitle className="text-base">{f.title}</CardTitle>
              </CardHeader>
              <CardContent><CardDescription className="leading-relaxed">{f.text}</CardDescription></CardContent>
            </Card>
          ))}
        </div>
      </section>
      <Api />
      <Install r={r} />
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-2"><img src={ICON} alt="" className="size-5 rounded" /> Galax Login</div>
          <div>Dành cho Windows 10 / 11 (64-bit)</div>
        </div>
      </footer>
    </div>
  )
}

function Header({ r }: { r: Release }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/75 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#" className="flex items-center gap-2.5 font-semibold">
          <img src={ICON} alt="" className="size-7 rounded-md" /> Galax Login
        </a>
        <nav className="flex items-center gap-1 text-sm">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><a href="#tinh-nang">Tính năng</a></Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><a href="#cai-dat">Cài đặt</a></Button>
          <Button asChild size="sm"><a href={r.latest_url}><ArrowDownToLineIcon data-icon="inline-start" /> Tải về</a></Button>
        </nav>
      </div>
    </header>
  )
}

function Hero({ r }: { r: Release }) {
  return (
    <section className="relative overflow-hidden border-b">
      <AnimatedGridPattern numSquares={24} maxOpacity={0.12} duration={3} repeatDelay={1}
        className="text-primary [mask-image:radial-gradient(640px_circle_at_center,white,transparent)] inset-x-0 h-full" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent)]" />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-4 pt-16 pb-20 text-center sm:pt-24 sm:pb-28">
        <img src={ICON} alt="Galax Login" className="size-24 rounded-[22px] shadow-2xl shadow-primary/30 sm:size-28" />
        <Badge variant="secondary" className="mt-8 gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {r.version ? `Phiên bản ${r.version}${r.released ? ` · ${vnDate(r.released)}` : ''}` : 'Bản mới nhất'}
        </Badge>
        <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          Mỗi profile một danh tính,{' '}
          <span className="bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500 bg-clip-text text-transparent">chạy cả trăm cùng lúc</span>
        </h1>
        <p className="mt-5 max-w-xl text-base text-muted-foreground text-pretty sm:text-lg">
          Galax Login quản lý profile trình duyệt cô lập với vân tay riêng, proxy riêng, tự động hoá và API tương thích GPM Login.
        </p>
        <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
          <Button asChild size="lg" className="h-11 w-full px-6 text-base sm:w-auto">
            <a href={r.latest_url}><ArrowDownToLineIcon data-icon="inline-start" /> Tải cho Windows</a>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-11 w-full px-6 text-base sm:w-auto"><a href="#tinh-nang">Xem tính năng</a></Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Windows 10 / 11 · 64-bit{r.size ? ` · ${megabytes(r.size)}` : ''} · tự cập nhật trong app
        </p>
      </div>
    </section>
  )
}

function Api() {
  return (
    <section className="border-y bg-muted/40">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
        <div>
          <Badge variant="outline">Cho người viết script</Badge>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Script GPM cũ chạy được ngay</h2>
          <p className="mt-3 text-muted-foreground">
            Galax Login trả dữ liệu cùng dạng với GPM Login 5.1.7 trên <code className="rounded bg-muted px-1.5 py-0.5 text-sm">/api/v1</code>,
            kèm <code className="rounded bg-muted px-1.5 py-0.5 text-sm">remote_debugging_port</code> để nối Puppeteer, Playwright hay Selenium.
            Chỉ cần đổi cổng 9495 thành 19995.
          </p>
          <ul className="mt-6 space-y-2 text-sm">
            {['REST /api/v3 đầy đủ: profile, nhóm, proxy, kịch bản', 'Máy chủ MCP 48 công cụ cho trợ lý AI', 'Mọi công cụ MCP cũng gọi được qua REST'].map((t) => (
              <li key={t} className="flex items-start gap-2"><CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" /> {t}</li>
            ))}
          </ul>
        </div>
        <Card className="overflow-hidden py-0">
          <div className="flex items-center gap-1.5 border-b bg-muted/60 px-4 py-2.5">
            {['bg-red-400', 'bg-amber-400', 'bg-emerald-400'].map((c) => <span key={c} className={cn('size-2.5 rounded-full', c)} />)}
            <span className="ml-2 text-xs text-muted-foreground">PowerShell</span>
          </div>
          <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed"><code>{`# Danh sách profile (như GPM, chỉ đổi cổng)
curl http://127.0.0.1:19995/api/v1/profiles

# Mở một profile, nhận cổng CDP để nối Playwright
curl http://127.0.0.1:19995/api/v1/profiles/start/<id>

# Đổi IP proxy xoay khi trình duyệt đang chạy
curl http://127.0.0.1:19995/api/v3/profiles/change-ip/<id>`}</code></pre>
        </Card>
      </div>
    </section>
  )
}

function Install({ r }: { r: Release }) {
  const steps = [
    { title: 'Tải bản cài', text: 'Bấm "Tải cho Windows" để lấy file Galax-Login-Setup.exe.' },
    { title: 'Chạy file cài', text: 'Nếu Windows SmartScreen cảnh báo, chọn "More info" → "Run anyway". Cài cho riêng tài khoản của bạn, không cần quyền quản trị.' },
    { title: 'Mở và tạo profile', text: 'Galax Login dùng Chrome nếu có, không thì dùng Edge sẵn trong Windows. Bản mới tự cập nhật ngay trong app.' },
  ]
  return (
    <section id="cai-dat" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
      <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Cài đặt trong một phút</h2>
          <ol className="mt-8 space-y-6">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
                <div><div className="font-medium">{s.title}</div><p className="mt-1 text-sm text-muted-foreground">{s.text}</p></div>
              </li>
            ))}
          </ol>
        </div>
        <DownloadCard r={r} />
      </div>
    </section>
  )
}

function DownloadCard({ r }: { r: Release }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(r.sha256).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  const rows: [string, string][] = [
    ['Phiên bản', r.version || 'Mới nhất'],
    ['Phát hành', vnDate(r.released)],
    ['Dung lượng', megabytes(r.size)],
    ['Hệ điều hành', 'Windows 10 / 11, 64-bit'],
  ].filter(([, v]) => v) as [string, string][]
  return (
    <Card className="self-start">
      <CardHeader className="flex-row items-center gap-3">
        <img src={ICON} alt="" className="size-11 rounded-xl" />
        <div><CardTitle>Galax Login</CardTitle><CardDescription>Bản cài cho Windows</CardDescription></div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="divide-y text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between py-2"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>
          ))}
        </dl>
        <Button asChild size="lg" className="h-11 text-base"><a href={r.latest_url}><ArrowDownToLineIcon data-icon="inline-start" /> Tải về</a></Button>
        {r.sha256 && (
          <button type="button" onClick={() => void copy()} title="Chép mã SHA-256 để kiểm tra file"
            className="group flex items-center gap-2 rounded-md text-left text-xs text-muted-foreground hover:text-foreground">
            <span className="shrink-0">SHA-256</span>
            <code className="truncate font-mono">{r.sha256}</code>
            {copied ? <CheckIcon className="size-3.5 shrink-0 text-emerald-500" /> : <CopyIcon className="size-3.5 shrink-0 opacity-60 group-hover:opacity-100" />}
          </button>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><RefreshCwIcon className="size-3" /> Đã cài rồi thì cập nhật ngay trong app.</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><GlobeIcon className="size-3" /> Tải từ máy chủ ở Hà Nội.</p>
      </CardContent>
    </Card>
  )
}
