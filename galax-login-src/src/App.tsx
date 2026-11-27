import { useEffect, useRef, useState } from 'react'
import { MotionConfig, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'motion/react'
import {
  ArrowDownToLineIcon, BotIcon, CheckIcon, CopyIcon, FileSpreadsheetIcon, FingerprintIcon, GlobeIcon, LayersIcon,
  MonitorIcon, NetworkIcon, PlugIcon, RefreshCwIcon, ShieldCheckIcon, WorkflowIcon,
} from 'lucide-react'
import { AnimatedGridPattern } from '@/components/ui/animated-grid-pattern'
import { AuroraText } from '@/components/ui/aurora-text'
import { BlurFade } from '@/components/ui/blur-fade'
import { BorderBeam } from '@/components/ui/border-beam'
import { MagicCard } from '@/components/ui/magic-card'
import { NumberTicker } from '@/components/ui/number-ticker'
import { Particles } from '@/components/ui/particles'
import { ScrollVelocityContainer, ScrollVelocityRow } from '@/components/ui/scroll-based-velocity'
import { ScrollProgress } from '@/components/ui/scroll-progress'
import { ShimmerButton } from '@/components/ui/shimmer-button'
import { TextReveal } from '@/components/ui/text-reveal'
import { AnimatedSpan, Terminal, TypingAnimation } from '@/components/ui/terminal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { megabytes, RELEASES_PAGE, useRelease, vnDate, type Release } from './release'

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

/** The page follows the system theme (main.tsx toggles .dark); canvas effects need the colour too. */
function useDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const o = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => o.disconnect()
  }, [])
  return dark
}

const BRAND = ['#6366f1', '#0ea5e9', '#10b981', '#8b5cf6']

export default function App() {
  const r = useRelease()
  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-svh overflow-x-clip">
      <ScrollProgress className="z-50 h-0.5 bg-linear-to-r from-indigo-500 via-sky-500 to-emerald-500" />
      <Header r={r} />
      <Hero r={r} />
      <Keywords />
      <section id="tinh-nang" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <BlurFade inView className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Mọi thứ để chạy nhiều tài khoản</h2>
          <p className="mt-3 text-muted-foreground">Viết bằng Tauri v2 và Rust: nhẹ, mở nhanh, không cần cài thêm gì ngoài Chrome hoặc Edge có sẵn.</p>
        </BlurFade>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <ScrollRise key={f.title} index={i}>
              <FeatureCard f={f} />
            </ScrollRise>
          ))}
        </div>
      </section>
      <Statement />
      <Stats r={r} />
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

