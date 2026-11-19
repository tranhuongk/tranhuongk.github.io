import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { SessionEvents, SessionOptions } from '../net/session';
import type { PeerSummary } from '../proto/message';
import { mountRuster, type RusterDeps } from './main';
import { PEERS_KEY } from './saved-peers';
import { SERVER_KEY } from './server-setting';

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
  sendMouse = vi.fn();
  sendKey = vi.fn();
  requestKeyFrame = vi.fn();
  get events(): SessionEvents {
    return this.o.events;
  }
}

describe('ruster page', () => {
  let app: HTMLElement;
  let sessions: FakeSession[];
  let deps: RusterDeps;
  beforeEach(() => {
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
    };
  });

  const submit = (id: string, pw = '') => {
    app.querySelector<HTMLInputElement>('#peer')!.value = id;
    app.querySelector<HTMLInputElement>('#password')!.value = pw;
    app.querySelector<HTMLFormElement>('#connect-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  };
  const status = () => app.querySelector('#status')!.textContent;

  test('shows only ID, password and the Enter button: no title, no description, no list heading', () => {
    mountRuster(app, deps);
    expect(app.querySelector('h1')).toBeNull();
    expect([...app.querySelectorAll('label')].map((l) => l.firstChild?.textContent?.trim())).toEqual(['ID', 'Mật khẩu', 'Máy chủ RustDesk']);
    expect(app.querySelector('#connect')?.textContent).toBe('Enter');
    expect(app.querySelector('.saved-title')).toBeNull();
    expect(app.querySelector('#saved')?.getAttribute('aria-label')).toBe('Máy đã kết nối');
  });

  test('connect starts a session with the id, password and server; an invalid id never does', () => {
    mountRuster(app, deps);
    submit('bad id');
    expect(sessions).toHaveLength(0);
    expect(status()).toBe('ID không hợp lệ.');
    submit('123456789', 'secret');
    expect(sessions[0]!.o).toMatchObject({ peerId: '123456789', password: 'secret', server: 'wss://rs-ny.rustdesk.com' });
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
    expect(app.querySelector('#bar-title')!.textContent).toContain('MAC');
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
    expect(deps.checkPeers).toHaveBeenCalledWith(['111222333', '444555666'], 'wss://rs-ny.rustdesk.com');
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

  test('the server override is kept only when it differs from the default', () => {
    mountRuster(app, deps);
    const server = app.querySelector<HTMLInputElement>('#server')!;
    server.value = 'wss://relay.example.com';
    server.dispatchEvent(new Event('input'));
    expect(localStorage.getItem(SERVER_KEY)).toBe('wss://relay.example.com');
    server.value = 'wss://rs-ny.rustdesk.com';
    server.dispatchEvent(new Event('input'));
    expect(localStorage.getItem(SERVER_KEY)).toBeNull();
  });
});
