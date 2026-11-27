// Typing goes through a hidden text field, so the local input method works: the phone's on-screen
// keyboard, and Vietnamese Telex/VNI on a computer (macOS Telex, Unikey, EVKey) — none of which can
// type into a canvas. Mobile keyboards rarely send usable keydown events (Android reports
// "Unidentified") and IMEs rewrite what was typed, so the field's value is diffed instead: removed
// characters become Backspace, added ones are typed as text, as each change happens (Telex turning
// "a" into "â" sends Backspace + "â"). Enter, arrows and shortcuts still go as keys.
import { CONTROL_KEY, type KeyInput } from '../proto/message';
import { isPasteChord, keyInputFor } from './input';

/** Kept in the field so Backspace on an "empty" field still has something to delete. */
const SENTINEL = '​​';

/** What turning `before` into `after` types on the remote: backspaces, then text. */
export function diffTyping(before: string, after: string): { backspaces: number; text: string } {
  let i = 0;
  while (i < before.length && i < after.length && before[i] === after[i]) i++;
  return { backspaces: [...before.slice(i)].length, text: after.slice(i) };
}

export class SoftKeyboard {
  readonly field: HTMLInputElement;
  private last = SENTINEL;
  private composing = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    host: HTMLElement,
    private readonly send: (k: KeyInput) => void,
    private readonly onOpenChange: (open: boolean) => void,
    /** Ctrl/⌘+V: left to the browser's `paste` (the stage sends the text before the keys). */
    private readonly onPasteChord?: (k: KeyInput) => void,
    /** ?debug: one line per field event and what it sent. */
    private readonly log?: (line: string) => void,
  ) {
    const f = document.createElement('input');
    f.id = 'soft-kbd';
    f.type = 'text';
    f.autocomplete = 'off';
    f.setAttribute('autocapitalize', 'off');
    f.setAttribute('autocorrect', 'off');
    f.spellcheck = false;
    f.setAttribute('enterkeyhint', 'enter');
    f.setAttribute('aria-label', 'Bàn phím');
    f.value = SENTINEL;
    host.append(f);
    this.field = f;
    const on = <K extends keyof HTMLElementEventMap>(type: K, h: (e: HTMLElementEventMap[K]) => void) => {
      f.addEventListener(type, h);
      this.cleanups.push(() => f.removeEventListener(type, h));
    };
    on('compositionstart', () => {
      this.log?.('compositionstart');
      this.composing = true;
    });
    on('compositionend', () => {
      this.log?.('compositionend');
      this.composing = false;
      this.flush();
    });
    // Every change is typed at once, mid-composition too, so the remote shows letters as they come.
    on('input', () => this.flush());
    on('keydown', (e) => {
      this.log?.(`kd ${e.key} ${e.keyCode}${e.isComposing ? ' comp' : ''}`);
      if (e.isComposing || e.key === 'Unidentified' || e.keyCode === 229) return;
      const k = keyInputFor(e);
      // Printable characters arrive through `input`; only control keys and chords are sent here.
      if (!k || ('text' in k && k.text !== undefined)) return;
      if (this.onPasteChord && isPasteChord(k)) {
        this.onPasteChord(k);
        return;
      }
      this.send(k);
      e.preventDefault();
    });
    on('focus', () => this.onOpenChange(true));
    on('blur', () => this.onOpenChange(false));
  }

  isOpen(): boolean {
    return document.activeElement === this.field;
  }

  open(): void {
    this.reset();
    // No page scroll: the stage follows the visible area itself.
    this.field.focus({ preventScroll: true });
    this.onOpenChange(true);
  }

  close(): void {
    this.field.blur();
    this.onOpenChange(false);
  }

  /** Takes the keyboard focus (a computer's keys) without resetting what an IME is composing. */
  focus(): void {
    if (this.isOpen()) return;
    this.reset();
    this.field.focus({ preventScroll: true });
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  private flush(): void {
    const now = this.field.value;
    const { backspaces, text } = diffTyping(this.last, now);
    this.log?.(`in${this.composing ? '(c)' : ''} "${now.replace(/\u200b/g, '')}" → ${'⌫'.repeat(backspaces)}${text ? `+"${text}"` : ''}`);
    for (let i = 0; i < backspaces; i++) this.send({ controlKey: CONTROL_KEY.Backspace });
    for (const part of text.split('\n')) {
      if (part) this.send({ text: part });
    }
    if (text.includes('\n')) this.send({ controlKey: CONTROL_KEY.Return });
    this.last = now;
    // Start over once the field drifts, so the diff stays short and Backspace always has a sentinel —
    // never mid-composition, which would break the word the IME is building.
    if (!this.composing && (!now.startsWith(SENTINEL) || now.length > 64)) this.reset();
  }

  private reset(): void {
    this.field.value = SENTINEL;
    this.last = SENTINEL;
    try {
      this.field.setSelectionRange(SENTINEL.length, SENTINEL.length);
    } catch {
      // not focusable yet
    }
  }

  destroy(): void {
    for (const c of this.cleanups.splice(0)) c();
    this.field.remove();
  }
}
