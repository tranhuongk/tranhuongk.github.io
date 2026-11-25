import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { SessionEvents, SessionOptions } from '../net/session';
import type { PeerSummary } from '../proto/message';
import { mountRuster, type AccountApi, type RusterDeps } from './main';
import { PEERS_KEY } from './saved-peers';
import { SERVER_KEY, SERVER_PUBKEY_KEY } from './server-setting';

const flush = () => new Promise((r) => setTimeout(r, 0));
const PEER: PeerSummary = { hostname: 'MAC', platform: 'Mac OS', username: 'u', version: '1.5.3', width: 1920, height: 1080, originX: 0, originY: 0 };

class FakeSession {
  closed = false;
  passwords: string[] = [];
  constructor(readonly o: SessionOptions) {}
  run = vi.fn(() => new Promise<void>(() => {}));
  close() {
    this.closed = true;
    this.o.events.closed(null);
  }
  submitPassword(p: string) {
    this.passwords.push(p);
  }
  path: 'relay' | 'webrtc' | null = 'webrtc';
  sendMouse = vi.fn();
  sendKey = vi.fn();
  requestKeyFrame = vi.fn();
  setShowRemoteCursor = vi.fn();
  sendCtrlAltDel = vi.fn();
  get events(): SessionEvents {
    return this.o.events;
  }
}

