// Opening scene, pinned like apple.com: the title sits over the app window; scrolling fades the title
// up and grows the window from a small card into the full screenshot-sized app.
import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { AnimatedGridPattern } from '@/components/ui/animated-grid-pattern'
import { AuroraText } from '@/components/ui/aurora-text'
import { Badge } from '@/components/ui/badge'
import { BlurFade } from '@/components/ui/blur-fade'
import { Button } from '@/components/ui/button'
import { Particles } from '@/components/ui/particles'
import { AppWindow, APP_H, APP_W } from './app-mock'
import { megabytes, vnDate, type Release } from './release'
import { BRAND, DownloadButton, FitWidth, ICON, useDark, useWide } from './shared'

function Title({ r }: { r: Release }) {
  return (
    <div className="flex flex-col items-center text-center">
      <BlurFade delay={0.05}><img src={ICON} alt="Galax Login" className="size-16 rounded-2xl shadow-xl shadow-primary/30 sm:size-20" /></BlurFade>
      <BlurFade delay={0.12}>
        <Badge variant="secondary" className="mt-6 gap-1.5">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
          </span>
          {r.version ? `Phiên bản ${r.version}${r.released ? ` · ${vnDate(r.released)}` : ''}` : 'Bản mới nhất'}
        </Badge>
      </BlurFade>
      <BlurFade delay={0.2}>
        <h1 className="mt-5 text-5xl font-bold tracking-tight text-balance sm:text-7xl">
          Mỗi profile một danh tính.<br />
          <AuroraText colors={BRAND} speed={1.2}>Chạy cả trăm cùng lúc.</AuroraText>
        </h1>
      </BlurFade>
      <BlurFade delay={0.3}>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground text-pretty sm:text-xl">
          Galax Login quản lý profile trình duyệt cô lập: vân tay riêng, proxy riêng, tự động hoá và API tương thích GPM Login.
        </p>
      </BlurFade>
      <BlurFade delay={0.4} className="w-full sm:w-auto">
        <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:flex-row">
          <DownloadButton href={r.latest_url} className="w-full sm:w-auto">Tải cho Windows</DownloadButton>
          <Button asChild size="lg" variant="ghost" className="h-12 rounded-full px-6 text-base text-primary"><a href="#xem-ky">Xem kỹ hơn ›</a></Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Windows 10 / 11 · 64-bit{r.size ? ` · ${megabytes(r.size)}` : ''}</p>
      </BlurFade>
    </div>
  )
}

function Backdrop() {
  const dark = useDark()
  const reduce = useReducedMotion()
  return (
    <>
      <AnimatedGridPattern numSquares={22} maxOpacity={0.1} duration={3} repeatDelay={1}
        className="text-primary [mask-image:radial-gradient(700px_circle_at_50%_35%,white,transparent)] inset-x-0 h-full" />
      {!reduce && <Particles className="absolute inset-0" quantity={80} ease={70} size={0.6} staticity={40} color={dark ? '#c7d2fe' : '#6366f1'} refresh={dark} />}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_45%_at_50%_0%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent)]" />
    </>
  )
}

export function Hero({ r }: { r: Release }) {
  const reduce = useReducedMotion()
  const wide = useWide()
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const titleOpacity = useTransform(p, [0, 0.3], [1, 0])
  const titleY = useTransform(p, [0, 0.3], [0, -80])
  const titleScale = useTransform(p, [0, 0.3], [1, 0.92])
  const winScale = useTransform(p, [0, 0.65], [0.62, 1])
  const winY = useTransform(p, [0, 0.65], ['0vh', '-69vh'])
  const winRadius = useTransform(p, [0, 0.65], [28, 14])
  const glow = useTransform(p, [0.3, 0.7], [0, 1])

  // Phones (the window is small there) and reduced motion: title and window simply stacked.
  if (reduce || !wide) {
    return (
      <section className="relative overflow-hidden border-b px-4 pt-14 pb-14">
        <Backdrop />
        <div className="relative mx-auto max-w-5xl"><Title r={r} /><BlurFade inView delay={0.2}><div className="mt-12"><FitWidth width={APP_W} height={APP_H}><AppWindow /></FitWidth></div></BlurFade></div>
      </section>
    )
  }
  return (
    <section ref={ref} className="relative h-[260vh]">
      <div className="sticky top-0 h-svh overflow-hidden">
        <Backdrop />
        <motion.div className="relative z-10 px-4 pt-[9vh]" style={{ opacity: titleOpacity, y: titleY, scale: titleScale }}>
          <Title r={r} />
        </motion.div>
        {/* The window starts below the title, small; it rises to the top and grows to full size. */}
        <motion.div className="absolute inset-x-0 top-[80vh] z-20 mx-auto w-[min(1100px,92vw)] origin-top" style={{ scale: winScale, y: winY }}>
          <motion.div className="pointer-events-none absolute -inset-10 -z-10 rounded-[40px] bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--primary)_35%,transparent),transparent)] blur-2xl"
            style={{ opacity: glow }} />
          <motion.div className="overflow-hidden" style={{ borderRadius: winRadius }}>
            <FitWidth width={APP_W} height={APP_H}><AppWindow className="rounded-none" /></FitWidth>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
