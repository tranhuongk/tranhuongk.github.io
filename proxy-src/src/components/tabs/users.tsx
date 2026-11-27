import { useState } from 'react'
import { CopyIcon, EllipsisIcon, EyeIcon, EyeOffIcon, PencilIcon, PlusIcon, PowerIcon, Trash2Icon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { api, PROXY, type User } from '@/lib/api'
import { when } from '@/lib/format'
import { useAdmin, useLoad } from '../admin'
import { useConfirm } from '../confirm'
import { EmptyState, ErrorNote, List, Loading, Meta, Row } from '../bits'

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`Đã chép ${what}`)
  } catch {
    window.prompt('Chép thủ công:', text)
  }
}

type Editing = { mode: 'add' } | { mode: 'edit'; user: User } | null

export function UsersTab() {
  const { act } = useAdmin()
  const confirm = useConfirm()
  const [editing, setEditing] = useState<Editing>(null)
  const [shown, setShown] = useState<string | null>(null)
  const { data, error, reload } = useLoad(() => api<{ users: User[] }>('/users').then((d) => d.users), [])

  const remove = async (u: User) => {
    if (!(await confirm({ title: `Xoá user ${u.name}?`, description: 'Các kết nối đang mở của user này bị ngắt. Không hoàn tác được.', action: 'Xoá', destructive: true }))) return
    void act(() => api('/users/delete', { name: u.name }), `Đã xoá ${u.name}`)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">User proxy</h2>
        <Button onClick={() => setEditing({ mode: 'add' })}><PlusIcon data-icon="inline-start" /> Thêm user</Button>
      </div>
      {error && <ErrorNote message={error} retry={reload} />}
      {!data ? !error && <Loading /> : data.length === 0 ? (
        <EmptyState title="Chưa có user nào" description="Không ai dùng được proxy cho tới khi có ít nhất một user." icon={<UsersIcon />} />
      ) : (
        <List>
          {data.map((u) => (
            <Row key={u.name} dim={!u.enabled}
              title={<>
                <span className="font-semibold">{u.name}</span>
                {!u.enabled && <Badge variant="destructive">Đang tắt</Badge>}
                {u.live > 0 && <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">{u.live} kết nối</Badge>}
                {u.note && <span className="text-sm text-muted-foreground">{u.note}</span>}
              </>}
              actions={<>
                <Button variant="outline" size="sm" onClick={() => void copy(`http://${u.name}:${u.password}@${PROXY}`, 'chuỗi proxy')}>
                  <CopyIcon data-icon="inline-start" /> Chuỗi proxy
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Thao tác với ${u.name}`}><EllipsisIcon /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditing({ mode: 'edit', user: u })}><PencilIcon /> Sửa</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void act(() => api('/users/save', { name: u.name, enabled: !u.enabled }), u.enabled ? `Đã tắt ${u.name}` : `Đã bật ${u.name}`)}>
                      <PowerIcon /> {u.enabled ? 'Tắt' : 'Bật'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => void remove(u)}><Trash2Icon /> Xoá</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>}>
              <Meta items={[
                <span key="pw" className="inline-flex items-center gap-1">
                  Mật khẩu <span className="font-mono text-foreground/80">{shown === u.name ? u.password : '••••••••'}</span>
                  <Button variant="ghost" size="icon-xs" aria-label={shown === u.name ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onClick={() => setShown(shown === u.name ? null : u.name)}>
                    {shown === u.name ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                  <Button variant="ghost" size="icon-xs" aria-label="Chép mật khẩu" onClick={() => void copy(u.password, 'mật khẩu')}><CopyIcon /></Button>
                </span>,
                `dùng lần cuối ${u.last ? when(u.last) : 'chưa'}`,
              ]} />
            </Row>
          ))}
        </List>
      )}
      <UserDialog editing={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function UserDialog({ editing, onClose }: { editing: Editing; onClose(): void }) {
  const { act } = useAdmin()
  const user = editing?.mode === 'edit' ? editing.user : null
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const name = user?.name ?? String(f.get('name')).trim().toLowerCase()
    const password = String(f.get('password')).trim() || undefined
    setBusy(true)
    const r = await act(() => api('/users/save', { name, password, note: String(f.get('note')).trim() }), user ? 'Đã lưu' : `Đã thêm ${name}`)
    setBusy(false)
    if (r) onClose()
  }
  return (
    <Dialog open={editing !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-6" key={user?.name ?? 'new'}>
          <DialogHeader>
            <DialogTitle>{user ? `Sửa ${user.name}` : 'Thêm user'}</DialogTitle>
            <DialogDescription>
              {user ? 'Đổi mật khẩu sẽ ngắt các kết nối đang mở của user này.' : 'User mới dùng được proxy ngay sau khi thêm.'}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            {!user && (
              <Field>
                <FieldLabel htmlFor="u-name">Tên user</FieldLabel>
                <Input id="u-name" name="name" placeholder="vd: lan" required autoCapitalize="off" autoComplete="off" pattern="[a-zA-Z0-9_.\-]+" />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="u-pass">Mật khẩu</FieldLabel>
              <Input id="u-pass" name="password" autoCapitalize="off" autoComplete="off" placeholder={user ? 'Để trống = giữ nguyên' : 'Để trống = tự tạo'} />
            </Field>
            <Field>
              <FieldLabel htmlFor="u-note">Ghi chú</FieldLabel>
              <Input id="u-note" name="note" defaultValue={user?.note ?? ''} autoComplete="off" placeholder="Ai dùng" />
              <FieldDescription>Chỉ để bạn nhớ user này của ai.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={busy}>{user ? 'Lưu' : 'Thêm'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
