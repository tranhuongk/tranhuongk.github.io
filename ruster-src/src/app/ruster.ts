// What the connect page does, without the page: sessions, the remembered machines, the ID server
// choice and the RustDesk account. The React view (connect.tsx) renders `view` and calls these
// methods; the remote screen itself is the plain Stage in #stage, outside React.
import { flushSync } from 'react-dom';
import { checkPeers, isValidPeerId } from '../net/rendezvous';
import { RustSession, type SessionError, type SessionEvents, type SessionOptions } from '../net/session';
import type { PeerSummary } from '../proto/message';
import { clearLogin, defaultLoginDeps, loadToken, loadUser, login, LoginError, type AccountUser, type Op } from '../auth/account';
import {
  displayName, forgetPassword, formatId, loadPeers, loadSavePassword, rememberPeer, removePeer, renamePeer,
  storeSavePassword, type SavedPeer,
} from './saved-peers';
import { loadServer, loadServerKey, saveServer, selfConfigCode, serverChoice, type ServerChoice } from './server-setting';
import { Stage, type StageSession } from './stage';

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

export const DEFAULT_DEPS: RusterDeps = {
  createSession: (o) => new RustSession(o),
  checkPeers,
  now: () => Date.now(),
  account: {
    token: loadToken,
    user: loadUser,
    openBlank: () => window.open('', '_blank', 'width=420,height=640'),
    login: (op, win, signal) => login(op, defaultLoginDeps(), win, signal),
    logout: clearLogin,
  },
};

/** The ID and password fields, owned by the view. */
export interface Fields {
  peer(): string;
  setPeer(v: string): void;
  password(): string;
  setPassword(v: string): void;
  focusPassword(): void;
}

/** `hidden`: only RustDesk's public server asks controllers to sign in; a self-hosted hbbs never does. */
export type AccountView = ({ kind: 'waiting' } | { kind: 'in'; name: string } | { kind: 'out' }) & { hidden: boolean };

export interface View {
  status: string;
  busy: boolean;
  peers: SavedPeer[];
  online: Map<string, boolean>;
  editingId: string | null;
  savePassword: boolean;
  server: ServerChoice;
  /** Bumped when the custom server fields should show what is stored again. */
  serverFormKey: number;
  account: AccountView;
  copied: boolean;
}

