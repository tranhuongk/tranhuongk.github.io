import { useEffect, useState } from 'react'
import { ScrollTextIcon, SearchIcon, XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { api, type LogRow } from '@/lib/api'
import { bytes, dur, KIND, PROTO, stripPort, when } from '@/lib/format'
import { useAdmin, useLoad } from '../admin'
import { EmptyState, ErrorNote, IpLabel, List, Loading, Meta, Row } from '../bits'

function query(q: string, kind: string, failed: boolean, before = 0) {
  const p = new URLSearchParams({ limit: '100' })
  if (q.trim()) p.set('q', q.trim())
  if (kind !== 'all') p.set('kind', kind)
  if (failed) p.set('status', 'auth_failed')
  if (before) p.set('before', String(before))
  return `/history?${p}`
}

export function LogTab() {
  const { logQuery } = useAdmin()
  const [text, setText] = useState(logQuery)
  const [q, setQ] = useState(logQuery)
  const [kind, setKind] = useState('all')
  const [failed, setFailed] = useState(false)
  const [extra, setExtra] = useState<LogRow[]>([])
  const [more, setMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setQ(text), 300)
    return () => clearTimeout(t)
  }, [text])

  const { data, error, reload } = useLoad(async () => {
    const d = await api<{ rows: LogRow[]; more: boolean }>(query(q, kind, failed))
    setExtra([])
    setMore(d.more)
    return d.rows
  }, [q, kind, failed])
  const rows = [...(data ?? []), ...extra]

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const d = await api<{ rows: LogRow[]; more: boolean }>(query(q, kind, failed, rows.at(-1)?.start))
      setExtra((x) => [...x, ...d.rows])
      setMore(d.more)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <InputGroup className="sm:flex-1">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Tìm IP, user, trang…" aria-label="Tìm" />
          {text && <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label="Xoá" onClick={() => setText('')}><XIcon /></InputGroupButton></InputGroupAddon>}
        </InputGroup>
        <div className="flex items-center gap-3">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger aria-label="Loại" className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả</SelectItem>
              <SelectItem value="proxy">Proxy</SelectItem>
              <SelectItem value="wireguard">WireGuard</SelectItem>
              <SelectItem value="ikev2">IKEv2</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Checkbox id="failed" checked={failed} onCheckedChange={(v) => setFailed(v === true)} />
            <Label htmlFor="failed" className="font-normal whitespace-nowrap">Chỉ sai mật khẩu</Label>
          </div>
        </div>
      </div>
      {error && <ErrorNote message={error} retry={reload} />}
      {!data ? !error && <Loading rows={5} /> : rows.length === 0 ? <EmptyState title="Không có dòng nào khớp" icon={<ScrollTextIcon />} /> : (
        <>
          <List>
            {rows.map((r) => {
              const hosts = r.kind === 'proxy' ? (r.hosts ?? '').split(' ').filter(Boolean).map(stripPort).join(', ') : r.hosts ? `IP trong VPN ${r.hosts}` : ''
              return (
                <Row key={r.sid + r.start}
                  title={<>
                    <IpLabel ip={r.ip} />
                    <Badge variant="secondary">{PROTO[r.proto ?? ''] ?? KIND[r.kind] ?? r.kind}</Badge>
                    {r.user && <Badge variant="outline">{r.user}</Badge>}
                    {r.status === 'auth_failed' && <Badge variant="destructive">Sai mật khẩu</Badge>}
                  </>}
                  actions={<span className="text-xs text-muted-foreground tabular-nums">{when(r.start)}</span>}>
                  {hosts && <div className="truncate text-sm">{hosts}</div>}
                  <Meta items={[`dài ${dur((r.end ?? r.start) - r.start)}`, `↓ ${bytes(r.tx)}`, `↑ ${bytes(r.rx)}`]} />
                </Row>
              )
            })}
          </List>
          {more && (
            <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore && <Spinner data-icon="inline-start" />} Xem thêm
            </Button>
          )}
        </>
      )}
    </div>
  )
}
