// Shared state of the signed-in page: the viewer's own IP, a refresh counter that reloads the open tab
// after any action, and the cross-tab "Nhật ký of this IP" jump.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import { useConfirm } from './confirm'

export type Tab = 'live' | 'ips' | 'log' | 'users' | 'blocked' | 'settings'

interface Admin {
  myIp: string
  setMyIp(ip: string): void
  version: number
  /** Runs an API action: toast on success or failure, then reloads the open tab. */
  act<T>(fn: () => Promise<T>, ok?: string | ((r: T) => string)): Promise<T | undefined>
  online: boolean | null
  setOnline(on: boolean): void
  logQuery: string
  showLogFor(ip: string): void
  tab: Tab
  setTab(t: Tab): void
}

export const AdminCtx = createContext<Admin | null>(null)
export const useAdmin = () => useContext(AdminCtx)!

/** Loads data for a tab; reloads when `version` changes (after any action) or `deps` change. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const { version, setOnline } = useAdmin()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    try {
      setData(await load())
      setError(null)
      setOnline(true)
    } catch (e) {
      const err = e as ApiError
      if (!err.status) setOnline(false)
      if (err.status !== 401) setError(err.message)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    void reload()
  }, [reload, version])
  return { data, error, reload }
}

export function useIpActions() {
  const { act, myIp, showLogFor } = useAdmin()
  const confirm = useConfirm()
  return {
    showLogFor,
    kickIp: (ip: string) => act(() => api<{ kicked: number }>('/kick', { ip }), (r) => `Đã ngắt ${r.kicked} kết nối của ${ip}`),
    async block(ip: string, note = '') {
      const ok = await confirm({
        title: `Chặn ${ip}?`,
        description: ip === myIp
          ? 'Đây là IP bạn đang dùng: bạn sẽ không dùng được proxy và VPN từ mạng này nữa.'
          : 'IP này sẽ không dùng được proxy và VPN; các kết nối đang mở bị ngắt ngay.',
        action: 'Chặn',
        destructive: true,
      })
      if (!ok) return false
      await act(() => api<{ kicked: number }>('/block', { ip, note }), (r) => `Đã chặn ${ip}${r.kicked ? `, ngắt ${r.kicked} kết nối` : ''}`)
      return true
    },
    unblock: (ip: string) => act(() => api('/unblock', { ip }), `Đã bỏ chặn ${ip}`),
  }
}

export function useAdminState(): Admin {
  const [myIp, setMyIp] = useState('')
  const [version, setVersion] = useState(0)
  const [online, setOnline] = useState<boolean | null>(null)
  const [logQuery, setLogQuery] = useState('')
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      const t = localStorage.getItem('proxyadmin.tab') as Tab | null
      return t && ['live', 'ips', 'log', 'users', 'blocked', 'settings'].includes(t) ? t : 'live'
    } catch {
      return 'live'
    }
  })
  const setTab = useCallback((t: Tab) => {
    setTabState(t)
    try {
      localStorage.setItem('proxyadmin.tab', t)
    } catch {
      // ignore
    }
  }, [])
  const act = useCallback(async <T,>(fn: () => Promise<T>, ok?: string | ((r: T) => string)) => {
    try {
      const r = await fn()
      if (ok) toast.success(typeof ok === 'function' ? ok(r) : ok)
      setVersion((v) => v + 1)
      return r
    } catch (e) {
      toast.error((e as Error).message)
      return undefined
    }
  }, [])
  const showLogFor = useCallback((ip: string) => {
    setLogQuery(ip)
    setTab('log')
  }, [setTab])
  return { myIp, setMyIp, version, act, online, setOnline, logQuery, showLogFor, tab, setTab }
}
