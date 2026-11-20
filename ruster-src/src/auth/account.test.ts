import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  clearLogin, deviceId, deviceUuid, DEVICE_ID_KEY, LOGIN_TIMEOUT_MS, login, loadToken, loadUser, LoginError, TOKEN_KEY, USER_KEY,
  type LoginDeps,
} from './account';

beforeEach(() => localStorage.clear());

const json = (body: unknown) => Promise.resolve({ json: () => Promise.resolve(body) } as Response);

function deps(replies: unknown[]): LoginDeps & { calls: { url: string; init?: RequestInit }[]; opened: string[]; clock: { t: number } } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const opened: string[] = [];
  const clock = { t: 0 };
  let i = 0;
  return {
    calls, opened, clock,
    fetch: ((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return json(replies[Math.min(i++, replies.length - 1)]);
    }) as typeof fetch,
    openWindow: (url) => (opened.push(url), null),
    sleep: async (ms) => void (clock.t += ms),
    now: () => clock.t,
  };
}

describe('device identity', () => {
  test('a 10-digit id and a base64 uuid are created once and kept', () => {
    const a = deviceId(() => new Uint8Array([1, 2, 3, 4]));
    expect(a).toMatch(/^\d{10}$/);
    expect(deviceId()).toBe(a);
    const u = deviceUuid(() => new Uint8Array(32).fill(7));
    expect(u).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(deviceUuid()).toBe(u);
    localStorage.setItem(DEVICE_ID_KEY, 'junk');
    expect(deviceId()).toMatch(/^\d{10}$/);
  });
});

describe('login', () => {
  test('posts the request, shows the sign-in page, polls until the token arrives and stores it', async () => {
    const d = deps([
      { code: 'CODE1', url: 'https://github.com/login/oauth/authorize?x=1' },
      { error: 'No authed oidc is found' },
      { error: 'No authed oidc is found' },
      { type: 'access_token', access_token: 'TOKEN-XYZ', user: { name: 'octo', display_name: 'Octo Cat' } },
    ]);
    const user = await login('github', d, null);
    expect(user).toEqual({ name: 'octo', displayName: 'Octo Cat' });
    expect(loadToken()).toBe('TOKEN-XYZ');
    expect(loadUser()).toEqual({ name: 'octo', displayName: 'Octo Cat' });
    expect(d.opened).toEqual(['https://github.com/login/oauth/authorize?x=1']);
    const post = d.calls[0]!;
    expect(post.url).toBe('https://admin.rustdesk.com/api/oidc/auth');
    expect(JSON.parse(String(post.init!.body))).toMatchObject({ op: 'github', deviceInfo: { type: 'web client' }, apiDomain: 'https://admin.rustdesk.com' });
    const poll = new URL(d.calls[1]!.url);
    expect(poll.pathname).toBe('/api/oidc/auth-query');
    expect(poll.searchParams.get('code')).toBe('CODE1');
    expect(poll.searchParams.get('id')).toBe(deviceId());
    expect(poll.searchParams.get('uuid')).toBe(deviceUuid());
    expect(d.calls).toHaveLength(4);
  });

  test('the blank window opened by the click is navigated instead of opening another one', async () => {
    const win = { closed: false, location: { href: '' }, close: vi.fn() } as unknown as Window;
    const d = deps([{ code: 'C', url: 'https://accounts.example/auth' }, { type: 'access_token', access_token: 'T', user: { name: 'u' } }]);
    await login('google', d, win);
    expect(win.location.href).toBe('https://accounts.example/auth');
    expect(d.opened).toEqual([]);
    expect(win.close).toHaveBeenCalled();
  });

  test('a server error, a bad reply, a cancel and a timeout end the login without a token', async () => {
    await expect(login('google', deps([{ error: 'oidc not configured' }]), null)).rejects.toMatchObject({ kind: 'request', message: 'oidc not configured' });
    await expect(login('google', deps([{}]), null)).rejects.toMatchObject({ kind: 'request' });
    const abort = new AbortController();
    abort.abort();
    await expect(login('google', deps([{ code: 'C', url: 'u' }]), null, abort.signal)).rejects.toMatchObject({ kind: 'cancelled' });
    const slow = deps([{ code: 'C', url: 'u' }, { error: 'No authed oidc is found' }]);
    await expect(login('google', slow, null)).rejects.toBeInstanceOf(LoginError);
    expect(slow.clock.t).toBeGreaterThanOrEqual(LOGIN_TIMEOUT_MS);
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  test('a network hiccup while polling is retried; a fatal server error is not', async () => {
    let n = 0;
    const d = deps([{ code: 'C', url: 'u' }]);
    d.fetch = ((url: string) => {
      n++;
      if (n === 1) return json({ code: 'C', url: 'u' });
      if (n === 2) return Promise.reject(new Error('offline'));
      return json({ type: 'access_token', access_token: 'T', user: {} });
    }) as typeof fetch;
    await expect(login('github', d, null)).resolves.toEqual({ name: '', displayName: '' });
    localStorage.clear();
    const bad = deps([{ code: 'C', url: 'u' }, { error: 'denied by user' }]);
    await expect(login('github', bad, null)).rejects.toMatchObject({ message: 'denied by user' });
  });

  test('clearLogin removes the token and the user', () => {
    localStorage.setItem(TOKEN_KEY, 'T');
    localStorage.setItem(USER_KEY, '{"name":"u"}');
    clearLogin();
    expect(loadToken()).toBe('');
    expect(loadUser()).toBeNull();
  });
});
