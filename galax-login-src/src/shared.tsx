// Pieces every section uses.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDownToLineIcon } from 'lucide-react'
import { ShimmerButton } from '@/components/ui/shimmer-button'
import { cn } from '@/lib/utils'

export const ICON = `${import.meta.env.BASE_URL}icon.png`
export const BRAND = ['#6366f1', '#0ea5e9', '#10b981', '#8b5cf6']

/** The page follows the system theme (main.tsx toggles .dark); canvas effects need the colour too. */
export function useDark(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const o = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => o.disconnect()
  }, [])
  return dark
}

/** md and up: the pinned (sticky) scroll scenes; phones get the same content stacked. */
export function useWide(): boolean {
  const q = '(min-width: 768px)'
  const [wide, setWide] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

/** The main download action: a shimmering pill (a real link would nest a button, so it navigates). */
export function DownloadButton({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <ShimmerButton onClick={() => { window.location.href = href }} aria-label={`${children} (tải file cài)`}
      background="linear-gradient(135deg, oklch(0.47 0.2 275), oklch(0.5 0.17 250))" shimmerColor="#a5f3fc" shimmerDuration="2.6s"
      className={cn('h-12 gap-2 px-7 text-base font-semibold shadow-lg shadow-primary/30', className)}>
      <ArrowDownToLineIcon className="size-5" /> {children}
    </ShimmerButton>
  )
}

/**
 * Draws `children` at a fixed design size and scales it to the width it gets, so the illustrated app
 * keeps its layout (and stays sharp: it is still text and vectors) from phones to wide screens.
 */
export function FitWidth({ width, height, children, className }: { width: number; height: number; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(1)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setK(Math.min(1, el.clientWidth / width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])
  return (
    <div ref={ref} className={cn('relative w-full', className)} style={{ height: height * k }}>
      <div className="absolute top-0 left-0 origin-top-left" style={{ width, height, transform: `scale(${k})` }}>{children}</div>
    </div>
  )
}
