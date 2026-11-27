// Pinned statement over the galaxy rings (the apple.com "The best thing you've never heard" scene):
// the rings open and turn with the scroll, the giant line settles, then the text and the numbers come in.
import { useRef } from 'react'
import { motion, useMotionValue, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react'
import { NumberTicker } from '@/components/ui/number-ticker'
import { BRAND } from './shared'

const STATS = [
  { value: 200, label: 'profile tạo trong một lần' },
  { value: 19, label: 'nhà cung cấp proxy xoay ở Việt Nam' },
  { value: 48, label: 'công cụ MCP cho trợ lý AI' },
]
const TEXT = 'Mỗi profile là một trình duyệt riêng, với cookie, vân tay, proxy và múi giờ của riêng nó. Chạy hàng trăm tài khoản cùng lúc mà chúng không dính vào nhau.'

function Rings({ p }: { p?: MotionValue<number> }) {
  const still = useMotionValue(0.5)
  const src = p ?? still
  const scale = useTransform(src, [0, 1], [0.45, 1.35])
  const rotate = useTransform(src, [0, 1], [-25, 35])
  const opacity = useTransform(src, [0, 0.15, 0.85, 1], [0, 1, 1, 0.35])
  const rings = Array.from({ length: 9 }, (_, i) => i)
  return (
    <motion.svg viewBox="-500 -500 1000 1000" className="pointer-events-none absolute top-1/2 left-1/2 size-[min(150vh,150vw)] -translate-x-1/2 -translate-y-1/2"
      style={p ? { scale, rotate, opacity } : { opacity: 0.8 }} aria-hidden>
      <defs>
        <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
          {BRAND.map((c, i) => <stop key={c} offset={`${(i / (BRAND.length - 1)) * 100}%`} stopColor={c} />)}
        </linearGradient>
        <filter id="glow"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      {rings.map((i) => (
        <g key={i}>
          <circle r={150 + i * 38} fill="none" stroke="url(#ring)" strokeWidth={10 - i * 0.8} opacity={0.18 - i * 0.012} filter="url(#glow)" />
          <circle r={150 + i * 38} fill="none" stroke="url(#ring)" strokeWidth={1.6} opacity={0.75 - i * 0.07}
            strokeDasharray={i % 2 ? '2 14' : undefined} />
        </g>
      ))}
    </motion.svg>
  )
}

function Stats() {
  return (
    <div className="mt-12 grid grid-cols-3 gap-6 sm:gap-12">
      {STATS.map((s) => (
        <div key={s.label}>
          <div className="text-4xl font-bold tracking-tight tabular-nums sm:text-6xl"><NumberTicker value={s.value} className="text-foreground" /></div>
          <div className="mt-2 text-xs text-muted-foreground sm:text-sm">{s.label}</div>
        </div>
      ))}
    </div>
  )
}

export function Statement() {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const headScale = useTransform(p, [0, 0.4], [1.25, 1])
  const headOpacity = useTransform(p, [0, 0.12], [0, 1])
  const headY = useTransform(p, [0.4, 0.62], ['0vh', '-4vh'])
  const textOpacity = useTransform(p, [0.45, 0.6], [0, 1])
  const textY = useTransform(p, [0.45, 0.6], [30, 0])
  const statsOpacity = useTransform(p, [0.62, 0.78], [0, 1])
  const statsY = useTransform(p, [0.62, 0.78], [30, 0])

  const headline = (
    <h2 className="text-4xl font-bold tracking-tight text-balance sm:text-6xl lg:text-7xl">
      Hàng trăm profile.<br />Không dính vào nhau.
    </h2>
  )
  if (reduce) {
    return (
      <section className="relative overflow-hidden px-4 py-28 text-center">
        <Rings />
        <div className="relative mx-auto max-w-4xl">{headline}<p className="mx-auto mt-8 max-w-2xl text-lg text-muted-foreground">{TEXT}</p><Stats /></div>
      </section>
    )
  }
  return (
    <section ref={ref} className="relative h-[300vh]">
      <div className="sticky top-0 flex h-svh items-center justify-center overflow-hidden px-4 text-center">
        <Rings p={p} />
        <div className="relative max-w-5xl">
          <motion.div style={{ scale: headScale, opacity: headOpacity, y: headY }}>{headline}</motion.div>
          <motion.p className="mx-auto mt-8 max-w-2xl text-lg text-muted-foreground sm:text-xl" style={{ opacity: textOpacity, y: textY }}>{TEXT}</motion.p>
          <motion.div style={{ opacity: statsOpacity, y: statsY }}><Stats /></motion.div>
        </div>
      </div>
    </section>
  )
}
