import { useEffect, useRef, useState } from 'react'
import { animate, MotionConfig, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { ArrowDownToLineIcon, CheckIcon, CopyIcon, FileSpreadsheetIcon, GlobeIcon, MonitorIcon, NetworkIcon, RefreshCwIcon, ShieldCheckIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { BlurFade } from '@/components/ui/blur-fade'
import { BorderBeam } from '@/components/ui/border-beam'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AnimatedSpan, Terminal, TypingAnimation } from '@/components/ui/terminal'
import { cn } from '@/lib/utils'
import { CloserLook } from './closer-look'
import { Hero } from './hero'
import { megabytes, RELEASES_PAGE, useRelease, vnDate, type Release } from './release'
import { DownloadButton, ICON } from './shared'
import { Statement } from './statement'

/**
 * In-page links ("#xem-ky", "#api", "#cai-dat", "#") glide to their section instead of jumping: an
 * eased scroll whose length grows with the distance, landing just under the sticky product bar.
 * Reduced motion keeps the plain jump.
 */
function useSmoothAnchors() {
  useEffect(() => {
    let current: ReturnType<typeof animate> | null = null
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[href^="#"]')
      if (!a) return
      const id = a.getAttribute('href')!.slice(1)
      const el = id ? document.getElementById(id) : null
      if (id && !el) return
      e.preventDefault()
      const bar = document.querySelector('header')?.getBoundingClientRect().height ?? 0
      const to = el ? Math.max(0, el.getBoundingClientRect().top + window.scrollY - bar) : 0
      const from = window.scrollY
      history.replaceState(null, '', id ? `#${id}` : location.pathname)
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        window.scrollTo(0, to)
        return
      }
      current?.stop()
      const duration = Math.min(1.4, Math.max(0.6, Math.abs(to - from) / 3000))
      current = animate(from, to, { duration, ease: [0.65, 0, 0.35, 1], onUpdate: (y) => window.scrollTo(0, y) })
      // A wheel or touch during the glide hands the page back to the user.
      const stop = () => { current?.stop(); window.removeEventListener('wheel', stop); window.removeEventListener('touchstart', stop) }
      window.addEventListener('wheel', stop, { passive: true, once: true })
      window.addEventListener('touchstart', stop, { passive: true, once: true })
    }
    document.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('click', onClick)
      current?.stop()
    }
  }, [])
}

export default function App() {
  const r = useRelease()
  useSmoothAnchors()
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-svh overflow-x-clip">
        <SubNav r={r} />
        <Hero r={r} />
        <CloserLook />
        <Statement />
        <More />
        <Api />
        <Install r={r} />
        <footer className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
            <div className="flex items-center gap-2"><img src={ICON} alt="" className="size-5 rounded" /> Galax Login</div>
            <div>Dành cho Windows 10 / 11 (64-bit)</div>
          </div>
        </footer>
      </div>
    </MotionConfig>
  )
}

/** The apple.com product bar: name on the left, sections and a small "Tải về" pill on the right. */
function SubNav({ r }: { r: Release }) {
  const { scrollY } = useScroll()
  const [scrolled, setScrolled] = useState(false)
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 8))
  return (
    <header className={cn('sticky top-0 z-40 transition-[background-color,border-color] duration-300',
      scrolled ? 'border-b bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65' : 'border-b border-transparent bg-transparent')}>
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#" className="flex items-center gap-2 text-[15px] font-semibold"><img src={ICON} alt="" className="size-6 rounded-md" /> Galax Login</a>
        <nav className="flex items-center gap-5 text-xs">
          <a href="#xem-ky" className="hidden text-muted-foreground hover:text-foreground sm:inline">Tính năng</a>
          <a href="#api" className="hidden text-muted-foreground hover:text-foreground sm:inline">API</a>
          <a href="#cai-dat" className="hidden text-muted-foreground hover:text-foreground sm:inline">Cài đặt</a>
          <a href={r.latest_url} className="rounded-full bg-primary px-3.5 py-1 font-medium text-primary-foreground hover:bg-primary/90">Tải về</a>
        </nav>
      </div>
    </header>
  )
}