function Header({ r }: { r: Release }) {
  const { scrollY } = useScroll()
  const [scrolled, setScrolled] = useState(false)
  useMotionValueEvent(scrollY, 'change', (y) => setScrolled(y > 24))
  return (
    <header className={cn('sticky top-0 z-30 border-b transition-[background-color,border-color,box-shadow] duration-300',
      scrolled ? 'border-border bg-background/80 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/65' : 'border-transparent bg-transparent')}>
      <div className={cn('mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 transition-[height] duration-300 sm:px-6', scrolled ? 'h-14' : 'h-16')}>
        <a href="#" className="flex items-center gap-2.5 font-semibold">
          <img src={ICON} alt="" className={cn('rounded-md transition-[width,height] duration-300', scrolled ? 'size-7' : 'size-8')} /> Galax Login
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
  const dark = useDark()
  const reduce = useReducedMotion()
  const ref = useRef<HTMLElement>(null)
  // Parallax while the hero scrolls away: the icon rises and shrinks, the text fades, the grid lags.
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const iconY = useTransform(scrollYProgress, [0, 1], [0, -90])
  const iconScale = useTransform(scrollYProgress, [0, 1], [1, 0.7])
  const textY = useTransform(scrollYProgress, [0, 1], [0, 70])
  const textOpacity = useTransform(scrollYProgress, [0, 0.75], [1, 0])
  const gridY = useTransform(scrollYProgress, [0, 1], [0, 140])
  return (
    <section ref={ref} className="relative -mt-16 overflow-hidden border-b pt-16">
      <motion.div className="absolute inset-0" style={reduce ? undefined : { y: gridY }}>
      <AnimatedGridPattern numSquares={24} maxOpacity={0.12} duration={3} repeatDelay={1}
        className="text-primary [mask-image:radial-gradient(640px_circle_at_center,white,transparent)] inset-x-0 h-full" />
      </motion.div>
      {!reduce && <Particles className="absolute inset-0" quantity={90} ease={70} size={0.6} staticity={40} color={dark ? '#c7d2fe' : '#6366f1'} refresh={dark} />}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent)]" />
      <div className="relative mx-auto flex max-w-3xl flex-col items-center px-4 pt-16 pb-20 text-center sm:pt-24 sm:pb-28">
        <motion.div style={reduce ? undefined : { y: iconY, scale: iconScale }}>
        <BlurFade delay={0.05}>
          <motion.img src={ICON} alt="Galax Login" className="size-24 rounded-[22px] shadow-2xl shadow-primary/30 sm:size-28"
            animate={{ y: [0, -8, 0], rotate: [0, 1.5, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }} />
        </BlurFade>
        </motion.div>
        <motion.div className="flex flex-col items-center" style={reduce ? undefined : { y: textY, opacity: textOpacity }}>
        <BlurFade delay={0.15}>
          <Badge variant="secondary" className="mt-8 gap-1.5">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
            </span>
            {r.version ? `Phiên bản ${r.version}${r.released ? ` · ${vnDate(r.released)}` : ''}` : 'Bản mới nhất'}
          </Badge>
        </BlurFade>
        <BlurFade delay={0.25}>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
            Mỗi profile một danh tính,{' '}
            <AuroraText colors={BRAND} speed={1.2}>chạy cả trăm cùng lúc</AuroraText>
          </h1>
        </BlurFade>
        <BlurFade delay={0.35}>
          <p className="mt-5 max-w-xl text-base text-muted-foreground text-pretty sm:text-lg">
            Galax Login quản lý profile trình duyệt cô lập với vân tay riêng, proxy riêng, tự động hoá và API tương thích GPM Login.
          </p>
        </BlurFade>
        <BlurFade delay={0.45} className="w-full sm:w-auto">
          <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:flex-row">
            <DownloadButton href={r.latest_url} className="w-full sm:w-auto">Tải cho Windows</DownloadButton>
            <Button asChild size="lg" variant="outline" className="h-12 w-full rounded-full px-6 text-base sm:w-auto"><a href="#tinh-nang">Xem tính năng</a></Button>
          </div>
        </BlurFade>
        <BlurFade delay={0.55}>
          <p className="mt-4 text-xs text-muted-foreground">
            Windows 10 / 11 · 64-bit{r.size ? ` · ${megabytes(r.size)}` : ''} · tự cập nhật trong app
          </p>
        </BlurFade>
        </motion.div>
      </div>
    </section>
  )
}

/** The main download action: a shimmering pill (a real link would nest a button, so it navigates). */
function DownloadButton({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <ShimmerButton onClick={() => { window.location.href = href }} aria-label={`${children} (tải file cài)`}
      background="linear-gradient(135deg, oklch(0.47 0.2 275), oklch(0.5 0.17 250))" shimmerColor="#a5f3fc" shimmerDuration="2.6s"
      className={cn('h-12 gap-2 px-7 text-base font-semibold shadow-lg shadow-primary/30', className)}>
      <ArrowDownToLineIcon className="size-5" /> {children}
    </ShimmerButton>
  )
}

const KEYWORDS_A = ['Profile cô lập', 'Vân tay riêng', 'Proxy xoay', 'Đổi IP nóng', 'Tương thích GPM', 'MCP cho AI', 'Kịch bản tự động']
const KEYWORDS_B = ['Đồng bộ thao tác', 'Chia lưới cửa sổ', 'Nhập từ Excel', 'Cookie & bookmark', 'REST API', 'Tự cập nhật', 'Chữ ký Ed25519']

