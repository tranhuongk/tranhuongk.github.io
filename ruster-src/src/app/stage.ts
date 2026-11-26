// The remote screen while controlling: full-window canvas, an auto-hiding toolbar (fit / 100 %,
// remote cursor, Ctrl+Alt+Del, full screen, rename, disconnect), a connection chip and a banner when
// the peer stops answering.
import { CONTROL_KEY, type ClipItem, type CursorShape, type KeyInput, type PeerSummary, type VideoChunk } from '../proto/message';
import { ClipboardSync } from './clipboard';
import { AutoHide } from './hud';
import { attachInput, type Geometry } from './input';
import { canvasSize, type FitMode } from './layout';
import { FpsMeter, linkText, quality } from './stats';
import { RemoteCursor } from './remote-cursor';
import { MAX_NAME_LENGTH } from './saved-peers';
import { SoftKeyboard } from './soft-keyboard';
import { TouchPad, type TouchView } from './touch';
import { VideoPlayer } from './video';

export const STAGE_HTML = `
  <div id="screen-wrap"><canvas id="screen" tabindex="0" width="16" height="9"></canvas></div>
  <div id="vcursor" aria-hidden="true" hidden><svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 2l15 11.2-6.6.9 3.9 7.4-2.6 1.3-3.8-7.5L3 20z"/></svg><img alt=""></div>
  <div id="hud">
    <div id="bar">
      <button id="bar-title" type="button" class="title" title="Đổi tên máy này"><span id="bar-name"></span><span class="pen" aria-hidden="true">✎</span></button>
      <form id="bar-rename" hidden>
        <input id="bar-rename-input" autocomplete="off" aria-label="Tên máy">
        <button type="submit" class="primary">Lưu</button>
      </form>
      <span id="link" class="link" data-quality="unknown"><span class="dot"></span><span id="link-text"></span></span>
      <span class="spacer"></span>
      <button id="btn-kbd" type="button" aria-pressed="false" title="Mở bàn phím" hidden>Bàn phím</button>
      <button id="btn-paste" type="button" title="Dán nội dung đang copy ở máy này sang máy đích">Dán</button>
      <button id="btn-fit" type="button" title="Đổi giữa vừa khung và 100%">100%</button>
      <button id="btn-cursor" type="button" aria-pressed="true" title="Dùng hình con trỏ của máy đích">Con trỏ</button>
      <button id="btn-cad" type="button" title="Gửi Ctrl+Alt+Del">Ctrl+Alt+Del</button>
      <button id="btn-full" type="button" title="Toàn màn hình">Toàn màn hình</button>
      <button id="disconnect" type="button" class="danger">Ngắt</button>
    </div>
  </div>
  <button id="hud-grip" type="button" aria-label="Hiện thanh công cụ" hidden></button>
  <div id="lost" role="status" hidden>Mất tín hiệu từ máy đích…</div>
  <button id="clip-offer" type="button" hidden>Bấm để chép nội dung máy đích vừa copy</button>
`;

export interface StageSession {
  sendMouse(type: number, button: number, x: number, y: number): void;
  sendKey(key: KeyInput): void;
  requestKeyFrame(): void;
  setShowRemoteCursor(on: boolean): void;
  sendCtrlAltDel(platform: string): void;
  requestCursorData(id: string): void;
  sendClipboardText(text: string): void;
  close(): void;
  path: 'relay' | 'webrtc' | null;
}

export interface StageOptions {
  peer: PeerSummary;
  /** Name shown on the bar (the user's name, else the host name). */
  title: string;
  /** Saves a new name; returns the name to show (blank input clears it). */
  rename(name: string): string;
  onError(message: string): void;
  /** No data from the peer for this long shows the banner. */
  silenceMs?: number;
}

const SILENCE_MS = 5000;

