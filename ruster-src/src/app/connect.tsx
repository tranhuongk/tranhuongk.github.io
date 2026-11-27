// The connect page: ID + password, the remembered machines, the ID server and (public server only)
// the RustDesk sign-in. State and actions live in Ruster (ruster.ts); this only draws them.
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type FormEvent } from 'react';
import { ArrowRightIcon, CheckIcon, CopyIcon, KeyRoundIcon, PencilIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { OP_LABEL, OPS } from '../auth/account';
import { avatarHue, avatarLetter, displayName, formatId, MAX_NAME_LENGTH, relativeTime, type SavedPeer } from './saved-peers';
import { loadServer, loadServerKey, type ServerChoice } from './server-setting';
import type { Ruster } from './ruster';

export function ConnectScreen({ ruster, now }: { ruster: Ruster; now: () => number }) {
  const v = useSyncExternalStore(ruster.subscribe, ruster.getView);
  const peerRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    ruster.attach({
      peer: () => peerRef.current?.value ?? '',
      setPeer: (x) => void (peerRef.current && (peerRef.current.value = x)),
      password: () => pwRef.current?.value ?? '',
      setPassword: (x) => void (pwRef.current && (pwRef.current.value = x)),
      focusPassword: () => pwRef.current?.focus(),
    });
  }, [ruster]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    ruster.connect();
  };

  return (
    <main className="flex min-h-svh justify-center px-4 pt-[max(16px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))] sm:pt-[clamp(16px,10vh,96px)]">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <Card>
          <CardContent>
            <form id="connect-form" autoComplete="off" onSubmit={submit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="peer">ID</Label>
                <Input id="peer" ref={peerRef} required inputMode="text" autoComplete="off" autoCapitalize="off" spellCheck={false}
                  placeholder="123 456 789" className="h-10 font-mono tabular-nums" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Mật khẩu</Label>
                <Input id="password" ref={pwRef} type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} className="h-10" />
              </div>
              <div className="flex items-center gap-2.5">
                <Checkbox id="save-pw" checked={v.savePassword} onCheckedChange={(on) => ruster.setSavePassword(on === true)} />
                <Label htmlFor="save-pw" className="font-normal">Lưu mật khẩu</Label>
              </div>
              <Button id="connect" type="submit" size="lg" disabled={v.busy} className="h-10 w-full text-sm">
                Enter<ArrowRightIcon data-icon="inline-end" />
              </Button>
            </form>
            <p id="status" role="status" hidden={!v.status} className="mt-3 text-center text-sm text-muted-foreground">{v.status}</p>
          </CardContent>
        </Card>

        <section id="saved" aria-label="Máy đã kết nối" hidden={v.peers.length === 0}>
          <Card className="gap-0 py-1">
            <ul id="saved-list" className="flex max-h-[340px] flex-col divide-y overflow-y-auto">
              {v.peers.map((p) => (
                <PeerRow key={p.id} p={p} online={v.online.get(p.id)} editing={v.editingId === p.id} ruster={ruster} now={now} />
              ))}
            </ul>
          </Card>
        </section>

        <ServerCard ruster={ruster} server={v.server} formKey={v.serverFormKey} copied={v.copied} />
        <Account ruster={ruster} account={v.account} />
      </div>
    </main>
  );
}

function PeerRow({ p, online, editing, ruster, now }: { p: SavedPeer; online: boolean | undefined; editing: boolean; ruster: Ruster; now: () => number }) {
  const label = displayName(p) || formatId(p.id);
  if (editing) return <PeerEditor p={p} ruster={ruster} />;
  const meta = (p.password ? '🔑 ' : '') + (displayName(p) ? `${formatId(p.id)} · ${relativeTime(p.lastUsed, now())}` : relativeTime(p.lastUsed, now()));
  return (
    <li className="peer group flex items-center gap-1 pr-2">
      <button type="button" className="saved-pick flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-4 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => ruster.pick(p.id)}>
        <span className="peer-avatar grid size-9 shrink-0 place-items-center rounded-full bg-[hsl(var(--hue)_55%_50%/0.18)] text-sm font-semibold text-[hsl(var(--hue)_50%_35%)] dark:bg-[hsl(var(--hue)_55%_50%/0.25)] dark:text-[hsl(var(--hue)_80%_78%)]"
          style={{ '--hue': avatarHue(p.id) } as React.CSSProperties}>{avatarLetter(p)}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="peer-name truncate text-sm font-medium">{label}</span>
          <span className="peer-meta truncate text-xs text-muted-foreground tabular-nums" title={p.password ? 'Đã lưu mật khẩu' : undefined}>{meta}</span>
        </span>
        <span className={`saved-status inline-flex shrink-0 items-center gap-1.5 text-xs ${online ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}
          data-kind={online === undefined ? '' : online ? 'online' : 'offline'}>
          {online !== undefined && <span aria-hidden className={`size-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />}
          {online === undefined ? '' : online ? 'Trực tuyến' : <span className="sr-only">Ngoại tuyến</span>}
        </span>
      </button>
      <Button variant="ghost" size="icon-sm" className="peer-edit text-muted-foreground" aria-label={`Đổi tên ${label}`} onClick={() => ruster.edit(p.id)}>
        <PencilIcon />
      </Button>
      <Button variant="ghost" size="icon-sm" className="saved-del text-muted-foreground hover:text-destructive" aria-label={`Xoá ${label}`} onClick={() => ruster.remove(p.id)}>
        <XIcon />
      </Button>
    </li>
  );
}

