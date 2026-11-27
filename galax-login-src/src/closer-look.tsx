// "Xem kỹ hơn", the apple.com "Take a closer look" pattern: a pinned stage where the list on the
// left advances with the scroll and the illustration on the right changes to match.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react'
import { BotIcon, CheckIcon, FingerprintIcon, GlobeIcon, LayersIcon, PlugIcon, RefreshCwIcon, WorkflowIcon } from 'lucide-react'
import { BlurFade } from '@/components/ui/blur-fade'
import { cn } from '@/lib/utils'
import { useWide } from './shared'

// --- the illustrations ------------------------------------------------------------------------

function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex h-full w-full items-center justify-center p-6 sm:p-10', className)}>{children}</div>
}

const PROFILE_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6']
function SceneIsolated() {
  return (
    <Frame>
      <div className="grid w-full max-w-md grid-cols-3 gap-3">
        {PROFILE_COLORS.map((c, i) => (
          <motion.div key={c} initial={{ opacity: 0, y: 14, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: i * 0.07 }}
            className="overflow-hidden rounded-xl border bg-background shadow-sm">
            <div className="flex items-center gap-1 border-b px-2 py-1.5"><span className="size-1.5 rounded-full" style={{ background: c }} /><span className="h-1.5 flex-1 rounded-full bg-muted" /></div>
            <div className="space-y-1.5 p-2.5">
              <div className="grid size-7 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: c }}>{String.fromCharCode(65 + i)}</div>
              <div className="h-1.5 w-4/5 rounded-full bg-muted" /><div className="h-1.5 w-3/5 rounded-full bg-muted" />
              <div className="pt-1 text-[10px] text-muted-foreground">cookie · cache · extension</div>
            </div>
          </motion.div>
        ))}
      </div>
    </Frame>
  )
}

function SceneFingerprint() {
  const rows: [string, string][] = [
    ['IP proxy', '203.0.113.24 · Hà Nội'], ['Múi giờ', 'Asia/Ho_Chi_Minh'], ['Ngôn ngữ', 'vi-VN, vi, en'],
    ['Vị trí', '21.03, 105.85'], ['CPU', '8 nhân'], ['User-Agent', 'Chrome 131 · Windows'],
  ]
  return (
    <Frame>
      <div className="w-full max-w-md rounded-2xl border bg-background p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><FingerprintIcon className="size-5" /></div>
          <div><div className="font-semibold">Vân tay của profile</div><div className="text-xs text-muted-foreground">Đặt qua CDP trước khi trang chạy</div></div>
        </div>
        <div className="divide-y text-sm">
          {rows.map(([k, v], i) => (
            <motion.div key={k} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 * i }} className="flex items-center justify-between py-2">
              <span className="text-muted-foreground">{k}</span>
              <span className="flex items-center gap-1.5 font-medium">{v}{i > 0 && i < 4 && <CheckIcon className="size-3.5 text-emerald-500" />}</span>
            </motion.div>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">Múi giờ, ngôn ngữ, vị trí tự khớp theo IP proxy</div>
      </div>
    </Frame>
  )
}

const ROTATING = ['203.0.113.24', '203.0.113.88', '198.51.100.31', '198.51.100.207', '192.0.2.66']
function SceneProxy() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % ROTATING.length), 1800)
    return () => clearInterval(t)
  }, [])
  return (
    <Frame>
      <div className="w-full max-w-md space-y-3">
        <div className="rounded-2xl border bg-background p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div><div className="text-xs text-muted-foreground">Proxy xoay · nhà cung cấp VN</div><div className="font-semibold">ads-team-a</div></div>
            <span className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"><RefreshCwIcon className="size-3.5 animate-spin [animation-duration:1.8s]" /> Đổi IP</span>
          </div>
          <div className="mt-4 h-9 overflow-hidden rounded-lg bg-muted/60 px-3">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={ROTATING[i]} initial={{ y: 28, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -28, opacity: 0 }}
                className="flex h-9 items-center justify-between font-mono text-sm">
                <span>{ROTATING[i]}</span><span className="text-xs text-emerald-600 dark:text-emerald-400">{40 + i * 7} ms</span>
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">Đổi ngay khi trình duyệt đang mở, kết nối cũ được cắt</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          {['HTTP', 'SOCKS5', 'IPv6'].map((k) => <div key={k} className="rounded-xl border bg-background py-3 font-medium">{k}<div className="mt-0.5 text-[10px] font-normal text-muted-foreground">có mật khẩu</div></div>)}
        </div>
      </div>
    </Frame>
  )
}

