// Dev only (`npm run dev`, then open with ?mock): answers the admin API from memory, so the page can be
// tried without touching the VPS. Never part of the production bundle.
import { API, type Blocked, type IpRow, type LogRow, type ProxyConn, type User } from './api'

const now = () => Date.now() / 1000
const me = '113.190.10.20'
let users: User[] = [
  { name: 'hanoi', password: 'Xk3pQ9vT2m', enabled: true, note: 'Máy chính', live: 3, last: now() - 60 },
  { name: 'lan', password: 'b7Rt5wPq1z', enabled: true, note: 'Lan – điện thoại', live: 0, last: now() - 7200 },
  { name: 'test', password: 'zz11yy22xx', enabled: false, live: 0, last: null },
]
let blocked: Blocked[] = [{ ip: '45.155.205.0/24', note: 'dò mật khẩu', at: now() - 86400 * 3 }]
let proxy: ProxyConn[] = [
  { sid: 'a1', ip: me, port: 51000, start: now() - 320, proto: 'http', user: 'hanoi', hosts: ['www.youtube.com:443', 'i.ytimg.com:443'], rx: 1_200_000, tx: 48_000_000, status: 'ok' },
  { sid: 'a2', ip: me, port: 51002, start: now() - 40, proto: 'socks5', user: 'hanoi', hosts: ['studio.youtube.com:443'], rx: 90_000, tx: 2_400_000, status: 'ok' },
  { sid: 'a3', ip: '171.224.80.5', port: 40000, start: now() - 1800, proto: 'http', user: 'hanoi', hosts: ['accounts.google.com:443'], rx: 30_000, tx: 400_000, status: 'ok' },
  { sid: 'a4', ip: '45.155.205.233', port: 40100, start: now() - 5, proto: 'socks5', user: null, hosts: [], rx: 200, tx: 0, status: 'auth_failed' },
]
const ips: IpRow[] = [
  { ip: me, first: now() - 86400 * 9, last: now() - 30, count: 412, rx: 80e6, tx: 3.1e9, users: ['hanoi'], kinds: ['proxy', 'wireguard'], failed: 0, top_hosts: ['www.youtube.com', 'studio.youtube.com', 'i.ytimg.com'], blocked: false },
  { ip: '171.224.80.5', first: now() - 86400 * 2, last: now() - 900, count: 37, rx: 4e6, tx: 2.2e8, users: ['hanoi', 'lan'], kinds: ['proxy'], failed: 1, top_hosts: ['accounts.google.com'], blocked: false },
  { ip: '45.155.205.233', first: now() - 86400, last: now() - 5, count: 120, rx: 30_000, tx: 0, users: [], kinds: ['proxy'], failed: 120, top_hosts: [], blocked: true },
]
const log: LogRow[] = Array.from({ length: 30 }, (_, i) => ({
  sid: `l${i}`, kind: i % 7 === 3 ? 'wireguard' : 'proxy', ip: i % 5 === 4 ? '45.155.205.233' : me,
  user: i % 5 === 4 ? null : 'hanoi', proto: i % 7 === 3 ? null : i % 2 ? 'http' : 'socks5', start: now() - i * 600,
  end: now() - i * 600 + 240, hosts: i % 7 === 3 ? '10.66.0.2' : 'www.youtube.com:443 i.ytimg.com:443',
  rx: 50_000 * i, tx: 2_000_000 * i, status: i % 5 === 4 ? 'auth_failed' : 'ok',
}))

function route(path: string, q: URLSearchParams, body: Record<string, unknown>): unknown {
  switch (path) {
    case '/login': return body.password === 'demo' ? { token: 'mock' } : Promise.reject(Object.assign(new Error('Sai mật khẩu.'), { status: 403 }))
    case '/logout': return { ok: true }
    case '/live': return {
      proxy, you: me, now: now(),
      wireguard: [{ key: 'k1', name: 'phone', ip: me, vpn_ip: '10.66.0.3', handshake: now() - 40, rx: 3e6, tx: 9e7, online: true },
        { key: 'k2', name: 'mac', ip: '', vpn_ip: '10.66.0.2', handshake: 0, rx: 0, tx: 0, online: false }],
      ikev2: [{ ike_id: 7, ip: '171.224.80.5', user: 'iphone-lan', vpn_ip: '10.66.1.2', since: now() - 4000, rx: 2e6, tx: 6e7 }],
    }
    case '/ips': return { rows: ips.map((r) => ({ ...r, blocked: blocked.some((b) => b.ip === r.ip || r.ip.startsWith(b.ip.split('/')[0]!.replace(/\.0$/, '.'))) })) }
    case '/history': {
      const term = q.get('q') ?? ''
      const rows = log.filter((r) => (!term || r.ip.includes(term) || (r.user ?? '').includes(term) || (r.hosts ?? '').includes(term))
        && (!q.get('kind') || r.kind === q.get('kind')) && (!q.get('status') || r.status === q.get('status'))
        && (!q.get('before') || r.start < Number(q.get('before'))))
      return { rows: rows.slice(0, 10), more: rows.length > 10 }
    }
    case '/users': return { users }
    case '/users/save': {
      const name = String(body.name)
      const old = users.find((u) => u.name === name)
      const next: User = { ...(old ?? { name, password: Math.random().toString(36).slice(2, 12), enabled: true, live: 0, last: null }) }
      if (typeof body.password === 'string') next.password = body.password
      if (typeof body.note === 'string') next.note = body.note
      if (typeof body.enabled === 'boolean') next.enabled = body.enabled
      users = old ? users.map((u) => (u.name === name ? next : u)) : [...users, next]
      return { ok: true, user: next }
    }
    case '/users/delete': users = users.filter((u) => u.name !== body.name); return { ok: true }
    case '/blocked': return { blocked }
    case '/block': blocked = [...blocked, { ip: String(body.ip), note: String(body.note ?? ''), at: now() }]; return { ok: true, kicked: 2 }
    case '/unblock': blocked = blocked.filter((b) => b.ip !== body.ip); return { ok: true }
    case '/kick': {
      const before = proxy.length
      proxy = proxy.filter((c) => c.sid !== body.sid && c.ip !== body.ip)
      return { ok: true, kicked: before - proxy.length }
    }
    case '/password': return String(body.new ?? '').length >= 10 ? { ok: true } : Promise.reject(Object.assign(new Error('Mật khẩu mới phải có ít nhất 10 ký tự.'), { status: 400 }))
    default: return Promise.reject(Object.assign(new Error('Không có đường này.'), { status: 404 }))
  }
}

export function installMock(): void {
  const real = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith(API)) return real(input, init)
    const u = new URL(url)
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    await new Promise((r) => setTimeout(r, 250))
    try {
      const data = await route(u.pathname.replace(/^\/padmin/, ''), u.searchParams, body)
      return new Response(JSON.stringify(data), { status: 200 })
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: (e as { status?: number }).status ?? 500 })
    }
  }
}