const MORE = [
  { icon: NetworkIcon, title: 'Kho proxy & tag màu', text: 'Lưu proxy riêng khỏi profile, kiểm tra song song (IP, quốc gia, độ trễ), chia vòng cho nhiều profile.' },
  { icon: MonitorIcon, title: 'Đồng bộ & chia lưới', text: 'Thao tác một cửa sổ, các cửa sổ khác làm theo. Xếp lưới nhiều trình duyệt trong một lần bấm.' },
  { icon: FileSpreadsheetIcon, title: 'Nhập từ Excel', text: 'Tạo profile từ .xlsx/.csv (dùng được file mẫu của GPM), kèm cookie và bookmark.' },
  { icon: ShieldCheckIcon, title: 'Cập nhật có chữ ký', text: 'Mỗi bản cập nhật ký Ed25519 gắn với số phiên bản; app từ chối file không đúng chữ ký.' },
]

/** "Còn nữa": a tile grid, each tile rising a little later than the one before it. */
function More() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
      <BlurFade inView><h2 className="text-4xl font-bold tracking-tight sm:text-5xl">Và còn nữa.</h2></BlurFade>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {MORE.map((m, i) => (
          <ScrollTile key={m.title} index={i}>
            <div className="h-full rounded-[28px] bg-muted/50 p-8 ring-1 ring-foreground/5">
              <m.icon className="size-7 text-primary" />
              <div className="mt-5 text-xl font-semibold">{m.title}</div>
              <p className="mt-2 leading-relaxed text-muted-foreground">{m.text}</p>
            </div>
          </ScrollTile>
        ))}
      </div>
    </section>
  )
}

function ScrollTile({ children, index }: { children: React.ReactNode; index: number }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 55%'] })
  const lag = (index % 2) * 0.15
  const y = useTransform(scrollYProgress, [0, 1], [90 + lag * 200, 0])
  const scale = useTransform(scrollYProgress, [0, 1], [0.92, 1])
  const opacity = useTransform(scrollYProgress, [0, 0.5 + lag, 1], [0, 0.4, 1])
  return <motion.div ref={ref} className="h-full" style={reduce ? undefined : { y, scale, opacity }}>{children}</motion.div>
}

function Api() {
  return (
    <section id="api" className="scroll-mt-12 border-y bg-muted/40">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
        <BlurFade inView direction="right">
          <Badge variant="outline">Cho người viết script</Badge>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Script GPM cũ chạy được ngay</h2>
          <p className="mt-3 text-muted-foreground">
            Galax Login trả dữ liệu cùng dạng với GPM Login 5.1.7 trên <code className="rounded bg-muted px-1.5 py-0.5 text-sm">/api/v1</code>,
            kèm <code className="rounded bg-muted px-1.5 py-0.5 text-sm">remote_debugging_port</code> để nối Puppeteer, Playwright hay Selenium.
            Chỉ cần đổi cổng 9495 thành 19995.
          </p>
          <ul className="mt-6 space-y-2 text-sm">
            {['REST /api/v3 đầy đủ: profile, nhóm, proxy, kịch bản', 'Máy chủ MCP 48 công cụ cho trợ lý AI', 'Mọi công cụ MCP cũng gọi được qua REST'].map((t, i) => (
              <BlurFade key={t} inView delay={0.2 + i * 0.1} direction="right">
                <li className="flex items-start gap-2"><CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" /> {t}</li>
              </BlurFade>
            ))}
          </ul>
        </BlurFade>
        {/* rounded-xl like the Terminal: the BorderBeam inherits this radius, so it follows the corners. */}
        <BlurFade inView direction="left" className="relative min-w-0 rounded-xl">
          <Terminal className="relative max-w-none bg-background">
            <AnimatedSpan className="text-muted-foreground"># Danh sách profile (như GPM, chỉ đổi cổng)</AnimatedSpan>
            <TypingAnimation duration={18}>curl http://127.0.0.1:19995/api/v1/profiles</TypingAnimation>
            <AnimatedSpan className="text-emerald-500">✔ 200 OK · {'{'} "data": [ … ] {'}'}</AnimatedSpan>
            <AnimatedSpan className="mt-2 text-muted-foreground"># Mở một profile, nhận cổng CDP để nối Playwright</AnimatedSpan>
            <TypingAnimation duration={18}>curl http://127.0.0.1:19995/api/v1/profiles/start/&lt;id&gt;</TypingAnimation>
            <AnimatedSpan className="text-emerald-500">✔ "remote_debugging_port": 40213</AnimatedSpan>
            <AnimatedSpan className="mt-2 text-muted-foreground"># Đổi IP proxy xoay khi trình duyệt đang chạy</AnimatedSpan>
            <TypingAnimation duration={18}>curl http://127.0.0.1:19995/api/v3/profiles/change-ip/&lt;id&gt;</TypingAnimation>
            <AnimatedSpan className="text-sky-500">↻ IP mới đã áp, kết nối cũ đã cắt</AnimatedSpan>
          </Terminal>
          <BorderBeam size={120} duration={9} colorFrom="#6366f1" colorTo="#10b981" />
        </BlurFade>
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
          <BlurFade inView><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Cài đặt trong một phút</h2></BlurFade>
          <InstallSteps steps={steps} />
        </div>
        <BlurFade inView delay={0.15} className="self-start"><DownloadCard r={r} /></BlurFade>
      </div>
    </section>
  )
}

