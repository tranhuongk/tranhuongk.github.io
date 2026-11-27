import { useEffect, useMemo, useState } from 'react'
import { GlobeIcon, NetworkIcon, ShieldIcon, UsersIcon, UnplugIcon, WifiOffIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { api, type Live, type ProxyConn } from '@/lib/api'
import { bytes, dur, ago, PROTO, stripPort } from '@/lib/format'
import { useAdmin, useLoad } from '../admin'
import { EmptyState, ErrorNote, IpLabel, IpMenu, List, Loading, Meta, Row, Stat } from '../bits'

const AUTO_KEY = 'proxyadmin.auto'

export function LiveTab() {
  const { setMyIp, act } = useAdmin()
  const [auto, setAuto] = useState(() => {
    try {
      return localStorage.getItem(AUTO_KEY) !== '0'
    } catch {
      return true
    }
  })
  const { data, error, reload } = useLoad(async () => {
    const d = await api<Live>('/live')
    setMyIp(d.you || '')
    return d
  }, [])

  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => {
      if (!document.hidden) void reload()
    }, 5000)
    const onShow = () => !document.hidden && void reload()
    document.addEventListener('visibilitychange', onShow)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [auto, reload])

  const groups = useMemo(() => {
    const m = new Map<string, ProxyConn[]>()
    for (const c of data?.proxy ?? []) m.set(c.ip, [...(m.get(c.ip) ?? []), c])
    return [...m]
  }, [data])

  if (!data) return error ? <ErrorNote message={error} retry={reload} /> : <Loading rows={4} />
  const now = data.now || Date.now() / 1000
  const wg = data.wireguard.filter((p) => p.online)
  const users = new Set(data.proxy.map((c) => c.user).filter(Boolean))
  const kick = (body: object, ok: string) => act(() => api('/kick', body), ok)

  return (
    <div className="flex flex-col gap-6">
      {error && <ErrorNote message={error} retry={reload} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat value={groups.length} label="IP dùng proxy" icon={<GlobeIcon />} />
        <Stat value={data.proxy.length} label="Kết nối proxy" icon={<NetworkIcon />} />
        <Stat value={users.size} label="User đang dùng" icon={<UsersIcon />} />
        <Stat value={wg.length + data.ikev2.length} label="Thiết bị VPN" icon={<ShieldIcon />} />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Proxy</h2>
          <div className="flex items-center gap-2">
            <Switch id="auto" checked={auto} onCheckedChange={(on) => {
              setAuto(on)
              try {
                localStorage.setItem(AUTO_KEY, on ? '1' : '0')
              } catch {
                // ignore
              }
            }} />
            <Label htmlFor="auto" className="text-sm font-normal text-muted-foreground">Tự cập nhật 5 giây</Label>
          </div>
        </div>
        {groups.length === 0 ? <EmptyState title="Chưa ai dùng proxy lúc này" icon={<WifiOffIcon />} /> : (
          <div className="flex flex-col gap-3">
            {groups.map(([ip, conns]) => {
              const names = [...new Set(conns.map((c) => c.user).filter(Boolean))] as string[]
              return (
                <List key={ip}>
                  <Row
                    title={<>
                      <IpLabel ip={ip} />
                      {names.map((u) => <Badge key={u} variant="outline">{u}</Badge>)}
                    </>}
                    actions={<IpMenu ip={ip} kick />}
                  >
                    <Meta items={[`${conns.length} kết nối`, `↓ ${bytes(conns.reduce((a, c) => a + c.tx, 0))}`, `↑ ${bytes(conns.reduce((a, c) => a + c.rx, 0))}`]} />
                  </Row>
                  {conns.map((c) => (
                    <div key={c.sid} className="flex items-center gap-3 bg-muted/30 px-4 py-2.5">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="truncate text-sm">
                          {c.hosts.length ? c.hosts.map(stripPort).join(', ')
                            : c.status === 'auth_failed' ? <span className="text-destructive">Sai mật khẩu</span>
                            : <span className="text-muted-foreground">Đang bắt tay…</span>}
                        </div>
                        <Meta items={[PROTO[c.proto] ?? c.proto, c.start && dur(now - c.start), `↓ ${bytes(c.tx)}`, `↑ ${bytes(c.rx)}`]} />
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => void kick({ sid: c.sid }, 'Đã ngắt kết nối')}>
                        <UnplugIcon data-icon="inline-start" /> Ngắt
                      </Button>
                    </div>
                  ))}
                </List>
              )
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">VPN</h2>
        {wg.length + data.ikev2.length === 0 ? <EmptyState title="Không có thiết bị nào đang nối VPN" icon={<ShieldIcon />} /> : (
          <List>
            {wg.map((p) => (
              <Row key={p.key} title={<><IpLabel ip={p.ip} /><Badge variant="secondary">WireGuard</Badge><Badge variant="outline">{p.name}</Badge></>}
                actions={<IpMenu ip={p.ip} />}>
                <Meta items={[`IP trong VPN ${p.vpn_ip}`, `bắt tay ${ago(p.handshake)}`, `↓ ${bytes(p.tx)}`, `↑ ${bytes(p.rx)}`]} />
              </Row>
            ))}
            {data.ikev2.map((s) => (
              <Row key={s.ike_id} title={<><IpLabel ip={s.ip} /><Badge variant="secondary">IKEv2</Badge><Badge variant="outline">{s.user}</Badge></>}
                actions={<>
                  <Button variant="ghost" size="sm" onClick={() => void kick({ ike_id: s.ike_id }, 'Đã ngắt VPN')}>
                    <UnplugIcon data-icon="inline-start" /> Ngắt
                  </Button>
                  <IpMenu ip={s.ip} />
                </>}>
                <Meta items={[`IP trong VPN ${s.vpn_ip || '—'}`, `đã nối ${dur(now - s.since)}`, `↓ ${bytes(s.tx)}`, `↑ ${bytes(s.rx)}`]} />
              </Row>
            ))}
          </List>
        )}
      </section>
    </div>
  )
}
