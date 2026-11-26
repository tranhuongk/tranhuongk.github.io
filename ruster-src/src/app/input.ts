// Browser mouse and keyboard events → RustDesk input messages.
import { BUTTON, CONTROL_KEY, MOUSE, type KeyInput } from '../proto/message';
import { wheelPixels } from './scroll';

export interface InputTarget {
  /** `modifiers`: keys held with the mouse (Shift+click, Ctrl+click…). */
  sendMouse(type: number, button: number, x: number, y: number, modifiers?: number[]): void;
  sendKey(key: KeyInput): void;
  /** Scrolls by a distance in local pixels, wheel-event sense (positive = right / down). */
  scroll(dx: number, dy: number): void;
}

export interface Geometry {
  /** Remote display size in pixels. */
  width: number;
  height: number;
  /** Top-left of that display on the remote desktop. */
  originX: number;
  originY: number;
}

/** Canvas client coordinates → absolute remote coordinates, clamped to the display. */
export function toRemote(
  clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, g: Geometry,
): { x: number; y: number } {
  const fx = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  const fy = rect.height > 0 ? (clientY - rect.top) / rect.height : 0;
  const clamp = (v: number, max: number) => Math.min(Math.max(Math.round(v * max), 0), Math.max(max - 1, 0));
  return { x: g.originX + clamp(fx, g.width), y: g.originY + clamp(fy, g.height) };
}

const BUTTON_OF: Record<number, number> = { 0: BUTTON.left, 1: BUTTON.middle, 2: BUTTON.right, 3: BUTTON.back, 4: BUTTON.forward };

const CONTROL_OF_CODE: Record<string, number> = {
  Enter: CONTROL_KEY.Return, NumpadEnter: CONTROL_KEY.Return, Backspace: CONTROL_KEY.Backspace, Tab: CONTROL_KEY.Tab,
  Escape: CONTROL_KEY.Escape, Delete: CONTROL_KEY.Delete, Insert: CONTROL_KEY.Insert, Home: CONTROL_KEY.Home,
  End: CONTROL_KEY.End, PageUp: CONTROL_KEY.PageUp, PageDown: CONTROL_KEY.PageDown, ArrowUp: CONTROL_KEY.UpArrow,
  ArrowDown: CONTROL_KEY.DownArrow, ArrowLeft: CONTROL_KEY.LeftArrow, ArrowRight: CONTROL_KEY.RightArrow,
  CapsLock: CONTROL_KEY.CapsLock, F1: CONTROL_KEY.F1, F2: CONTROL_KEY.F2, F3: CONTROL_KEY.F3, F4: CONTROL_KEY.F4,
  F5: CONTROL_KEY.F5, F6: CONTROL_KEY.F6, F7: CONTROL_KEY.F7, F8: CONTROL_KEY.F8, F9: CONTROL_KEY.F9,
  F10: CONTROL_KEY.F10, F11: CONTROL_KEY.F11, F12: CONTROL_KEY.F12,
};

const MODIFIER_CODES = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

/** The modifier keys held during a mouse event, as ControlKey values (undefined when none). */
export function heldModifiers(e: Pick<MouseEvent, 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>): number[] | undefined {
  const m: number[] = [];
  if (e.ctrlKey) m.push(CONTROL_KEY.Control);
  if (e.altKey) m.push(CONTROL_KEY.Alt);
  if (e.metaKey) m.push(CONTROL_KEY.Meta);
  if (e.shiftKey) m.push(CONTROL_KEY.Shift);
  return m.length ? m : undefined;
}

