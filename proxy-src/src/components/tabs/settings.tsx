import { useState } from 'react'
import { CopyIcon, LogOutIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { api, logout, PROXY } from '@/lib/api'
import { useAdmin } from '../admin'

export function SettingsTab() {
  const { act } = useAdmin()
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    setBusy(true)
    const r = await act(() => api('/password', { old: f.get('old'), new: f.get('new') }), 'Đã đổi mật khẩu quản trị; các thiết bị khác phải đăng nhập lại')
    setBusy(false)
    if (r) form.reset()
  }
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-6">
          <CardHeader>
            <CardTitle>Đổi mật khẩu quản trị</CardTitle>
            <CardDescription>Đổi xong, các thiết bị khác phải đăng nhập lại.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="pw-old">Mật khẩu hiện tại</FieldLabel>
                <Input id="pw-old" name="old" type="password" autoComplete="current-password" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="pw-new">Mật khẩu mới</FieldLabel>
                <Input id="pw-new" name="new" type="password" autoComplete="new-password" minLength={10} required placeholder="Ít nhất 10 ký tự" />
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={busy}>Đổi mật khẩu</Button>
          </CardFooter>
        </form>
      </Card>
      <Card className="self-start">
        <CardHeader>
          <CardTitle>Kết nối proxy</CardTitle>
          <CardDescription>Một cổng nhận cả HTTP lẫn SOCKS5.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3 rounded-lg">
          <code className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-sm">{PROXY}</code>
          <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(PROXY).then(() => toast.success('Đã chép địa chỉ proxy'))}>
            <CopyIcon data-icon="inline-start" /> Chép
          </Button>
        </CardContent>
        <CardFooter className="border-t">
          <Button variant="ghost" onClick={logout}><LogOutIcon data-icon="inline-start" /> Đăng xuất</Button>
        </CardFooter>
      </Card>
    </div>
  )
}