export class Stage {
  private readonly canvas: HTMLCanvasElement;
  private readonly wrap: HTMLElement;
  private readonly hud: AutoHide;
  private readonly fps: FpsMeter;
  private player: VideoPlayer | null = null;
  private detachInput: (() => void) | null = null;
  private observer: ResizeObserver | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private cleanups: (() => void)[] = [];
  private geometry: Geometry;
  private mode: FitMode = 'fit';
  private delay: number | null = null;
  private fpsNow = 0;
  private lastData = Date.now();
  /** Pinch zoom on top of "fit" (1 = whole screen). */
  private zoom = 1;
  private touch: TouchPad | null = null;
  private keyboard: SoftKeyboard | null = null;
  private readonly vcursor: HTMLElement;
  private readonly vimg: HTMLImageElement;
  /** The peer's cursor shapes; `shapeOn` = draw them instead of the local cursor. */
  private readonly cursor = new RemoteCursor();
  private shapeOn = true;
  /** Hot spot of the shape on the touchpad cursor (CSS px), null while the plain arrow is shown. */
  private hot: { x: number; y: number } | null = null;
  private readonly clip: ClipboardSync;
  private pendingPaste: KeyInput | null = null;
  private pasteTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly root: HTMLElement, private readonly session: StageSession, private readonly o: StageOptions) {
    const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
    this.canvas = $<HTMLCanvasElement>('screen');
    this.wrap = $('screen-wrap');
    this.vcursor = $('vcursor');
    this.vimg = this.vcursor.querySelector('img')!;
    this.clip = new ClipboardSync({
      send: (text) => this.session.sendClipboardText(text),
      offer: (text) => {
        $('clip-offer').hidden = text === null;
      },
    });
    this.geometry = { width: o.peer.width, height: o.peer.height, originX: o.peer.originX, originY: o.peer.originY };
    this.fps = new FpsMeter((n) => {
      this.fpsNow = n;
      this.renderLink();
    });
    this.hud = new AutoHide($('hud'), $('hud-grip'));
  }

  /** False when this browser cannot decode video (no WebCodecs) or draw (no 2D canvas). */
  start(): boolean {
    const ctx = this.canvas.getContext('2d');
    if (!VideoPlayer.isSupported() || !ctx) return false;
    const $ = <T extends HTMLElement>(id: string) => this.root.querySelector<T>(`#${id}`)!;

    this.player = new VideoPlayer(
      {
        resize: (w, h) => {
          this.canvas.width = w;
          this.canvas.height = h;
          this.geometry = { ...this.geometry, width: w, height: h };
          this.layout();
        },
        draw: (frame) => {
          ctx.drawImage(frame, 0, 0);
          this.fps.tick();
        },
      },
      () => this.session.requestKeyFrame(),
      (m) => this.o.onError(m),
    );
    this.detachInput = attachInput(this.canvas, this.session, () => this.geometry, (x, y) => this.touch?.mouseAt(x, y), (k) => this.pasteChord(k));
    this.wireClipboard();
    this.wireTouch();
    this.fps.start();
    this.layout();
    this.renderLink();
    $('bar-name').textContent = this.o.title;

    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => this.layout());
      this.observer.observe(this.wrap);
    }
    this.watchdog = setInterval(() => {
      $('lost').hidden = Date.now() - this.lastData < (this.o.silenceMs ?? SILENCE_MS);
    }, 1000);
    this.wireToolbar();
    this.canvas.focus();
    return true;
  }

  private on(target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions): void {
    target.addEventListener(type, handler, options);
    this.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  /** Touch drives a touchpad cursor (touch.ts); the whole stage is the pad, not only the picture. */
  private wireTouch(): void {
    const view: TouchView = {
      rect: () => this.canvas.getBoundingClientRect(),
      zoomBy: (factor, x, y) => this.zoomBy(factor, x, y),
      reveal: (x, y) => this.reveal(x, y),
      drawCursor: (at, pressed) => {
        this.vcursor.hidden = at === null;
        const dx = this.hot?.x ?? 0;
        const dy = this.hot?.y ?? 0;
        if (at) this.vcursor.style.transform = `translate(${Math.round(at.x - dx)}px, ${Math.round(at.y - dy)}px)`;
        this.vcursor.classList.toggle('pressed', pressed);
      },
      toggleKeyboard: () => this.keyboard?.toggle(),
      buzz: () => navigator.vibrate?.(15),
    };
    const pad = new TouchPad(this.session, () => this.geometry, view);
    this.touch = pad;
    const touchOnly = (h: (e: PointerEvent) => void) => (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType !== 'touch') return;
      e.preventDefault();
      h(pe);
    };
    this.on(this.wrap, 'pointerdown', touchOnly((e) => {
      try {
        this.wrap.setPointerCapture?.(e.pointerId);
      } catch {
        // the pointer is already gone; the touch still counts
      }
      pad.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
    }));
    this.on(this.wrap, 'pointermove', touchOnly((e) => pad.move(e.pointerId, e.clientX, e.clientY, e.timeStamp)));
    this.on(this.wrap, 'pointerup', touchOnly((e) => pad.up(e.pointerId, e.timeStamp)));
    this.on(this.wrap, 'pointercancel', touchOnly((e) => pad.up(e.pointerId, e.timeStamp, true)));
    this.on(this.wrap, 'scroll', () => pad.redraw());

    const kbdButton = this.root.querySelector<HTMLButtonElement>('#btn-kbd')!;
    this.keyboard = new SoftKeyboard(this.root, (k) => this.session.sendKey(k), (open) => kbdButton.setAttribute('aria-pressed', String(open)));
    const touchScreen = (navigator.maxTouchPoints ?? 0) > 0 || Boolean(window.matchMedia?.('(pointer: coarse)').matches);
    kbdButton.hidden = !touchScreen;
    // Keep the field focused through the tap, so the button closes an open keyboard instead of reopening it.
    this.on(kbdButton, 'pointerdown', (e) => e.preventDefault());
    this.on(kbdButton, 'click', () => this.keyboard?.toggle());
  }

  private zoomBy(factor: number, clientX: number, clientY: number): void {
    const before = this.canvas.getBoundingClientRect();
    const zoom = Math.min(Math.max(this.zoom * factor, 1), 6);
    if (zoom === this.zoom && this.mode === 'fit') return;
    const fx = before.width > 0 ? (clientX - before.left) / before.width : 0.5;
    const fy = before.height > 0 ? (clientY - before.top) / before.height : 0.5;
    this.mode = 'fit';
    this.zoom = zoom;
    this.root.querySelector('#btn-fit')!.textContent = zoom > 1 ? 'Vừa khung' : '100%';
    this.layout();
    // Keep the point under the fingers where it was.
    const after = this.canvas.getBoundingClientRect();
    this.wrap.scrollLeft += after.left + fx * after.width - clientX;
    this.wrap.scrollTop += after.top + fy * after.height - clientY;
  }

  /** Scrolls the zoomed picture so a client point stays clear of the edges. */
  private reveal(clientX: number, clientY: number): void {
    const box = this.wrap.getBoundingClientRect();
    const m = Math.min(48, box.width / 4, box.height / 4);
    if (clientX < box.left + m) this.wrap.scrollLeft -= box.left + m - clientX;
    else if (clientX > box.right - m) this.wrap.scrollLeft += clientX - (box.right - m);
    if (clientY < box.top + m) this.wrap.scrollTop -= box.top + m - clientY;
    else if (clientY > box.bottom - m) this.wrap.scrollTop += clientY - (box.bottom - m);
  }

  private wireToolbar(): void {
    const $ = <T extends HTMLElement>(id: string) => this.root.querySelector<T>(`#${id}`)!;
    const fit = $<HTMLButtonElement>('btn-fit');
    const cursor = $<HTMLButtonElement>('btn-cursor');
    const full = $<HTMLButtonElement>('btn-full');
    const title = $<HTMLButtonElement>('bar-title');
    const renameForm = $<HTMLFormElement>('bar-rename');
    const renameInput = $<HTMLInputElement>('bar-rename-input');
    renameInput.maxLength = MAX_NAME_LENGTH;

    this.on(fit, 'click', () => {
      // Zoomed in by pinch → back to the whole screen; otherwise switch fit ↔ 100 %.
      if (this.mode === 'fit' && this.zoom > 1) this.zoom = 1;
      else this.mode = this.mode === 'fit' ? 'actual' : 'fit';
      this.zoom = 1;
      fit.textContent = this.mode === 'fit' ? '100%' : 'Vừa khung';
      this.layout();
      this.canvas.focus();
    });
    this.on(cursor, 'click', () => {
      this.shapeOn = !this.shapeOn;
      cursor.setAttribute('aria-pressed', String(this.shapeOn));
      this.applyCursor();
      this.canvas.focus();
    });
    this.on($('btn-cad'), 'click', () => {
      this.session.sendCtrlAltDel(this.o.peer.platform);
      this.canvas.focus();
    });
    if (!document.fullscreenEnabled) full.hidden = true;
    this.on(full, 'click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void this.root.requestFullscreen?.();
    });
    this.on(document, 'fullscreenchange', () => {
      const on = Boolean(document.fullscreenElement);
      full.textContent = on ? 'Thu nhỏ' : 'Toàn màn hình';
      // In full screen Esc would leave it; keep Esc for the remote machine where the browser allows.
      const keyboard = (navigator as Navigator & { keyboard?: { lock?: (keys: string[]) => Promise<void>; unlock?: () => void } }).keyboard;
      if (on) void keyboard?.lock?.(['Escape']).catch(() => {});
      else keyboard?.unlock?.();
      this.layout();
    });
    this.on($('disconnect'), 'click', () => this.session.close());

    // Toolbar visibility: top edge, touch on the grip, anything focused or being edited inside it.
    this.on(this.root, 'pointermove', (e) => this.hud.pointerAt((e as PointerEvent).clientY), { capture: true });
    this.on($('hud-grip'), 'click', () => this.hud.show());
    this.on($('hud'), 'focusin', () => this.hud.pin(true));
    this.on($('hud'), 'focusout', () => this.hud.pin(false));

    // Rename in place.
    const openRename = (open: boolean) => {
      title.hidden = open;
      renameForm.hidden = !open;
      if (open) {
        renameInput.value = $('bar-name').textContent === this.o.peer.hostname ? '' : ($('bar-name').textContent ?? '');
        renameInput.focus();
        renameInput.select();
      } else this.canvas.focus();
    };
    this.on(title, 'click', () => openRename(true));
    this.on(renameForm, 'submit', (e) => {
      e.preventDefault();
      $('bar-name').textContent = this.o.rename(renameInput.value);
      openRename(false);
    });
    this.on(renameInput, 'keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') {
        e.preventDefault();
        openRename(false);
      }
    });
  }

  private layout(): void {
    const box = this.wrap.getBoundingClientRect();
    const size = canvasSize(this.mode, this.canvas.width, this.canvas.height, box.width, box.height, window.devicePixelRatio || 1);
    const z = this.mode === 'fit' ? this.zoom : 1;
    this.canvas.style.width = `${Math.round(size.width * z)}px`;
    this.canvas.style.height = `${Math.round(size.height * z)}px`;
    this.applyCursor();
  }

  // --- remote cursor -----------------------------------------------------------------------

  cursorEvent(e: { shape: CursorShape } | { id: string } | { x: number; y: number }): void {
    if ('shape' in e) {
      if (this.cursor.add(e.shape)) this.applyCursor();
    } else if ('id' in e) {
      if (this.cursor.use(e.id)) this.applyCursor();
      else if (this.cursor.shouldAsk(e.id)) this.session.requestCursorData(e.id);
    } else this.touch?.remoteMoved(e.x, e.y);
  }

  /** Puts the peer's current shape on the picture (mouse) and on the touchpad cursor. */
  private applyCursor(): void {
    const scale = this.canvas.getBoundingClientRect().width / Math.max(this.canvas.width, 1);
    const r = this.shapeOn ? this.cursor.rendered(scale, window.devicePixelRatio || 1) : null;
    const style = this.canvas.style;
    if (this.shapeOn && this.cursor.hidden()) style.cursor = 'none';
    else if (r) {
      // Plain url first; the sharper image-set replaces it where the browser accepts it.
      for (const v of [...r.css].reverse()) style.cursor = v;
    } else style.cursor = '';
    if (r) {
      this.vimg.src = r.url;
      this.vimg.style.width = `${r.width}px`;
      this.vimg.style.height = `${r.height}px`;
      this.hot = { x: r.hotx, y: r.hoty };
    } else this.hot = null;
    // While the peer hides its cursor the touchpad keeps the plain arrow: a finger needs to see it.
    this.vcursor.classList.toggle('img', r !== null);
    this.touch?.redraw();
  }

  // --- clipboard ---------------------------------------------------------------------------

  remoteClipboard(items: ClipItem[]): void {
    void this.clip.fromRemote(items);
  }

  /** The keys that paste on the peer: ⌘V on a Mac, Ctrl+V elsewhere. */
  private pasteKey(): KeyInput {
    return { chr: 0x76, modifiers: [/mac/i.test(this.o.peer.platform) ? CONTROL_KEY.Meta : CONTROL_KEY.Control] };
  }

  /** Ctrl/⌘+V held back until the browser's `paste` hands over the text (or a moment passes). */
  private pasteChord(k: KeyInput): void {
    this.pendingPaste = k;
    if (this.pasteTimer !== null) clearTimeout(this.pasteTimer);
    this.pasteTimer = setTimeout(() => this.flushPaste(), 150);
  }

  private flushPaste(): void {
    if (this.pasteTimer !== null) clearTimeout(this.pasteTimer);
    this.pasteTimer = null;
    const k = this.pendingPaste;
    this.pendingPaste = null;
    if (k) this.session.sendKey(k);
  }

  private wireClipboard(): void {
    const $ = <T extends HTMLElement>(id: string) => this.root.querySelector<T>(`#${id}`)!;
    this.on(document, 'paste', (ev) => {
      const e = ev as ClipboardEvent;
      // A paste meant for the picture (keys or the browser menu); the phone keyboard field types its own.
      if (!this.pendingPaste && document.activeElement !== this.canvas) return;
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text) this.clip.toRemote(text, true);
      this.pendingPaste ??= this.pasteKey();
      if (this.pasteTimer !== null) clearTimeout(this.pasteTimer);
      // A beat for the peer to set its clipboard before the keys arrive.
      this.pasteTimer = setTimeout(() => this.flushPaste(), text ? 60 : 0);
    });
    this.on(window, 'focus', () => {
      void this.clip.retry();
      void this.clip.pullLocal(false);
    });
    const offer = $<HTMLButtonElement>('clip-offer');
    this.on(offer, 'click', () => {
      void this.clip.retry();
      this.canvas.focus();
    });
    const paste = $<HTMLButtonElement>('btn-paste');
    this.on(paste, 'click', async () => {
      const sent = await this.clip.pullLocal(true);
      if (sent) {
        setTimeout(() => this.session.sendKey(this.pasteKey()), 60);
      } else {
        paste.textContent = 'Chưa đọc được clipboard';
        setTimeout(() => (paste.textContent = 'Dán'), 2000);
      }
      if (!this.keyboard?.isOpen()) this.canvas.focus();
    });
    void this.clip.pullLocal(false);
  }

  private renderLink(): void {
    const link = this.root.querySelector<HTMLElement>('#link')!;
    link.dataset.quality = quality(this.delay);
    this.root.querySelector('#link-text')!.textContent = linkText(this.session.path, this.delay, this.fpsNow);
  }

  feed(frames: VideoChunk[]): void {
    this.lastData = Date.now();
    this.player?.feed(frames);
  }

  setDelay(ms: number): void {
    this.lastData = Date.now();
    this.delay = ms;
    this.renderLink();
  }

  destroy(): void {
    this.detachInput?.();
    this.detachInput = null;
    this.touch?.destroy();
    this.touch = null;
    this.keyboard?.destroy();
    this.keyboard = null;
    this.vcursor.hidden = true;
    this.vcursor.classList.remove('img');
    this.canvas.style.cursor = '';
    if (this.pasteTimer !== null) clearTimeout(this.pasteTimer);
    this.root.querySelector<HTMLElement>('#clip-offer')!.hidden = true;
    this.player?.close();
    this.player = null;
    this.observer?.disconnect();
    this.fps.stop();
    this.hud.destroy();
    if (this.watchdog !== null) clearInterval(this.watchdog);
    for (const c of this.cleanups.splice(0)) c();
    if (document.fullscreenElement) void document.exitFullscreen();
    this.root.querySelector<HTMLElement>('#lost')!.hidden = true;
  }
}
