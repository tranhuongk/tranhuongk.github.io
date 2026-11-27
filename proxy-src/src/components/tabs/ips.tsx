import { useState } from 'react'
import { GlobeIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, type IpRow } from '@/lib/api'
import { bytes, KIND, when } from '@/lib/format'
import { useLoad } from '../admin'
import { EmptyState, ErrorNote, IpLabel, IpMenu, List, Loading, Meta, Row } from '../bits'

export function IpsTab() {
  const [days, setDays] = useState('30')
  const { data, error, reload } = useLoad(() => api<{ rows: IpRow[] }>(`/ips?days=${days}`), [days])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Các IP đã kết nối</h2>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger size="sm" aria-label="Khoảng thời gian"><SelectValue /></SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="1">24 giờ</SelectItem>
            <SelectItem value="7">7 ngày</SelectItem>
            <SelectItem value="30">30 ngày</SelectItem>
            <SelectItem value="90">90 ngày</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {error && <ErrorNote message={error} retry={reload} />}
      {!data ? !error && <Loading /> : data.rows.length === 0 ? <EmptyState title="Chưa có IP nào trong khoảng này" icon={<GlobeIcon />} /> : (
        <List>
          {data.rows.map((r) => (
            <Row key={r.ip} dim={r.blocked}
              title={<>
                <IpLabel ip={r.ip} />
                {r.blocked && <Badge variant="destructive">Đã chặn</Badge>}
                {r.kinds.map((k) => <Badge key={k} variant="secondary">{KIND[k] ?? k}</Badge>)}
                {r.users.map((u) => <Badge key={u} variant="outline">{u}</Badge>)}
                {r.failed > 0 && <Badge variant="destructive">{r.failed} lần sai mật khẩu</Badge>}
              </>}
              actions={<IpMenu ip={r.ip} blocked={r.blocked} />}>
              <Meta items={[`${r.count} kết nối`, `lần cuối ${when(r.last)}`, `lần đầu ${when(r.first)}`, `↓ ${bytes(r.tx)}`, `↑ ${bytes(r.rx)}`]} />
              {r.top_hosts.length > 0 && <div className="truncate text-xs text-muted-foreground">Hay vào: <span className="text-foreground/80">{r.top_hosts.join(', ')}</span></div>}
            </Row>
          ))}
        </List>
      )}
    </div>
  )
}
