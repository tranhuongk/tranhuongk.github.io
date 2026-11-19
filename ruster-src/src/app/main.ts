import './fonts.css';
import { checkPeers, isValidPeerId } from '../net/rendezvous';
import { RustSession, type SessionError, type SessionEvents, type SessionOptions } from '../net/session';
import type { PeerSummary } from '../proto/message';
import { attachInput, type Geometry } from './input';
import {
  avatarHue, avatarLetter, displayName, formatId, loadPeers, MAX_NAME_LENGTH, relativeTime, rememberPeer, removePeer,
  renamePeer, type SavedPeer,
} from './saved-peers';
import { loadServer } from './server-setting';
import { VideoPlayer } from './video';

const LAYOUT = `
  <header class="top">
    <form id="connect-form" autocomplete="off">
      <label>ID
        <input id="peer" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
      <label>Mật khẩu
        <input id="password" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="row">
        <button id="connect" type="submit" class="primary">Enter</button>
      </div>
    </form>
    <section id="saved" aria-label="Máy đã kết nối" hidden>
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
  const stage = $('stage');
  const barTitle = $('bar-title');
  const canvas = $<HTMLCanvasElement>('screen');
  const disconnect = $<HTMLButtonElement>('disconnect');
  /** The ID server: RustDesk's public one unless a `ruster.server` override is stored on the device. */
  const serverUrl = () => loadServer();

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

  /** Id of the machine whose name is being edited in place, if any. */
  let editingId: string | null = null;

  const button = (className: string, id: string, label: string, text: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.dataset.id = id;
    b.setAttribute('aria-label', label);
    b.textContent = text;
    return b;
  };

  const renderEditor = (p: SavedPeer): HTMLFormElement => {
    const f = document.createElement('form');
    f.className = 'peer-edit-form';
    f.dataset.id = p.id;
    const input = document.createElement('input');
    input.className = 'peer-edit-input';
    input.maxLength = MAX_NAME_LENGTH;
    input.value = p.name ?? '';
    input.placeholder = p.hostname || formatId(p.id);
    input.setAttribute('aria-label', `Tên của ${formatId(p.id)}`);
    input.autocomplete = 'off';
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'primary peer-save';
    save.textContent = 'Lưu';
    const cancel = button('text peer-cancel', p.id, 'Huỷ đổi tên', 'Huỷ');
    f.append(input, save, cancel);
    return f;
  };

  const renderCard = (p: SavedPeer): HTMLLIElement => {
    const li = document.createElement('li');
    li.className = 'peer';
    li.dataset.id = p.id;
    if (p.id === editingId) {
      li.classList.add('editing');
      li.append(renderEditor(p));
      return li;
    }
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'saved-pick';
    pick.dataset.id = p.id;
    const avatar = document.createElement('span');
    avatar.className = 'peer-avatar';
    avatar.style.setProperty('--hue', String(avatarHue(p.id)));
    avatar.textContent = avatarLetter(p);
    const text = document.createElement('span');
    text.className = 'peer-text';
    const name = document.createElement('span');
    name.className = 'peer-name';
    name.textContent = displayName(p) || formatId(p.id);
    const meta = document.createElement('span');
    meta.className = 'peer-meta';
    meta.textContent = displayName(p) ? `${formatId(p.id)} · ${relativeTime(p.lastUsed, deps.now())}` : relativeTime(p.lastUsed, deps.now());
    text.append(name, meta);
    const state = document.createElement('span');
    state.className = 'saved-status';
    const online = onlineById.get(p.id);
    state.dataset.kind = online === undefined ? '' : online ? 'online' : 'offline';
    state.textContent = online === undefined ? '' : online ? 'Trực tuyến' : 'Ngoại tuyến';
    pick.append(avatar, text, state);
    li.append(
      pick,
      button('text peer-edit', p.id, `Đổi tên ${displayName(p) || formatId(p.id)}`, '✎'),
      button('text saved-del', p.id, `Xoá ${displayName(p) || formatId(p.id)}`, '×'),
    );
    return li;
  };

  const renderSaved = (list: SavedPeer[] = loadPeers()) => {
    savedSection.hidden = list.length === 0;
    savedList.replaceChildren(...list.map(renderCard));
    const input = savedList.querySelector<HTMLInputElement>('.peer-edit-input');
    if (input && document.activeElement !== input) {
      input.focus();
      input.select();
    }
  };

  const refreshOnline = () => {
    const ids = loadPeers().map((p) => p.id);
    if (ids.length === 0) return;
    void deps.checkPeers(ids, serverUrl()).then((r) => {
      if (!alive || !r.ok) return;
      onlineById = r.online;
      if (editingId === null) renderSaved(); // never rebuild the card whose name is being typed
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
      renderSaved(rememberPeer(id, deps.now(), p.hostname));
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

  const finishEdit = (save: boolean, id: string, value: string) => {
    editingId = null;
    renderSaved(save ? renamePeer(id, value) : loadPeers());
  };

  savedList.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    const id = target?.dataset.id;
    if (!target || !id) return;
    if (target.classList.contains('saved-del')) {
      if (editingId === id) editingId = null;
      renderSaved(removePeer(id));
    } else if (target.classList.contains('peer-edit')) {
      editingId = id;
      renderSaved();
    } else if (target.classList.contains('peer-cancel')) {
      finishEdit(false, id, '');
    } else if (target.classList.contains('saved-pick')) {
      peer.value = id;
      password.focus();
    }
  });
  savedList.addEventListener('submit', (event) => {
    event.preventDefault();
    const f = event.target as HTMLFormElement;
    const id = f.dataset.id;
    if (!id) return;
    finishEdit(true, id, f.querySelector<HTMLInputElement>('.peer-edit-input')?.value ?? '');
  });
  savedList.addEventListener('keydown', (event) => {
    const input = event.target as HTMLElement;
    if (event.key !== 'Escape' || !input.classList.contains('peer-edit-input') || editingId === null) return;
    event.preventDefault();
    finishEdit(false, editingId, '');
  });
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
    session = deps.createSession({ peerId: id, server: serverUrl(), password: password.value, events: events(id) });
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
