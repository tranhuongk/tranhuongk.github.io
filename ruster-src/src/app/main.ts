import './fonts.css';
import { checkPeers, isValidPeerId } from '../net/rendezvous';
import { RustSession, type SessionError, type SessionEvents, type SessionOptions } from '../net/session';
import type { PeerSummary } from '../proto/message';
import {
  avatarHue, avatarLetter, displayName, formatId, loadPeers, MAX_NAME_LENGTH, relativeTime, rememberPeer, removePeer,
  renamePeer, type SavedPeer,
} from './saved-peers';
import { clearLogin, defaultLoginDeps, loadToken, loadUser, login, LoginError, OP_LABEL, OPS, type AccountUser, type Op } from '../auth/account';
import { loadServer } from './server-setting';
import { Stage, STAGE_HTML, type StageSession } from './stage';

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
    <div id="account" class="account"></div>
    <p id="status" role="status"></p>
  </header>
  <section id="stage">${STAGE_HTML}</section>
`;

export interface RusterDeps {
  createSession: (o: SessionOptions) => StageSession & { run(): Promise<void>; submitPassword(p: string): void };
  checkPeers: typeof checkPeers;
  now: () => number;
  account: AccountApi;
}

/** RustDesk account login as the page uses it (swapped out in tests). */
export interface AccountApi {
  token(): string;
  user(): AccountUser | null;
  /** Opens the blank sign-in window from the click, so popup blockers let it through. */
  openBlank(): Window | null;
  login(op: Op, win: Window | null, signal: AbortSignal): Promise<AccountUser>;
  logout(): void;
}

const defaultAccount = (): AccountApi => ({
  token: loadToken,
  user: loadUser,
  openBlank: () => window.open('', '_blank', 'width=420,height=640'),
  login: (op, win, signal) => login(op, defaultLoginDeps(), win, signal),
  logout: clearLogin,
});

const DEFAULT_DEPS: RusterDeps = {
  createSession: (o) => new RustSession(o),
  checkPeers,
  now: () => Date.now(),
  account: defaultAccount(),
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
  const stageEl = $('stage');
  const accountEl = $('account');
  /** The ID server: RustDesk's public one unless a `ruster.server` override is stored on the device. */
  const serverUrl = () => loadServer();

  let session: ReturnType<RusterDeps['createSession']> | null = null;
  let stage: Stage | null = null;
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

  // --- RustDesk account (the public server only serves logged-in controllers) ---------------------
  let loginAbort: AbortController | null = null;

  const renderAccount = () => {
    accountEl.replaceChildren();
    const label = document.createElement('span');
    label.className = 'account-label';
    if (loginAbort) {
      label.textContent = 'Đang chờ đăng nhập…';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'text account-cancel';
      cancel.textContent = 'Huỷ';
      accountEl.append(label, cancel);
      return;
    }
    const user = deps.account.token() ? deps.account.user() ?? { name: '', displayName: '' } : null;
    if (user) {
      label.textContent = `Đã đăng nhập RustDesk${user.displayName || user.name ? `: ${user.displayName || user.name}` : ''}`;
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'text account-logout';
      out.textContent = 'Đăng xuất';
      accountEl.append(label, out);
      return;
    }
    label.textContent = 'Đăng nhập RustDesk';
    accountEl.append(label);
    for (const op of OPS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'account-op';
      b.dataset.op = op;
      b.textContent = OP_LABEL[op];
      accountEl.append(b);
    }
  };

  accountEl.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!target) return;
    if (target.classList.contains('account-logout')) {
      deps.account.logout();
      renderAccount();
      say('Đã đăng xuất RustDesk.');
    } else if (target.classList.contains('account-cancel')) {
      loginAbort?.abort();
    } else if (target.dataset.op) {
      const win = deps.account.openBlank();
      const controller = new AbortController();
      loginAbort = controller;
      renderAccount();
      say('Đăng nhập trong cửa sổ vừa mở…');
      deps.account.login(target.dataset.op as Op, win, controller.signal).then(
        (user) => {
          loginAbort = null;
          renderAccount();
          say(`Đã đăng nhập RustDesk${user.displayName || user.name ? `: ${user.displayName || user.name}` : ''}. Bấm Enter để kết nối.`);
        },
        (e: unknown) => {
          loginAbort = null;
          renderAccount();
          say(e instanceof LoginError ? e.message : `Đăng nhập không được: ${(e as Error).message}`);
        },
      );
    }
  });

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
    stage?.destroy();
    stage = null;
    session = null;
    showStage(false);
    connect.disabled = false;
  };

  const startScreen = (id: string, p: PeerSummary) => {
    const current = session;
    if (!current) return;
    const titleOf = (saved?: SavedPeer) => (saved ? displayName(saved) : '') || p.hostname || formatId(id);
    showStage(true);
    stage = new Stage(stageEl, current, {
      peer: p,
      title: titleOf(loadPeers().find((x) => x.id === id)),
      rename: (name) => {
        const list = renamePeer(id, name);
        renderSaved(list);
        return titleOf(list.find((x) => x.id === id));
      },
      onError: (m) => say(m),
    });
    if (!stage.start()) {
      stage = null;
      closingNote = 'Trình duyệt này chưa hỗ trợ giải mã video (WebCodecs).';
      current.close();
    }
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
      startScreen(id, p);
    },
    video: (frames) => stage?.feed(frames),
    delay: (ms) => stage?.setDelay(ms),
    closed: (error: SessionError | null) => {
      endSession();
      if (error?.kind === 'auth') {
        // A stored token that the server no longer accepts is dropped so the login buttons come back.
        const expired = Boolean(deps.account.token());
        if (expired) deps.account.logout();
        renderAccount();
        say(expired ? 'Phiên đăng nhập RustDesk đã hết hạn. Đăng nhập lại rồi bấm Enter.' : 'Máy chủ RustDesk yêu cầu đăng nhập trước khi kết nối. Chọn một tài khoản ở trên rồi bấm Enter.');
      } else say(error ? error.message : (closingNote ?? 'Đã ngắt.'));
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
    session = deps.createSession({ peerId: id, server: serverUrl(), token: deps.account.token(), password: password.value, events: events(id) });
    void session.run();
  });

  renderSaved();
  renderAccount();
  refreshOnline();
  return () => {
    loginAbort?.abort();
    alive = false;
    session?.close();
    endSession();
    root.replaceChildren();
  };
}

const app = document.getElementById('app');
if (app) mountRuster(app);