describe('ruster page', () => {
  let app: HTMLElement;
  let sessions: FakeSession[];
  let deps: RusterDeps;
  let account: AccountApi & { token: ReturnType<typeof vi.fn>; login: ReturnType<typeof vi.fn>; logout: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    account = {
      token: vi.fn().mockReturnValue(''), user: vi.fn().mockReturnValue(null), openBlank: vi.fn().mockReturnValue(null),
      login: vi.fn(), logout: vi.fn(),
    } as unknown as typeof account;
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    app = document.getElementById('app')!;
    sessions = [];
    deps = {
      createSession: (o) => {
        const s = new FakeSession(o);
        sessions.push(s);
        return s;
      },
      checkPeers: vi.fn().mockResolvedValue({ ok: true, online: new Map() }),
      now: () => 1000,
      account,
    };
  });

  const submit = (id: string, pw = '') => {
    app.querySelector<HTMLInputElement>('#peer')!.value = id;
    app.querySelector<HTMLInputElement>('#password')!.value = pw;
    app.querySelector<HTMLFormElement>('#connect-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  };
  const status = () => app.querySelector('#status')!.textContent;

  test('shows ID, password, the Enter button and the server select: no title, no description, no list heading', () => {
    mountRuster(app, deps);
    expect(app.querySelector('h1')).toBeNull();
    expect([...app.querySelectorAll('label')].map((l) => l.firstChild?.textContent?.trim())).toEqual(['ID', 'Mật khẩu', 'Máy chủ']);
    expect(app.querySelector('#connect')?.textContent).toBe('Enter');
    expect(app.querySelector('.saved-title')).toBeNull();
    expect(app.querySelector('#saved')?.getAttribute('aria-label')).toBe('Máy đã kết nối');
  });

  test('while connecting the page only says "Đang kết nối…": step-by-step progress is not shown', () => {
    mountRuster(app, deps);
    submit('123456789', 'pw');
    for (const text of ['Kết nối… (0.0 s)', 'Nối relay… (1.0 s)', 'Đã mã hoá (WebRTC trực tiếp), chờ máy đích… (2.0 s)', 'Đăng nhập…', 'Đã đăng nhập.']) {
      sessions[0]!.events.status(text);
    }
    expect(status()).toBe('Đang kết nối…');
    expect(app.textContent).not.toContain('Nối relay');
  });

  test('connect starts a session with the id, password and server; an invalid id never does', () => {
    mountRuster(app, deps);
    submit('bad id');
    expect(sessions).toHaveLength(0);
    expect(status()).toBe('ID không hợp lệ.');
    submit('123456789', 'secret');
    expect(sessions[0]!.o).toMatchObject({ peerId: '123456789', password: 'secret', server: 'wss://103-75-184-121.sslip.io', serverKey: 'ZFEjVb8vuQm0wUCb2in01n8iq9U3a09MRlvcFByFemk=' });
    expect(app.querySelector<HTMLButtonElement>('#connect')!.disabled).toBe(true);
  });

  test('a rejected password asks again and resubmitting sends it on the live session', () => {
    mountRuster(app, deps);
    submit('123456789', 'wrong');
    sessions[0]!.events.needPassword('Wrong Password');
    expect(status()).toContain('Wrong Password');
    expect(app.querySelector<HTMLButtonElement>('#connect')!.disabled).toBe(false);
    submit('123456789', 'right');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.passwords).toEqual(['right']);
  });

  test('a ready session is remembered and its screen is shown; Ngắt closes it', () => {
    vi.stubGlobal('VideoDecoder', class {});
    vi.stubGlobal('EncodedVideoChunk', class {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    mountRuster(app, deps);
    submit('123456789', 'pw');
    sessions[0]!.events.ready(PEER);
    expect(JSON.parse(localStorage.getItem(PEERS_KEY)!)).toEqual([{ id: '123456789', lastUsed: 1000, hostname: 'MAC' }]);
    expect(app.classList.contains('connected')).toBe(true);
    expect(app.querySelector('#bar-name')!.textContent).toBe('MAC');
    app.querySelector<HTMLButtonElement>('#disconnect')!.click();
    expect(sessions[0]!.closed).toBe(true);
    expect(app.classList.contains('connected')).toBe(false);
    expect(status()).toBe('Đã ngắt.');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('without WebCodecs the screen is not shown and the user is told why', () => {
    mountRuster(app, deps);
    submit('123456789', 'pw');
    sessions[0]!.events.ready(PEER);
    expect(app.classList.contains('connected')).toBe(false);
    expect(status()).toContain('WebCodecs');
  });

  test('an error that ends the session is shown and the form is usable again', () => {
    mountRuster(app, deps);
    submit('123456789', 'pw');
    sessions[0]!.events.closed({ kind: 'offline', message: 'Máy đích không trực tuyến.', name: 'SessionError' });
    expect(status()).toBe('Máy đích không trực tuyến.');
    expect(app.querySelector<HTMLButtonElement>('#connect')!.disabled).toBe(false);
  });

  test('saved machines show their name, formatted id, age and online state; picking fills the id; × forgets', async () => {
    localStorage.setItem(PEERS_KEY, JSON.stringify([
      { id: '111222333', lastUsed: 1000, name: 'Mac nhà' },
      { id: '444555666', lastUsed: 500, hostname: 'PC-VP' },
    ]));
    deps.checkPeers = vi.fn().mockResolvedValue({ ok: true, online: new Map([['111222333', true], ['444555666', false]]) });
    mountRuster(app, deps);
    await flush();
    expect(deps.checkPeers).toHaveBeenCalledWith(['111222333', '444555666'], 'wss://103-75-184-121.sslip.io');
    expect([...app.querySelectorAll('.peer-name')].map((e) => e.textContent)).toEqual(['Mac nhà', 'PC-VP']);
    expect([...app.querySelectorAll('.peer-meta')].map((e) => e.textContent)).toEqual(['111 222 333 · vừa xong', '444 555 666 · vừa xong']);
    expect([...app.querySelectorAll('.peer-avatar')].map((e) => e.textContent)).toEqual(['M', 'P']);
    expect([...app.querySelectorAll('.saved-status')].map((e) => e.textContent)).toEqual(['Trực tuyến', 'Ngoại tuyến']);
    app.querySelector<HTMLButtonElement>('.saved-pick')!.click();
    expect(app.querySelector<HTMLInputElement>('#peer')!.value).toBe('111222333');
    app.querySelector<HTMLButtonElement>('.saved-del')!.click();
    expect(JSON.parse(localStorage.getItem(PEERS_KEY)!).map((p: { id: string }) => p.id)).toEqual(['444555666']);
  });

  test('a machine without any name shows its formatted id as the title', () => {
    localStorage.setItem(PEERS_KEY, JSON.stringify([{ id: '156993080', lastUsed: 1000 }]));
    mountRuster(app, deps);
    expect(app.querySelector('.peer-name')!.textContent).toBe('156 993 080');
    expect(app.querySelector('.peer-avatar')!.textContent).toBe('1');
  });

  test('✎ renames in place: Enter saves, Escape and Huỷ cancel, a blank name clears it', () => {
    localStorage.setItem(PEERS_KEY, JSON.stringify([{ id: '111', lastUsed: 1000, hostname: 'host' }]));
    mountRuster(app, deps);
    const open = () => app.querySelector<HTMLButtonElement>('.peer-edit')!.click();
    const input = () => app.querySelector<HTMLInputElement>('.peer-edit-input')!;
    const names = () => JSON.parse(localStorage.getItem(PEERS_KEY)!)[0].name;

    open();
    expect(input()).not.toBeNull();
    expect(input().placeholder).toBe('host');
    input().value = 'Mac nhà';
    app.querySelector<HTMLFormElement>('.peer-edit-form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(names()).toBe('Mac nhà');
    expect(app.querySelector('.peer-name')!.textContent).toBe('Mac nhà');

    open();
    expect(input().value).toBe('Mac nhà');
    input().value = 'khác';
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(names()).toBe('Mac nhà');
    expect(app.querySelector('.peer-edit-input')).toBeNull();

    open();
    app.querySelector<HTMLButtonElement>('.peer-cancel')!.click();
    expect(app.querySelector('.peer-edit-input')).toBeNull();

    open();
    input().value = '   ';
    app.querySelector<HTMLFormElement>('.peer-edit-form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(names()).toBeUndefined();
    expect(app.querySelector('.peer-name')!.textContent).toBe('host');
  });

  test('an online refresh does not wipe the name being typed', async () => {
    localStorage.setItem(PEERS_KEY, JSON.stringify([{ id: '111', lastUsed: 1000 }]));
    let resolve!: (v: { ok: true; online: Map<string, boolean> }) => void;
    deps.checkPeers = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    mountRuster(app, deps);
    app.querySelector<HTMLButtonElement>('.peer-edit')!.click();
    app.querySelector<HTMLInputElement>('.peer-edit-input')!.value = 'đang gõ';
    resolve({ ok: true, online: new Map([['111', true]]) });
    await flush();
    expect(app.querySelector<HTMLInputElement>('.peer-edit-input')!.value).toBe('đang gõ');
  });

  test('a ready session stores the host name the machine reported', () => {
    vi.stubGlobal('VideoDecoder', class {});
    vi.stubGlobal('EncodedVideoChunk', class {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    mountRuster(app, deps);
    submit('123456789', 'pw');
    sessions[0]!.events.ready(PEER);
    expect(JSON.parse(localStorage.getItem(PEERS_KEY)!)).toEqual([{ id: '123456789', lastUsed: 1000, hostname: 'MAC' }]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('there is no Diagnostics section, and a stored server override shows as Tuỳ chỉnh and is used', () => {
    localStorage.setItem(SERVER_KEY, 'wss://relay.example.com');
    mountRuster(app, deps);
    expect(app.querySelector('details')).toBeNull();
    expect(app.querySelector('#log')).toBeNull();
    expect(app.querySelector<HTMLSelectElement>('#server')!.value).toBe('custom');
    expect(app.querySelector<HTMLFormElement>('#server-custom')!.hidden).toBe(false);
    expect(app.querySelector<HTMLInputElement>('#server-host')!.value).toBe('wss://relay.example.com');
    submit('123456789', 'pw');
    expect(sessions[0]!.o.server).toBe('wss://relay.example.com');
  });

  describe('server select', () => {
    const pick = (value: string) => {
      const select = app.querySelector<HTMLSelectElement>('#server')!;
      select.value = value;
      select.dispatchEvent(new Event('change'));
    };

    test('defaults to our own server and hides the RustDesk sign-in row', () => {
      mountRuster(app, deps);
      expect(app.querySelector<HTMLSelectElement>('#server')!.value).toBe('self');
      expect(app.querySelector<HTMLElement>('#account')!.hidden).toBe(true);
      expect(app.querySelector<HTMLFormElement>('#server-custom')!.hidden).toBe(true);
    });

    test('the public server shows the sign-in row, is remembered and is used', () => {
      mountRuster(app, deps);
      pick('public');
      expect(app.querySelector<HTMLElement>('#account')!.hidden).toBe(false);
      expect(localStorage.getItem(SERVER_KEY)).toBe('wss://rs-ny.rustdesk.com');
      submit('123456789', 'pw');
      expect(sessions[0]!.o).toMatchObject({ server: 'wss://rs-ny.rustdesk.com', serverKey: 'OeVuKk5nlHiXp+APNn0Y3pC1Iwpwn44JGqrQCsWqmBw=' });
      pick('self');
      expect(localStorage.getItem(SERVER_KEY)).toBeNull();
      expect(app.querySelector<HTMLElement>('#account')!.hidden).toBe(true);
    });

    test('Tuỳ chỉnh keeps the host and key only once Lưu is pressed', () => {
      mountRuster(app, deps);
      pick('custom');
      expect(localStorage.getItem(SERVER_KEY)).toBeNull();
      app.querySelector<HTMLInputElement>('#server-host')!.value = 'rd.example.com/';
      app.querySelector<HTMLInputElement>('#server-pubkey')!.value = ' KEY= ';
      app.querySelector<HTMLFormElement>('#server-custom')!.dispatchEvent(new Event('submit', { cancelable: true }));
      expect(localStorage.getItem(SERVER_KEY)).toBe('rd.example.com');
      expect(localStorage.getItem(SERVER_PUBKEY_KEY)).toBe('KEY=');
      submit('123456789', 'pw');
      expect(sessions[0]!.o).toMatchObject({ server: 'rd.example.com', serverKey: 'KEY=' });
    });
  });

  describe('RustDesk account', () => {
    const accountText = () => app.querySelector('#account')!.textContent;

    test('logged out: just the three sign-in buttons, no caption; connecting sends no token', () => {
      mountRuster(app, deps);
      expect(accountText()).toBe('GoogleGitHubMicrosoft');
      expect([...app.querySelectorAll<HTMLButtonElement>('.account-op')].map((b) => b.dataset.op)).toEqual(['google', 'github', 'microsoft']);
      submit('123456789', 'pw');
      expect(sessions[0]!.o.token).toBe('');
    });

    test('logged in: the name and Đăng xuất show and the token is sent', () => {
      account.token.mockReturnValue('TOKEN');
      (account.user as ReturnType<typeof vi.fn>).mockReturnValue({ name: 'octo', displayName: 'Octo Cat' });
      mountRuster(app, deps);
      expect(accountText()).toContain('Octo Cat');
      expect(app.querySelector('.account-op')).toBeNull();
      submit('123456789', 'pw');
      expect(sessions[0]!.o.token).toBe('TOKEN');
      app.querySelector<HTMLButtonElement>('.account-logout')!.click();
      expect(account.logout).toHaveBeenCalled();
    });

    test('a sign-in button opens the window from the click, waits, then reports the account', async () => {
      const win = {} as Window;
      (account.openBlank as ReturnType<typeof vi.fn>).mockReturnValue(win);
      let finish!: (u: { name: string; displayName: string }) => void;
      account.login.mockReturnValue(new Promise((r) => (finish = r)));
      mountRuster(app, deps);
      app.querySelector<HTMLButtonElement>('[data-op="github"]')!.click();
      expect(account.login).toHaveBeenCalledWith('github', win, expect.any(AbortSignal));
      expect(accountText()).toContain('Đang chờ đăng nhập');
      account.token.mockReturnValue('T');
      (account.user as ReturnType<typeof vi.fn>).mockReturnValue({ name: 'octo', displayName: '' });
      finish({ name: 'octo', displayName: '' });
      await flush();
      expect(accountText()).toContain('Đã đăng nhập: octo');
      expect(accountText()).not.toContain('RustDesk');
      expect(status()).toContain('Bấm Enter');
    });

    test('Huỷ aborts the wait and a failed login shows its message', async () => {
      let signal!: AbortSignal;
      account.login.mockImplementation((_op, _win, s: AbortSignal) => new Promise((_r, reject) => {
        signal = s;
        s.addEventListener('abort', () => reject({ name: 'LoginError', kind: 'cancelled', message: 'Đã huỷ đăng nhập.' }));
      }));
      mountRuster(app, deps);
      app.querySelector<HTMLButtonElement>('[data-op="google"]')!.click();
      app.querySelector<HTMLButtonElement>('.account-cancel')!.click();
      expect(signal.aborted).toBe(true);
      await flush();
      expect(app.querySelector('.account-op')).not.toBeNull();
      expect(status()).toContain('Đăng nhập không được');
    });

    test('the server asking for a login brings the buttons back; an expired token is dropped', () => {
      mountRuster(app, deps);
      submit('123456789', 'pw');
      sessions[0]!.events.closed({ kind: 'auth', message: 'The connection is not allowed… log in first', name: 'SessionError' });
      expect(status()).toContain('yêu cầu đăng nhập');
      expect(account.logout).not.toHaveBeenCalled();

      account.token.mockReturnValue('OLD');
      submit('123456789', 'pw');
      sessions[1]!.events.closed({ kind: 'auth', message: 'log in', name: 'SessionError' });
      expect(account.logout).toHaveBeenCalledTimes(1);
      expect(status()).toContain('hết hạn');
    });
  });
});