/** Two rows of keywords drifting in opposite directions; scrolling faster makes them run faster. */
function Keywords() {
  const reduce = useReducedMotion()
  const row = (words: string[]) => (
    <span className="flex items-center">
      {words.map((w) => (
        <span key={w} className="flex items-center px-5 text-xl font-semibold tracking-tight sm:text-2xl">
          {w}<span aria-hidden className="ml-10 size-1.5 rounded-full bg-primary/50" />
        </span>
      ))}
    </span>
  )
  if (reduce) {
    return <div className="border-b py-6 text-center text-sm text-muted-foreground">{[...KEYWORDS_A, ...KEYWORDS_B].join(' · ')}</div>
  }
  return (
    <section aria-label="Tính năng nổi bật" className="relative border-b py-8 [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
      <ScrollVelocityContainer className="flex flex-col gap-4">
        <ScrollVelocityRow baseVelocity={1.6} direction={1} className="text-foreground">{row(KEYWORDS_A)}</ScrollVelocityRow>
        <ScrollVelocityRow baseVelocity={1.6} direction={-1} className="text-muted-foreground">{row(KEYWORDS_B)}</ScrollVelocityRow>
      </ScrollVelocityContainer>
    </section>
  )
}

const STATEMENT = 'Mỗi profile là một trình duyệt riêng: cookie, vân tay, proxy và múi giờ của riêng nó. Hàng trăm tài khoản chạy cùng lúc mà không dính vào nhau.'

/** One sentence that lights up word by word as it is scrolled through. */
function Statement() {
  const reduce = useReducedMotion()
  if (reduce) {
    return <p className="mx-auto max-w-4xl px-6 py-24 text-2xl font-bold tracking-tight sm:text-4xl">{STATEMENT}</p>
  }
  return <TextReveal className="h-[170vh] [&_span]:tracking-tight">{STATEMENT}</TextReveal>
}

/** A card that rises, sharpens and grows into place as it scrolls into view (column-staggered). */
function ScrollRise({ children, index }: { children: React.ReactNode; index: number }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 60%'] })
  const lag = (index % 3) * 0.12
  const y = useTransform(scrollYProgress, [0, 1], [70 + lag * 200, 0])
  const opacity = useTransform(scrollYProgress, [0, 0.4 + lag, 1], [0, 0.35, 1])
  const scale = useTransform(scrollYProgress, [0, 1], [0.94, 1])
  return (
    <motion.div ref={ref} className="h-full" style={reduce ? undefined : { y, opacity, scale }}>
      {children}
    </motion.div>
  )
}

function FeatureCard({ f }: { f: (typeof FEATURES)[number] }) {
  const dark = useDark()
  return (
    <MagicCard gradientColor={dark ? '#312e81' : '#e0e7ff'} gradientOpacity={dark ? 0.55 : 0.9} className="h-full rounded-xl">
      <div className="flex h-full flex-col gap-3 p-6">
        <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110 [&_svg]:size-5">{f.icon}</div>
        <div className="font-semibold">{f.title}</div>
        <p className="text-sm leading-relaxed text-muted-foreground">{f.text}</p>
      </div>
    </MagicCard>
  )
}

function Stats({ r }: { r: Release }) {
  const items: { value: number; decimals?: number; suffix?: string; label: string }[] = [
    { value: 200, label: 'profile tạo trong một lần' },
    { value: 19, label: 'nhà cung cấp proxy xoay ở Việt Nam' },
    { value: 48, label: 'công cụ MCP cho trợ lý AI' },
    { value: r.size ? r.size / 1048576 : 7, decimals: 1, suffix: ' MB', label: 'dung lượng bản cài' },
  ]
  return (
    <section className="border-t">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-y-10 px-4 py-14 sm:px-6 lg:grid-cols-4">
        {items.map((it, i) => (
          <BlurFade key={it.label} inView delay={i * 0.08} className="text-center">
            <div className="text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">
              <NumberTicker value={it.value} decimalPlaces={it.decimals ?? 0} className="text-foreground" />{it.suffix}
            </div>
            <div className="mx-auto mt-2 max-w-[12rem] text-sm text-muted-foreground">{it.label}</div>
          </BlurFade>
        ))}
      </div>
    </section>
  )
}

function Api() {
  return (
    <section className="border-y bg-muted/40">
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
        <BlurFade inView direction="left" className="relative min-w-0">
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
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><RefreshCwIcon className="size-3" /> Đã cài rồi thì cập nhật ngay trong app.</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><GlobeIcon className="size-3" /> Tải từ GitHub ·{' '}
          <a href={RELEASES_PAGE} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">các bản trước</a></p>
      </CardContent>
    </Card>
  )
}
