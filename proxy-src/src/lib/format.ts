export function bytes(n: number | null | undefined): string {
  let v = Number(n) || 0
  if (v < 1024) return `${v} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < units.length - 1)
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

export function dur(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} giây`
  if (s < 3600) return `${Math.floor(s / 60)} phút`
  if (s < 86400) return `${Math.floor(s / 3600)} giờ ${Math.floor((s % 3600) / 60)} phút`
  return `${Math.floor(s / 86400)} ngày`
}

const fmt = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})
export const when = (t: number | null | undefined) => (t ? fmt.format(new Date(t * 1000)) : '—')
export const ago = (t: number | null | undefined) => (t ? `${dur(Date.now() / 1000 - t)} trước` : '—')

export const KIND: Record<string, string> = { proxy: 'Proxy', wireguard: 'WireGuard', ikev2: 'IKEv2' }
export const PROTO: Record<string, string> = { http: 'HTTP', socks5: 'SOCKS5', socks4: 'SOCKS4', wireguard: 'WireGuard', ikev2: 'IKEv2' }
export const stripPort = (host: string) => host.replace(/:(80|443)$/, '')