/** The KeyInput for one keydown, or null for keys that need no message (bare modifiers, IME). */
export function keyInputFor(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'isComposing'>): KeyInput | null {
  if (e.isComposing || e.key === 'Process' || e.key === 'Dead') return null;
  if (MODIFIER_CODES.has(e.code)) return null;
  const modifiers: number[] = [];
  if (e.ctrlKey) modifiers.push(CONTROL_KEY.Control);
  if (e.altKey) modifiers.push(CONTROL_KEY.Alt);
  if (e.metaKey) modifiers.push(CONTROL_KEY.Meta);
  if (e.shiftKey) modifiers.push(CONTROL_KEY.Shift);
  const control = CONTROL_OF_CODE[e.code];
  if (control !== undefined) return { controlKey: control, modifiers: modifiers.length ? modifiers : undefined };
  if (e.key === ' ') return modifiers.length ? { controlKey: CONTROL_KEY.Space, modifiers } : { text: ' ' };
  if (e.key.length === 1) {
    // A chord (Ctrl+C, Alt+Tab…) goes as a key with modifiers; plain or shifted text as typed text.
    if (e.ctrlKey || e.altKey || e.metaKey) return { chr: e.key.toLowerCase().charCodeAt(0), modifiers };
    return { text: e.key };
  }
  return null;
}

/** This browser runs on an Apple machine (its shortcuts use ⌘ where others use Ctrl). */
export function localIsApple(nav: Pick<Navigator, 'platform' | 'userAgent'> = navigator): boolean {
  return /mac|iphone|ipad/i.test(nav.platform || nav.userAgent);
}

/** ⌘ ↔ Ctrl in a key's modifiers: a Mac driving Windows/Linux keeps its own shortcuts (⌘C → Ctrl+C). */
export function swapCommandControl(k: KeyInput): KeyInput {
  if (!k.modifiers?.length) return k;
  const swap = (m: number) => (m === CONTROL_KEY.Meta ? CONTROL_KEY.Control : m === CONTROL_KEY.Control ? CONTROL_KEY.Meta : m);
  return { ...k, modifiers: k.modifiers.map(swap) };
}

/** Ctrl+V / ⌘+V (no Alt): a paste the local clipboard should follow. */
export function isPasteChord(k: KeyInput): boolean {
  const mods = k.modifiers ?? [];
  return k.chr === 0x76 && (mods.includes(CONTROL_KEY.Control) || mods.includes(CONTROL_KEY.Meta)) && !mods.includes(CONTROL_KEY.Alt);
}

/**
 * Wires mouse/pen and keyboard events on `canvas` to `target`; returns the cleanup. Touch is left to
 * the touchpad (touch.ts); `onMouse` hears where a real mouse put the cursor.
 */
export function attachInput(
  canvas: HTMLCanvasElement, target: InputTarget, geometry: () => Geometry, onMouse?: (x: number, y: number) => void,
  onPasteChord?: (k: KeyInput) => void,
): () => void {
  const point = (e: MouseEvent) => toRemote(e.clientX, e.clientY, canvas.getBoundingClientRect(), geometry());
  const move = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const p = point(e);
    onMouse?.(p.x, p.y);
    target.sendMouse(MOUSE.move, 0, p.x, p.y);
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    canvas.focus();
    canvas.setPointerCapture?.(e.pointerId);
    const p = point(e);
    target.sendMouse(MOUSE.down, BUTTON_OF[e.button] ?? BUTTON.left, p.x, p.y, heldModifiers(e));
    e.preventDefault();
  };
  const up = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const p = point(e);
    target.sendMouse(MOUSE.up, BUTTON_OF[e.button] ?? BUTTON.left, p.x, p.y, heldModifiers(e));
    e.preventDefault();
  };
  const wheel = (e: WheelEvent) => {
    // The distance this machine would scroll, so its scroll speed setting carries over.
    const d = wheelPixels(e, canvas.clientHeight || window.innerHeight);
    target.scroll(d.x, d.y);
    e.preventDefault();
  };
  const keydown = (e: KeyboardEvent) => {
    const k = keyInputFor(e);
    if (!k) return;
    if (onPasteChord && isPasteChord(k)) {
      // Let the browser fire `paste` so the text can reach the peer before the keys do.
      onPasteChord(k);
      return;
    }
    target.sendKey(k);
    e.preventDefault();
  };
  const noMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('keydown', keydown);
  canvas.addEventListener('contextmenu', noMenu);
  return () => {
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('keydown', keydown);
    canvas.removeEventListener('contextmenu', noMenu);
  };
}