function PeerEditor({ p, ruster }: { p: SavedPeer; ruster: Ruster }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <li className="peer editing px-3 py-2">
      <form className="peer-edit-form flex items-center gap-2" data-id={p.id}
        onSubmit={(e) => {
          e.preventDefault();
          ruster.finishEdit(true, ref.current?.value ?? '');
        }}>
        <Input ref={ref} className="peer-edit-input h-9 flex-1" maxLength={MAX_NAME_LENGTH} defaultValue={p.name ?? ''} autoComplete="off"
          placeholder={p.hostname || formatId(p.id)} aria-label={`Tên của ${formatId(p.id)}`}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            ruster.finishEdit(false);
          }} />
        <Button type="submit" size="sm" className="peer-save h-9">Lưu</Button>
        <Button type="button" variant="ghost" size="sm" className="peer-cancel h-9" onClick={() => ruster.finishEdit(false)}>Huỷ</Button>
      </form>
    </li>
  );
}

function ServerCard({ ruster, server, formKey, copied }: { ruster: Ruster; server: ServerChoice; formKey: number; copied: boolean }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span id="server-label" className="shrink-0 text-sm text-muted-foreground">Máy chủ</span>
          <ToggleGroup id="server" type="single" value={server} aria-labelledby="server-label" spacing={0}
            className="w-full rounded-lg bg-muted p-[3px]"
            onValueChange={(c) => c && ruster.pickServer(c as ServerChoice)}>
            {([['self', 'Hà Nội'], ['public', 'Công cộng'], ['custom', 'Tuỳ chỉnh']] as const).map(([c, label]) => (
              <ToggleGroupItem key={c} value={c} data-choice={c}
                className="h-7 flex-1 rounded-md px-2 text-[13px] text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm dark:data-[state=on]:bg-input/40">
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div id="server-self" hidden={server !== 'self'} className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[13px] font-medium">Dùng trên máy tính</span>
            <span className="server-hint text-xs text-muted-foreground">Dán vào app: Cài đặt → Mạng → biểu tượng dán</span>
          </div>
          <Button id="server-copy" variant="outline" size="sm" title="Chép config máy chủ Hà Nội" onClick={() => void ruster.copyConfig()}
            className={copied ? 'text-emerald-600 dark:text-emerald-400' : ''}>
            {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
            {copied ? 'Đã chép' : 'Sao chép'}
          </Button>
        </div>

        <form id="server-custom" hidden={server !== 'custom'} key={formKey} className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            ruster.saveCustom(String(f.get('host') ?? ''), String(f.get('key') ?? ''));
          }}>
          <Input id="server-host" name="host" required placeholder="Máy chủ ID" aria-label="Máy chủ ID" autoComplete="off" autoCapitalize="off" spellCheck={false}
            defaultValue={server === 'custom' ? loadServer() : ''} />
          <div className="flex gap-2">
            <Input id="server-pubkey" name="key" placeholder="Key" aria-label="Key của máy chủ" autoComplete="off" autoCapitalize="off" spellCheck={false}
              defaultValue={server === 'custom' ? (loadServerKey() ?? '') : ''} className="font-mono text-xs" />
            <Button type="submit" variant="secondary">Lưu</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Account({ ruster, account }: { ruster: Ruster; account: ReturnType<Ruster['getView']>['account'] }) {
  return (
    <div id="account" hidden={account.hidden} className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
      {account.kind === 'waiting' && <>
        <span className="account-label">Đang chờ đăng nhập…</span>
        <Button variant="ghost" size="sm" className="account-cancel" onClick={() => ruster.cancelSignIn()}>Huỷ</Button>
      </>}
      {account.kind === 'in' && <>
        <span className="account-label inline-flex items-center gap-1.5"><KeyRoundIcon className="size-3.5" />{`Đã đăng nhập${account.name ? `: ${account.name}` : ''}`}</span>
        <Button variant="ghost" size="sm" className="account-logout" onClick={() => ruster.signOut()}>Đăng xuất</Button>
      </>}
      {account.kind === 'out' && OPS.map((op) => (
        <Button key={op} variant="outline" size="sm" className="account-op" data-op={op} onClick={() => ruster.signIn(op)}>{OP_LABEL[op]}</Button>
      ))}
    </div>
  );
}