/** The steps, joined by a line that draws itself as the list scrolls past. */
function InstallSteps({ steps }: { steps: { title: string; text: string }[] }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLOListElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 75%', 'end 45%'] })
  return (
    <ol ref={ref} className="relative mt-8 space-y-8">
      <span aria-hidden className="absolute top-4 bottom-4 left-4 w-px -translate-x-1/2 bg-border" />
      <motion.span aria-hidden className="absolute top-4 bottom-4 left-4 w-0.5 origin-top -translate-x-1/2 rounded-full bg-gradient-to-b from-indigo-500 via-sky-500 to-emerald-500"
        style={reduce ? undefined : { scaleY: scrollYProgress }} />
      {steps.map((s, i) => (
        <BlurFade key={s.title} inView delay={i * 0.12} direction="right">
          <li className="relative flex gap-4">
            <span className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground ring-4 ring-background">{i + 1}</span>
            <div><div className="font-medium">{s.title}</div><p className="mt-1 text-sm text-muted-foreground">{s.text}</p></div>
          </li>
        </BlurFade>
      ))}
    </ol>
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
    <Card className="relative overflow-hidden">
      <BorderBeam size={140} duration={7} colorFrom="#6366f1" colorTo="#0ea5e9" />
      <BorderBeam size={140} duration={7} delay={3.5} colorFrom="#10b981" colorTo="#8b5cf6" />
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
        <DownloadButton href={r.latest_url} className="w-full">Tải về</DownloadButton>
        {r.sha256 && (
          <button type="button" onClick={() => void copy()} title="Chép mã SHA-256 để kiểm tra file"
            className="group flex items-center gap-2 rounded-md text-left text-xs text-muted-foreground hover:text-foreground">
            <span className="shrink-0">SHA-256</span>
            <code className="truncate font-mono">{r.sha256}</code>
            {copied ? <CheckIcon className="size-3.5 shrink-0 text-emerald-500" /> : <CopyIcon className="size-3.5 shrink-0 opacity-60 group-hover:opacity-100" />}
          </button>
        )}
        {r.mac_url && (
          <a href={r.mac_url} className="flex items-center justify-center gap-1.5 rounded-md border py-2 text-sm font-medium hover:bg-muted">
            <ArrowDownToLineIcon className="size-4" /> Bản macOS (.dmg{r.mac_size ? `, ${megabytes(r.mac_size)}` : ''})
          </a>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><RefreshCwIcon className="size-3" /> Đã cài rồi thì cập nhật ngay trong app{r.mac_url ? ' (Windows)' : ''}.</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><GlobeIcon className="size-3" /> Tải từ GitHub ·{' '}
          <a href={RELEASES_PAGE} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">các bản trước</a></p>
      </CardContent>
    </Card>
  )
}
