import { useState } from 'react'
import { ShieldIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { login } from '@/lib/api'

export function Login() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(String(new FormData(e.currentTarget).get('password')))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="grid min-h-svh place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground"><ShieldIcon className="size-5" /></div>
          <CardTitle className="text-lg">Quản lý proxy</CardTitle>
          <CardDescription>Proxy và VPN Hà Nội</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void submit(e)}>
            <FieldGroup>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="login-pass">Mật khẩu quản trị</FieldLabel>
                <Input id="login-pass" name="password" type="password" autoComplete="current-password" required autoFocus aria-invalid={error ? true : undefined} />
                {error && <FieldError>{error}</FieldError>}
              </Field>
              <Button type="submit" disabled={busy} className="w-full">{busy && <Spinner data-icon="inline-start" />} Đăng nhập</Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
