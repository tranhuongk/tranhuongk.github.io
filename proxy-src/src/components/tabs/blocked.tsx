import { BanIcon, ShieldCheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api, type Blocked } from '@/lib/api'
import { when } from '@/lib/format'
import { useIpActions, useLoad } from '../admin'
import { EmptyState, ErrorNote, IpLabel, List, Loading, Meta, Row } from '../bits'

export function BlockedTab() {
  const a = useIpActions()
  const { data, error, reload } = useLoad(() => api<{ blocked: Blocked[] }>('/blocked').then((d) => d.blocked), [])
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    if (await a.block(String(f.get('ip')).trim(), String(f.get('note')).trim())) form.reset()
  }
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Chặn IP</CardTitle>
          <CardDescription>IP bị chặn không dùng được proxy và VPN; các kết nối đang mở bị ngắt ngay.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 sm:flex-row">
            <Input name="ip" required autoComplete="off" placeholder="IP hoặc dải, vd 1.2.3.4 hay 1.2.3.0/24" aria-label="IP" className="sm:flex-[3]" />
            <Input name="note" autoComplete="off" placeholder="Lý do" aria-label="Lý do" className="sm:flex-[2]" />
            <Button type="submit" variant="destructive"><BanIcon data-icon="inline-start" /> Chặn</Button>
          </form>
        </CardContent>
      </Card>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Đang chặn</h2>
        {error && <ErrorNote message={error} retry={reload} />}
        {!data ? !error && <Loading rows={2} /> : data.length === 0 ? <EmptyState title="Chưa chặn IP nào" icon={<ShieldCheckIcon />} /> : (
          <List>
            {data.map((b) => (
              <Row key={b.ip} title={<><IpLabel ip={b.ip} />{b.note && <span className="text-sm text-muted-foreground">{b.note}</span>}</>}
                actions={<Button variant="outline" size="sm" onClick={() => void a.unblock(b.ip)}>Bỏ chặn</Button>}>
                <Meta items={[`chặn lúc ${when(b.at)}`]} />
              </Row>
            ))}
          </List>
        )}
      </section>
    </div>
  )
}
