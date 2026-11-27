import { useSyncExternalStore } from 'react'
import { ActivityIcon, BanIcon, GlobeIcon, LogOutIcon, ScrollTextIcon, SettingsIcon, ShieldIcon, UsersIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AdminCtx, useAdminState, type Tab } from '@/components/admin'
import { ConfirmProvider } from '@/components/confirm'
import { Login } from '@/components/login'
import { BlockedTab } from '@/components/tabs/blocked'
import { IpsTab } from '@/components/tabs/ips'
import { LiveTab } from '@/components/tabs/live'
import { LogTab } from '@/components/tabs/log'
import { SettingsTab } from '@/components/tabs/settings'
import { UsersTab } from '@/components/tabs/users'
import { auth, logout } from '@/lib/api'

const TABS: { value: Tab; label: string; icon: React.ReactNode; view: React.ReactNode }[] = [
  { value: 'live', label: 'Đang kết nối', icon: <ActivityIcon />, view: <LiveTab /> },
  { value: 'ips', label: 'Theo IP', icon: <GlobeIcon />, view: <IpsTab /> },
  { value: 'log', label: 'Nhật ký', icon: <ScrollTextIcon />, view: <LogTab /> },
  { value: 'users', label: 'User', icon: <UsersIcon />, view: <UsersTab /> },
  { value: 'blocked', label: 'Chặn', icon: <BanIcon />, view: <BlockedTab /> },
  { value: 'settings', label: 'Cài đặt', icon: <SettingsIcon />, view: <SettingsTab /> },
]

function Dashboard() {
  const admin = useAdminState()
  const status = admin.online === false ? { text: 'Mất kết nối VPS', cls: 'bg-destructive/10 text-destructive' }
    : admin.online ? { text: 'Đang chạy', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' }
    : { text: 'Đang kiểm tra…', cls: '' }
  return (
    <AdminCtx.Provider value={admin}>
      <Tabs value={admin.tab} onValueChange={(v) => admin.setTab(v as Tab)} className="min-h-svh gap-0">
        <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 pt-4 pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><ShieldIcon className="size-4" /></div>
                <h1 className="text-base font-semibold">Proxy Hà Nội</h1>
                <Badge variant="secondary" className={status.cls}>
                  <span className="size-1.5 rounded-full bg-current" aria-hidden /> {status.text}
                </Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={logout} className="text-muted-foreground">
                <LogOutIcon data-icon="inline-start" /> <span className="hidden sm:inline">Đăng xuất</span>
              </Button>
            </div>
            <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
              <TabsList>
                {TABS.map((t) => (
                  <TabsTrigger key={t.value} value={t.value} className="px-3">{t.icon} {t.label}</TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 py-6">
          {TABS.map((t) => <TabsContent key={t.value} value={t.value}>{t.view}</TabsContent>)}
        </main>
      </Tabs>
    </AdminCtx.Provider>
  )
}

export default function App() {
  const token = useSyncExternalStore(auth.subscribe, auth.token)
  return (
    <TooltipProvider>
      <ConfirmProvider>
        {token ? <Dashboard /> : <Login />}
        <Toaster position="bottom-center" richColors />
      </ConfirmProvider>
    </TooltipProvider>
  )
}
