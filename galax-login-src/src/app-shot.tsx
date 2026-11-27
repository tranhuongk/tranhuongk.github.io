// Real screenshots of Galax Login (macOS build, sample profiles with documentation IP ranges), light
// and dark to follow the page theme. 1360×860 window at 2x, saved at 2200px wide.
import { cn } from '@/lib/utils'
import { useDark } from './shared'

const BASE = import.meta.env.BASE_URL

export function AppShot({ className }: { className?: string }) {
  const dark = useDark()
  return (
    <img src={`${BASE}${dark ? 'app-dark' : 'app-light'}.webp`} width={2200} height={1392} decoding="async"
      alt="Galax Login: danh sách profile với nhóm, proxy, tag và nút mở trình duyệt"
      className={cn('block h-auto w-full select-none', className)} draggable={false} />
  )
}