export class Ruster {
  view: View;
  private readonly listeners = new Set<() => void>();
  private fields: Fields | null = null;
  private session: ReturnType<RusterDeps['createSession']> | null = null;
  private stage: Stage | null = null;
  private alive = true;
  /** Why the page closed the session itself (shown instead of the plain "Đã ngắt."). */
  private closingNote: string | null = null;
  /** The password last sent and whether to save it once the machine accepts it. */
  private sent = { password: '', save: false, fromStore: false };
  private loginAbort: AbortController | null = null;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly root: HTMLElement, private readonly stageEl: HTMLElement, private readonly deps: RusterDeps) {
    this.view = {
      status: '', busy: false, peers: loadPeers(), online: new Map(), editingId: null, savePassword: loadSavePassword(),
      server: serverChoice(), serverFormKey: 0, account: { kind: 'out', hidden: true }, copied: false,
    };
    this.view.account = this.accountView();
  }

  // --- store -------------------------------------------------------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getView = () => this.view;
  private set(patch: Partial<View>): void {
    this.view = { ...this.view, ...patch };
    // Rendered at once, so whoever changed something (a click, the session) sees the page updated.
    flushSync(() => {
      for (const fn of this.listeners) fn();
    });
  }
  attach(fields: Fields): void {
    this.fields = fields;
  }

  private say(status: string): void {
    this.set({ status });
  }
  private serverUrl = () => loadServer();

  start(): void {
    this.refreshOnline();
  }

  destroy(): void {
    this.loginAbort?.abort();
    this.alive = false;
    this.session?.close();
    this.endSession();
    if (this.copyTimer !== null) clearTimeout(this.copyTimer);
  }

  // --- connecting --------------------------------------------------------------------------
  connect(fromStore = false): void {
    const f = this.fields!;
    this.sent = { password: f.password(), save: this.view.savePassword, fromStore };
    if (this.session) {
      // Already connecting and waiting for a password: send it on the live session.
      this.session.submitPassword(f.password());
      this.set({ busy: true });
      return;
    }
    const id = f.peer().trim();
    if (!isValidPeerId(id)) {
      this.say('ID không hợp lệ.');
      return;
    }
    this.set({ busy: true, status: 'Đang kết nối…' });
    this.session = this.deps.createSession({
      peerId: id, server: this.serverUrl(), serverKey: loadServerKey(this.serverUrl()), token: this.deps.account.token(),
      password: f.password(), events: this.events(id),
    });
    void this.session.run();
  }

  setSavePassword(on: boolean): void {
    storeSavePassword(on);
    this.set({ savePassword: on });
  }

  private refreshOnline(): void {
    const ids = loadPeers().map((p) => p.id);
    if (ids.length === 0) return;
    void this.deps.checkPeers(ids, this.serverUrl()).then((r) => {
      if (!this.alive || !r.ok) return;
      this.set({ online: r.online });
    });
  }

  private showStage(on: boolean): void {
    this.root.classList.toggle('connected', on);
  }

  private endSession(): void {
    this.stage?.destroy();
    this.stage = null;
    this.session = null;
    this.showStage(false);
    if (this.alive) this.set({ busy: false });
  }

  private startScreen(id: string, p: PeerSummary): void {
    const current = this.session;
    if (!current) return;
    const titleOf = (saved?: SavedPeer) => (saved ? displayName(saved) : '') || p.hostname || formatId(id);
    this.showStage(true);
    this.stage = new Stage(this.stageEl, current, {
      peer: p,
      title: titleOf(loadPeers().find((x) => x.id === id)),
      rename: (name) => {
        const list = renamePeer(id, name);
        this.set({ peers: list });
        return titleOf(list.find((x) => x.id === id));
      },
      onError: (m) => this.say(m),
    });
    if (!this.stage.start()) {
      this.stage = null;
      this.closingNote = 'Trình duyệt này chưa hỗ trợ giải mã video (WebCodecs).';
      current.close();
    }
  }

  private events(id: string): SessionEvents {
    return {
      status: () => {}, // the page only says "Đang kết nối…"; step-by-step progress is not shown
      needPassword: (reason) => {
        // A saved password the machine refused is dropped, so the next pick asks instead of failing again.
        const peers = reason && this.sent.fromStore ? forgetPassword(id) : this.view.peers;
        this.sent.fromStore = false;
        this.fields?.setPassword('');
        this.set({ busy: false, peers, status: reason ? `Mật khẩu bị từ chối: ${reason}` : 'Máy đích yêu cầu mật khẩu.' });
        this.fields?.focusPassword();
      },
      ready: (p) => {
        const { save, password } = this.sent;
        this.set({ status: '', peers: rememberPeer(id, this.deps.now(), p.hostname, save && password ? password : save ? undefined : null) });
        this.fields?.setPassword('');
        this.startScreen(id, p);
      },
      video: (frames) => this.stage?.feed(frames),
      delay: (ms) => this.stage?.setDelay(ms),
      cursor: (e) => this.stage?.cursorEvent(e),
      clipboard: (items) => this.stage?.remoteClipboard(items),
      closed: (error: SessionError | null) => {
        this.endSession();
        if (!this.alive) return;
        if (error?.kind === 'auth') {
          // A stored token that the server no longer accepts is dropped so the login buttons come back.
          const expired = Boolean(this.deps.account.token());
          if (expired) this.deps.account.logout();
          this.set({
            account: this.accountView(),
            status: expired ? 'Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi bấm Enter.' : 'Máy chủ yêu cầu đăng nhập trước khi kết nối. Chọn một tài khoản ở trên rồi bấm Enter.',
          });
        } else this.say(error ? error.message : (this.closingNote ?? 'Đã ngắt.'));
        this.closingNote = null;
        this.refreshOnline();
      },
    };
  }

  // --- remembered machines -----------------------------------------------------------------
  pick(id: string): void {
    const f = this.fields!;
    f.setPeer(id);
    const saved = loadPeers().find((p) => p.id === id)?.password;
    f.setPassword(saved ?? '');
    if (saved && !this.session) {
      this.setSavePassword(true);
      this.connect(true);
    } else f.focusPassword();
  }
  remove(id: string): void {
    this.set({ peers: removePeer(id), editingId: this.view.editingId === id ? null : this.view.editingId });
  }
  edit(id: string): void {
    this.set({ editingId: id });
  }
  finishEdit(save: boolean, value = ''): void {
    const id = this.view.editingId;
    this.set({ editingId: null, peers: save && id ? renamePeer(id, value) : loadPeers() });
  }

  // --- ID server ---------------------------------------------------------------------------
  pickServer(choice: ServerChoice): void {
    if (choice === this.view.server) return;
    if (choice === 'custom') {
      this.set({ server: 'custom', serverFormKey: this.view.serverFormKey + 1 });
      return; // kept only once Lưu is pressed
    }
    saveServer(choice);
    this.serverChanged(choice === 'self' ? 'Đã chuyển sang máy chủ Hà Nội.' : 'Đã chuyển sang máy chủ công cộng.');
  }
  saveCustom(host: string, key: string): void {
    saveServer('custom', host, key);
    this.serverChanged(`Đã lưu máy chủ ${loadServer()}.`);
  }
  private serverChanged(status: string): void {
    this.set({ server: serverChoice(), serverFormKey: this.view.serverFormKey + 1, online: new Map(), status });
    this.set({ account: this.accountView() });
    this.refreshOnline();
  }
  async copyConfig(): Promise<void> {
    const code = selfConfigCode();
    try {
      await navigator.clipboard.writeText(code);
      this.set({ copied: true });
    } catch {
      window.prompt('Trình duyệt không cho chép tự động. Chép mã này:', code);
    }
    if (this.copyTimer !== null) clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => this.alive && this.set({ copied: false }), 2000);
  }

  // --- RustDesk account (the public server only serves logged-in controllers) ---------------
  private accountView(): AccountView {
    const hidden = serverChoice() !== 'public';
    if (this.loginAbort) return { kind: 'waiting', hidden };
    if (!this.deps.account.token()) return { kind: 'out', hidden };
    const u = this.deps.account.user();
    return { kind: 'in', name: u?.displayName || u?.name || '', hidden };
  }
  signIn(op: Op): void {
    const win = this.deps.account.openBlank();
    const controller = new AbortController();
    this.loginAbort = controller;
    this.set({ account: this.accountView(), status: 'Đăng nhập trong cửa sổ vừa mở…' });
    this.deps.account.login(op, win, controller.signal).then(
      (user) => {
        this.loginAbort = null;
        this.set({
          account: this.accountView(),
          status: `Đã đăng nhập${user.displayName || user.name ? `: ${user.displayName || user.name}` : ''}. Bấm Enter để kết nối.`,
        });
      },
      (e: unknown) => {
        this.loginAbort = null;
        this.set({ account: this.accountView(), status: e instanceof LoginError ? e.message : `Đăng nhập không được: ${(e as Error).message}` });
      },
    );
  }
  cancelSignIn(): void {
    this.loginAbort?.abort();
  }
  signOut(): void {
    this.deps.account.logout();
    this.set({ account: this.accountView(), status: 'Đã đăng xuất.' });
  }
}
