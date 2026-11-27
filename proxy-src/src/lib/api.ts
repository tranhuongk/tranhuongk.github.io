// Client for the admin API on the VPS (/padmin). Every call needs the admin token; a 401 drops it so the
// login screen comes back. The page itself holds nothing secret.
export const API = 'https://103-75-184-121.sslip.io/padmin'
export const PROXY = '103.75.184.121:48080'
const TOKEN_KEY = 'proxyadmin.token'

export type Kind = 'proxy' | 'wireguard' | 'ikev2'

export interface ProxyConn {
  sid: string
  ip: string
  port: number
  start: number | null
  proto: string
  user: string | null
  hosts: string[]
  rx: number
  tx: number
  status: 'ok' | 'auth_failed'
}
export interface WgPeer { key: string; name: string; ip: string; vpn_ip: string; handshake: number; rx: number; tx: number; online: boolean }
export interface IkeSa { ike_id: number; ip: string; user: string; vpn_ip: string; since: number; rx: number; tx: number }
export interface Live { proxy: ProxyConn[]; wireguard: WgPeer[]; ikev2: IkeSa[]; you: string; now: number }
export interface IpRow {
  ip: string; first: number; last: number; count: number; rx: number; tx: number
  users: string[]; kinds: Kind[]; failed: number; top_hosts: string[]; blocked: boolean
}
export interface LogRow {
  sid: string; kind: Kind; ip: string; user: string | null; proto: string | null
  start: number; end: number | null; hosts: string | null; rx: number; tx: number; status: string
}
export interface User { name: string; password: string; enabled: boolean; note?: string; live: number; last: number | null }
export interface Blocked { ip: string; note?: string; at: number }

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}

let token: string | null = null
try {
  token = localStorage.getItem(TOKEN_KEY)
} catch {
  // storage blocked: the session lasts for this tab only
}
const listeners = new Set<() => void>()

export const auth = {
  token: () => token,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => void listeners.delete(fn)
  },
  set(next: string | null) {
    token = next
    try {
      if (next) localStorage.setItem(TOKEN_KEY, next)
      else localStorage.removeItem(TOKEN_KEY)
    } catch {
      // ignore
    }
    for (const fn of listeners) fn()
  },
}

export async function login(password: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${API}/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
    })
  } catch {
    throw new ApiError('Không gọi được VPS.')
  }
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(d.error || `Lỗi ${res.status}`, res.status)
  auth.set(d.token)
}

export function logout(): void {
  const t = token
  if (t) fetch(`${API}/logout`, { method: 'POST', headers: { Authorization: `Bearer ${t}` } }).catch(() => {})
  auth.set(null)
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { headers: { Authorization: `Bearer ${token}` } }
  if (body !== undefined) {
    init.method = 'POST'
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  let res: Response
  try {
    res = await fetch(API + path, init)
  } catch {
    throw new ApiError('Không gọi được VPS.')
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) {
    auth.set(null)
    throw new ApiError('Phiên đăng nhập đã hết.', 401)
  }
  if (!res.ok) throw new ApiError(data.error || `Lỗi ${res.status}`, res.status)
  return data as T
}
