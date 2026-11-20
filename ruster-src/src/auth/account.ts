// RustDesk account login, as the official web client does it for the public server:
//   POST {api}/api/oidc/auth        {op, id, uuid, deviceInfo, apiDomain}  → {code, url}
//   (the user signs in with Google / GitHub / Microsoft in the popup at `url`)
//   GET  {api}/api/oidc/auth-query  ?code&id&uuid  → {error:"No authed oidc is found"} until done,
//                                                      then {type:"access_token", access_token, user}
// The access token goes into PunchHoleRequest.token. It lives in this browser's localStorage.
import nacl from 'tweetnacl';

export const API_BASE = 'https://admin.rustdesk.com';
export const OPS = ['google', 'github', 'microsoft'] as const;
export type Op = (typeof OPS)[number];
export const OP_LABEL: Record<Op, string> = { google: 'Google', github: 'GitHub', microsoft: 'Microsoft' };

export const TOKEN_KEY = 'ruster.token';
export const USER_KEY = 'ruster.user';
export const DEVICE_ID_KEY = 'ruster.deviceId';
export const DEVICE_UUID_KEY = 'ruster.deviceUuid';
export const LOGIN_TIMEOUT_MS = 3 * 60_000;
export const POLL_MS = 1000;

export interface AccountUser {
  name: string;
  displayName: string;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage blocked: the login only lasts for this tab
  }
}

export const loadToken = (): string => read(TOKEN_KEY) ?? '';

export function loadUser(): AccountUser | null {
  try {
    const u = JSON.parse(read(USER_KEY) ?? 'null') as { name?: unknown; displayName?: unknown } | null;
    if (!u || typeof u.name !== 'string') return null;
    return { name: u.name, displayName: typeof u.displayName === 'string' ? u.displayName : '' };
  } catch {
    return null;
  }
}

export function clearLogin(): void {
  write(TOKEN_KEY, null);
  write(USER_KEY, null);
}

/** Random 10-digit id of this browser as a RustDesk client (kept across visits). */
export function deviceId(random: (n: number) => Uint8Array = nacl.randomBytes): string {
  const saved = read(DEVICE_ID_KEY);
  if (saved && /^\d{10}$/.test(saved)) return saved;
  const n = new DataView(random(4).buffer as ArrayBuffer).getUint32(0);
  const id = String(1_000_000_000 + (n % 1_000_000_000));
  write(DEVICE_ID_KEY, id);
  return id;
}

/** Base64 of a random 32-byte value that identifies this browser to the account server. */
export function deviceUuid(random: (n: number) => Uint8Array = nacl.randomBytes): string {
  const saved = read(DEVICE_UUID_KEY);
  if (saved && /^[A-Za-z0-9+/]{43}=$/.test(saved)) return saved;
  const uuid = btoa(Array.from(random(32), (b) => String.fromCharCode(b)).join(''));
  write(DEVICE_UUID_KEY, uuid);
  return uuid;
}

export interface LoginDeps {
  fetch: typeof fetch;
  /** Opens (or navigates) the sign-in window. Called first, from the click, so popup blockers allow it. */
  openWindow: (url: string) => Window | null;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  api?: string;
}

export const defaultLoginDeps = (): LoginDeps => ({
  fetch: (input, init) => fetch(input, init),
  openWindow: (url) => window.open(url, '_blank', 'width=420,height=640'),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
});

export class LoginError extends Error {
  constructor(readonly kind: 'request' | 'timeout' | 'cancelled', message: string) {
    super(message);
    this.name = 'LoginError';
  }
}

interface AuthReply {
  error?: string;
  code?: string;
  url?: string;
  type?: string;
  access_token?: string;
  user?: { name?: string; display_name?: string };
}

/**
 * Signs in with `op` and stores the token. `win` is the window opened by the click handler (so a
 * popup blocker lets it through); `signal` cancels the wait.
 */
export async function login(op: Op, deps: LoginDeps, win: Window | null, signal?: AbortSignal): Promise<AccountUser> {
  const api = deps.api ?? API_BASE;
  const id = deviceId();
  const uuid = deviceUuid();
  const closeWin = () => {
    try {
      if (win && !win.closed) win.close();
    } catch {
      // already gone
    }
  };
  try {
    const start = (await (await deps.fetch(`${api}/api/oidc/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, id, uuid, deviceInfo: { os: 'web', type: 'web client', name: 'ruster' }, apiDomain: api }),
    })).json()) as AuthReply;
    if (start.error) throw new LoginError('request', start.error);
    if (!start.code || !start.url) throw new LoginError('request', 'Máy chủ trả về phản hồi đăng nhập không hợp lệ.');

    let shown = false;
    if (win && !win.closed) {
      try {
        win.location.href = start.url;
        shown = true;
      } catch {
        // cross-origin placeholder: fall through to a fresh window
      }
    }
    if (!shown) deps.openWindow(start.url);

    const t0 = deps.now();
    while (deps.now() - t0 < LOGIN_TIMEOUT_MS) {
      if (signal?.aborted) throw new LoginError('cancelled', 'Đã huỷ đăng nhập.');
      const url = new URL(`${api}/api/oidc/auth-query`);
      url.searchParams.set('code', start.code);
      url.searchParams.set('id', id);
      url.searchParams.set('uuid', uuid);
      try {
        const reply = (await (await deps.fetch(url.toString(), { method: 'GET', headers: { 'Content-Type': 'application/json' } })).json()) as AuthReply;
        if (reply.error) {
          if (!reply.error.includes('No authed oidc is found')) throw new LoginError('request', reply.error);
        } else if (reply.type === 'access_token' && reply.access_token) {
          const user = { name: reply.user?.name ?? '', displayName: reply.user?.display_name ?? '' };
          write(TOKEN_KEY, reply.access_token);
          write(USER_KEY, JSON.stringify(user));
          return user;
        }
      } catch (e) {
        if (e instanceof LoginError) throw e;
        // a network hiccup while polling: try again
      }
      await deps.sleep(POLL_MS);
    }
    throw new LoginError('timeout', 'Hết thời gian chờ đăng nhập.');
  } finally {
    closeWin();
  }
}
