import './fonts.css';
import { checkPeers, isValidPeerId, DEFAULT_SERVER } from '../net/rendezvous';
import { RustSession, type SessionError, type SessionEvents, type SessionOptions } from '../net/session';
import type { PeerSummary } from '../proto/message';
import { attachInput, type Geometry } from './input';
import { loadPeers, rememberPeer, removePeer, type SavedPeer } from './saved-peers';
import { loadServer, saveServer } from './server-setting';
import { VideoPlayer } from './video';

const LAYOUT = `
  <header class="top">
    <form id="connect-form" autocomplete="off">
      <label>ID
        <input id="peer" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
      <label>Mật khẩu
        <input id="password" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="row">
        <button id="connect" type="submit" class="primary">Kết nối</button>
      </div>
    </form>
    <section id="saved" hidden>
      <h2 class="saved-title">Máy đã kết nối</h2>
      <ul id="saved-list"></ul>
    </section>
    <p id="status" role="status"></p>
  </header>
  <section id="stage">
    <div id="bar">
      <span id="bar-title"></span>
      <button id="disconnect" type="button">Ngắt</button>
    </div>
    <div id="screen-wrap"><canvas id="screen" tabindex="0" width="16" height="9"></canvas></div>
  </section>
  <details id="diagnostics">
    <summary>Diagnostics</summary>
    <label>Máy chủ RustDesk
      <input id="server" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
  </details>
`;

export interface RusterDeps {
  createSession: (o: SessionOptions) => { run(): Promise<void>; close(): void; submitPassword(p: string): void;
    sendMouse(t: number, b: number, x: number, y: number): void; sendKey(k: import('../proto/message').KeyInput): void; requestKeyFrame(): void };
  checkPeers: typeof checkPeers;
  now: () => number;
}

const DEFAULT_DEPS: RusterDeps = {
  createSession: (o) => new RustSession(o),
  checkPeers,
  now: () => Date.now(),
};

export function mountRuster(root: HTMLElement, deps: RusterDeps = DEFAULT_DEPS): () => void {
  root.innerHTML = LAYOUT;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const form = $<HTMLFormElement>('connect-form');
  const peer = $<HTMLInputElement>('peer');
  const password = $<HTMLInputElement>('password');
  const connect = $<HTMLButtonElement>('connect');
  const savedSection = $('saved');
  const savedList = $<HTMLUListElement>('saved-list');
  const status = $<HTMLParagraphElement>('status');
  const server = $<HTMLInputElement>('server');
  const stage = $('stage');
  const barTitle = $('bar-title');
  const canvas = $<HTMLCanvasElement>('screen');
  const disconnect = $<HTMLButtonElement>('disconnect');
  server.value = loadServer();

  let session: ReturnType<RusterDeps['createSession']> | null = null;
  let player: VideoPlayer | null = null;
  let detachInput: (() => void) | null = null;
  let geometry: Geometry = { width: 0, height: 0, originX: 0, originY: 0 };
  let onlineById = new Map<string, boolean>();
  let alive = true;
  /** Why the page closed the session itself (shown instead of the plain "Đã ngắt."). */
  let closingNote: string | null = null;

  const say = (text: string) => {
    status.textContent = text;
  };

  const renderSaved = (list: SavedPeer[] = loadPeers()) => {
    savedSection.hidden = list.length === 0;
    savedList.replaceChildren(
      ...list.map((p) => {
        const li = document.createElement('li');
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'saved-pick';
        pick.dataset.id = p.id;
        const id = document.createElement('span');
        id.className = 'saved-id';
        id.textContent = p.id;
        const state = document.createElement('span');
        state.className = 'saved-status';
        const online = onlineById.get(p.id);
        state.dataset.kind = online ? 'online' : '';
        state.textContent = online === undefined ? '' : online ? 'Trực tuyến' : 'Ngoại tuyến';
        pick.append(id, state);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'text saved-del';
        del.dataset.id = p.id;
        del.setAttribute('aria-label', `Xoá ${p.id}`);
        del.textContent = '×';
        li.append(pick, del);
        return li;
      }),
    );
  };

  const refreshOnline = () => {
    const ids = loadPeers().map((p) => p.id);
    if (ids.length === 0) return;
    void deps.checkPeers(ids, server.value).then((r) => {
      if (!alive || !r.ok) return;
      onlineById = r.online;
      renderSaved();
    });
  };

  const showStage = (on: boolean) => {
    root.classList.toggle('connected', on);
  };

  const endSession = () => {
    detachInput?.();
    detachInput = null;
    player?.close();
    player = null;
    session = null;
    showStage(false);
    connect.disabled = false;
  };

  const startScreen = (p: PeerSummary) => {
    geometry = { width: p.width, height: p.height, originX: p.originX, originY: p.originY };
    barTitle.textContent = `${p.hostname || peer.value.trim()} · ${p.platform}`.trim();
    showStage(true);
    const ctx = canvas.getContext('2d');
    const current = session;
    if (!current) return;
    if (!VideoPlayer.isSupported() || !ctx) {
      closingNote = 'Trình duyệt này chưa hỗ trợ giải mã video (WebCodecs).';
      current.close();
      return;
    }
    player = new VideoPlayer(
      {
        resize: (w, h) => {
          canvas.width = w;
          canvas.height = h;
          geometry = { ...geometry, width: w, height: h };
        },
        draw: (frame) => ctx.drawImage(frame, 0, 0),
      },
      () => current.requestKeyFrame(),
      (m) => say(m),
    );
    detachInput = attachInput(canvas, current, () => geometry);
    canvas.focus();
  };

  const events = (id: string): SessionEvents => ({
    status: (t) => say(t),
    needPassword: (reason) => {
      connect.disabled = false;
      password.value = '';
      password.focus();
      say(reason ? `Mật khẩu bị từ chối: ${reason}` : 'Máy đích yêu cầu mật khẩu.');
    },
    ready: (p) => {
      say('');
      renderSaved(rememberPeer(id, deps.now()));
      startScreen(p);
    },
    video: (frames) => player?.feed(frames),
    closed: (error: SessionError | null) => {
      endSession();
      say(error ? error.message : (closingNote ?? 'Đã ngắt.'));
      closingNote = null;
      refreshOnline();
    },
  });

  savedList.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!target?.dataset.id) return;
    if (target.classList.contains('saved-del')) renderSaved(removePeer(target.dataset.id));
    else {
      peer.value = target.dataset.id;
      password.focus();
    }
  });
  server.addEventListener('input', () => saveServer(server.value));
  disconnect.addEventListener('click', () => session?.close());

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (session) {
      // Already connecting and waiting for a password: send it on the live session.
      session.submitPassword(password.value);
      connect.disabled = true;
      return;
    }
    const id = peer.value.trim();
    if (!isValidPeerId(id)) {
      say('ID không hợp lệ.');
      return;
    }
    connect.disabled = true;
    say('Đang kết nối…');
    session = deps.createSession({ peerId: id, server: server.value.trim() || DEFAULT_SERVER, password: password.value, events: events(id) });
    void session.run();
  });

  renderSaved();
  refreshOnline();
  return () => {
    alive = false;
    session?.close();
    endSession();
    root.replaceChildren();
  };
}

const app = document.getElementById('app');
if (app) mountRuster(app);
