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

  test('shows only ID, password and Kết nối: no title, no description', () => {
    mountRuster(app, deps);
    expect(app.querySelector('h1')).toBeNull();
    expect([...app.querySelectorAll('label')].map((l) => l.firstChild?.textContent?.trim())).toEqual(['ID', 'Mật khẩu', 'Máy chủ RustDesk']);
    expect(app.querySelector('#connect')?.textContent).toBe('Kết nối');
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
    expect(JSON.parse(localStorage.getItem(PEERS_KEY)!)).toEqual([{ id: '123456789', lastUsed: 1000 }]);
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

  test('saved machines show their online state; picking fills the id; × forgets', async () => {
    localStorage.setItem(PEERS_KEY, JSON.stringify([{ id: '111', lastUsed: 2 }, { id: '222', lastUsed: 1 }]));
    deps.checkPeers = vi.fn().mockResolvedValue({ ok: true, online: new Map([['111', true], ['222', false]]) });
    mountRuster(app, deps);
    await flush();
    expect(deps.checkPeers).toHaveBeenCalledWith(['111', '222'], 'wss://rs-ny.rustdesk.com');
    expect([...app.querySelectorAll('.saved-status')].map((e) => e.textContent)).toEqual(['Trực tuyến', 'Ngoại tuyến']);
    app.querySelector<HTMLButtonElement>('.saved-pick')!.click();
    expect(app.querySelector<HTMLInputElement>('#peer')!.value).toBe('111');
    app.querySelector<HTMLButtonElement>('.saved-del')!.click();
    expect(JSON.parse(localStorage.getItem(PEERS_KEY)!)).toEqual([{ id: '222', lastUsed: 1 }]);
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
