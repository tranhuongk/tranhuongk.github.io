// Small pieces every tab uses: an IP with its "IP của bạn" tag, the IP action menu, a stat tile, the
// empty / loading / error states and the "a · b · c" meta line.
import type { ReactNode } from 'react'
import { BanIcon, CircleSlashIcon, EllipsisIcon, ScrollTextIcon, ShieldCheckIcon, TriangleAlertIcon, UnplugIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useAdmin, useIpActions } from './admin'

export function IpLabel({ ip }: { ip: string }) {
  const { myIp } = useAdmin()
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="truncate font-mono text-sm font-semibold tabular-nums">{ip || '—'}</span>
      {ip && ip === myIp && <Badge variant="secondary" className="bg-sky-500/15 text-sky-700 dark:text-sky-300">IP của bạn</Badge>}
    </span>
  )
}

export function IpMenu({ ip, blocked = false, kick = false }: { ip: string; blocked?: boolean; kick?: boolean }) {
  const a = useIpActions()
  if (!ip) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Thao tác với ${ip}`}>
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => a.showLogFor(ip)}>
          <ScrollTextIcon /> Xem nhật ký
        </DropdownMenuItem>
        {kick && (
          <DropdownMenuItem onSelect={() => void a.kickIp(ip)}>
            <UnplugIcon /> Ngắt hết kết nối
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {blocked ? (
          <DropdownMenuItem onSelect={() => void a.unblock(ip)}>
            <ShieldCheckIcon /> Bỏ chặn
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem variant="destructive" onSelect={() => void a.block(ip)}>
            <BanIcon /> Chặn IP
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Stat({ value, label, icon }: { value: ReactNode; label: string; icon: ReactNode }) {
  return (
    <Card size="sm" className="gap-1">
      <CardContent className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-2xl font-semibold tabular-nums">{value}</div>
          <div className="truncate text-xs text-muted-foreground">{label}</div>
        </div>
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4.5">{icon}</div>
      </CardContent>
    </Card>
  )
}

export function Meta({ items }: { items: (ReactNode | false | null | undefined)[] }) {
  const shown = items.filter(Boolean)
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
      {shown.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden className="opacity-40">·</span>}
          {it}
        </span>
      ))}
    </div>
  )
}

export function EmptyState({ title, description, icon = <CircleSlashIcon /> }: { title: string; description?: string; icon?: ReactNode }) {
  return (
    <Empty className="border border-dashed py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  )
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
    </div>
  )
}

export function ErrorNote({ message, retry }: { message: string; retry(): void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
      <span className="inline-flex items-center gap-2"><TriangleAlertIcon className="size-4" /> {message}</span>
      <Button size="sm" variant="outline" onClick={retry}>Thử lại</Button>
    </div>
  )
}

/** One row of a list: a title line with actions on the right, then details. */
export function Row({ title, actions, children, dim }: { title: ReactNode; actions?: ReactNode; children?: ReactNode; dim?: boolean }) {
  return (
    <div className={`flex flex-col gap-1.5 px-4 py-3 ${dim ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">{title}</div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

export function List({ children }: { children: ReactNode }) {
  return <Card className="gap-0 divide-y py-0">{children}</Card>
}