function SceneApi() {
  return (
    <Frame>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border bg-zinc-950 text-zinc-100 shadow-xl">
        <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
          {['bg-red-400', 'bg-amber-400', 'bg-emerald-400'].map((c) => <span key={c} className={cn('size-2.5 rounded-full', c)} />)}
          <span className="ml-2 text-xs text-zinc-400">script GPM cũ · chỉ đổi cổng</span>
        </div>
        <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed"><code>
          <span className="text-zinc-500"># trước: 127.0.0.1:9495 (GPM)</span>{'\n'}
          <span className="text-sky-300">GET</span> 127.0.0.1:<span className="text-amber-300">19995</span>/api/v1/profiles{'\n'}
          <span className="text-sky-300">GET</span> …/api/v1/profiles/start/&lt;id&gt;{'\n'}
          <span className="text-emerald-400">{'→'} "remote_debugging_port": 40213</span>{'\n\n'}
          <span className="text-zinc-500"># nối Playwright / Puppeteer / Selenium</span>{'\n'}
          chromium.connectOverCDP(<span className="text-amber-200">"http://127.0.0.1:40213"</span>)
        </code></pre>
      </div>
    </Frame>
  )
}

function SceneMcp() {
  const calls = ['list_profiles({ group: "Shop" })', 'start_profile × 12', 'run_script("đăng nhập")', 'get_run → 12/12 xong']
  return (
    <Frame>
      <div className="w-full max-w-md space-y-3">
        <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">Mở 12 profile nhóm Shop và đăng nhập giúp mình</div>
        <div className="rounded-2xl rounded-bl-md border bg-background p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><BotIcon className="size-4" /> Trợ lý AI · MCP Galax Login</div>
          <div className="space-y-1.5">
            {calls.map((c, i) => (
              <motion.div key={c} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 + i * 0.35 }}
                className="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 font-mono text-[11.5px]">
                <CheckIcon className="size-3.5 shrink-0 text-emerald-500" />{c}
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  )
}

function SceneScript() {
  const steps = ['goto  shop.example', 'click "Đăng nhập"', 'type  {{profile.name}}', 'press Enter', 'screenshot']
  const profiles = ['shop-hn-01', 'shop-hn-02', 'review-07', 'ads-team-a']
  return (
    <Frame>
      <div className="grid w-full max-w-md gap-3 sm:grid-cols-[1fr_1.1fr]">
        <div className="rounded-2xl border bg-background p-4 shadow-sm">
          <div className="mb-2 text-xs text-muted-foreground">Kịch bản · 5 bước</div>
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2 py-1 font-mono text-[11.5px]"><span className="grid size-4 place-items-center rounded bg-primary/10 text-[9px] text-primary">{i + 1}</span>{s}</div>
          ))}
        </div>
        <div className="rounded-2xl border bg-background p-4 shadow-sm">
          <div className="mb-2 text-xs text-muted-foreground">Chạy song song</div>
          {profiles.map((p, i) => (
            <div key={p} className="py-1.5">
              <div className="mb-1 flex justify-between text-[11px]"><span className="font-medium">{p}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <motion.div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-500" initial={{ width: '0%' }} animate={{ width: '100%' }}
                  transition={{ duration: 1.6 + i * 0.45, ease: 'easeInOut', repeat: Infinity, repeatDelay: 0.8 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  )
}

const FEATURES = [
  { icon: LayersIcon, title: 'Profile cô lập', text: 'Mỗi profile một trình duyệt riêng: cookie, bộ nhớ, extension tách biệt. Tạo 1–200 profile một lần, chia nhóm, ghim, thùng rác.', scene: SceneIsolated },
  { icon: FingerprintIcon, title: 'Vân tay riêng', text: 'Múi giờ, ngôn ngữ, vị trí, CPU, User-Agent và Client Hints đặt qua CDP trước khi trang chạy, tự khớp theo IP của proxy.', scene: SceneFingerprint },
  { icon: GlobeIcon, title: 'Proxy & proxy xoay', text: 'HTTP/SOCKS5/IPv6 có mật khẩu không hiện hộp đăng nhập. 19 nhà cung cấp proxy xoay ở Việt Nam, đổi IP ngay khi đang mở.', scene: SceneProxy },
  { icon: PlugIcon, title: 'Tương thích API GPM', text: 'Cùng dạng dữ liệu với GPM Login 5.1.7: script cũ chạy được ngay, chỉ đổi cổng 9495 → 19995.', scene: SceneApi },
  { icon: BotIcon, title: 'Trợ lý AI qua MCP', text: 'Máy chủ MCP 48 công cụ: nhờ trợ lý AI mở profile, chạy kịch bản, kiểm proxy bằng một câu.', scene: SceneMcp },
  { icon: WorkflowIcon, title: 'Kịch bản tự động', text: 'Các bước click, gõ, cuộn bằng sự kiện chuột/phím thật, chạy song song trên nhiều profile; hoặc chạy script Python/Node của bạn.', scene: SceneScript },
]

// --- the section ---------------------------------------------------------------------------------

function Stage({ index }: { index: number }) {
  const Scene = FEATURES[index]!.scene
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[28px] bg-muted/50 ring-1 ring-foreground/5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_70%_20%,color-mix(in_oklab,var(--primary)_10%,transparent),transparent)]" />
      <AnimatePresence mode="wait">
        <motion.div key={index} className="absolute inset-0" initial={{ opacity: 0, scale: 0.97, filter: 'blur(6px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 1.02, filter: 'blur(6px)' }} transition={{ duration: 0.35 }}>
          <Scene />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

export function CloserLook() {
  const wide = useWide()
  const reduce = useReducedMotion()
  const ref = useRef<HTMLElement>(null)
  const [active, setActive] = useState(0)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  useMotionValueEvent(scrollYProgress, 'change', (v) => setActive(Math.min(FEATURES.length - 1, Math.max(0, Math.floor(v * FEATURES.length)))))

  const heading = (
    <div>
      <p className="text-sm font-semibold text-primary">Tính năng</p>
      <h2 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">Xem kỹ hơn.</h2>
    </div>
  )

  if (!wide || reduce) {
    return (
      <section id="xem-ky" className="mx-auto max-w-3xl scroll-mt-14 px-4 py-20">
        {heading}
        <div className="mt-10 space-y-14">
          {FEATURES.map((f) => (
            <BlurFade key={f.title} inView>
              <div className="flex items-center gap-2 text-lg font-semibold"><f.icon className="size-5 text-primary" /> {f.title}</div>
              <p className="mt-2 text-muted-foreground">{f.text}</p>
              <div className="mt-5 overflow-hidden rounded-[28px] bg-muted/50 ring-1 ring-foreground/5">{(() => { const S = f.scene; return <S /> })()}</div>
            </BlurFade>
          ))}
        </div>
      </section>
    )
  }

  const jump = (i: number) => {
    const el = ref.current
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY
    const span = el.offsetHeight - window.innerHeight
    window.scrollTo({ top: top + span * ((i + 0.5) / FEATURES.length), behavior: 'smooth' })
  }

  return (
    <section ref={ref} id="xem-ky" className="relative" style={{ height: `${FEATURES.length * 80 + 100}vh` }}>
      <div className="sticky top-0 flex h-svh items-center">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-center gap-12 px-6 pt-12">
          <div>
            {heading}
            <ul className="mt-8 space-y-2.5">
              {FEATURES.map((f, i) => {
                const on = i === active
                return (
                  <li key={f.title}>
                    <button type="button" onClick={() => jump(i)}
                      className={cn('w-full rounded-3xl px-5 text-left transition-[background-color,padding] duration-300',
                        on ? 'bg-muted py-4' : 'py-2.5 hover:bg-muted/50')}>
                      <span className={cn('flex items-center gap-2.5 font-semibold transition-colors', on ? 'text-foreground' : 'text-muted-foreground')}>
                        <f.icon className={cn('size-4.5', on && 'text-primary')} /> {f.title}
                      </span>
                      <AnimatePresence initial={false}>
                        {on && (
                          <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden pt-2 text-sm leading-relaxed text-muted-foreground">{f.text}</motion.p>
                        )}
                      </AnimatePresence>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
          <Stage index={active} />
        </div>
      </div>
    </section>
  )
}
