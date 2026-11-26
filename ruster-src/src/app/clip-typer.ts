// Typing that the remote input method cannot touch: each burst of text is put on the remote
// clipboard and pasted, because a paste never goes through Telex/VNI/Unikey. Whatever input mode the
// remote machine is in, what was typed here appears there. Keys (Backspace, Enter, shortcuts) still go
// as keys, in order with the pastes; when typing stops the remote clipboard gets its old text back.
import type { KeyInput } from '../proto/message';

export interface ClipTyperOut {
  /** Puts text on the remote clipboard. */
  clip(text: string): void;
  key(k: KeyInput): void;
  /** The paste shortcut of the remote platform (⌘V / Ctrl+V). */
  pasteKey(): KeyInput;
  /** Called once typing has been idle a while: give the remote clipboard its old content back. */
  restore(): void;
}

type Item = { text: string } | { key: KeyInput };

/** Clipboard set → paste: the peer sets it on another thread, so the keys wait for it. */
export const CLIP_SETTLE_MS = 60;
/** Paste → next clipboard: the app reads the clipboard when it handles the paste. */
export const PASTE_SETTLE_MS = 90;
export const RESTORE_AFTER_MS = 1500;

export class ClipTyper {
  private readonly queue: Item[] = [];
  private running = false;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private closed = false;

  constructor(private readonly out: ClipTyperOut, private readonly wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {}

  /** A key from the keyboard code: text is pasted, everything else is sent as a key, in order. */
  push(k: KeyInput): void {
    if (this.closed) return;
    if (k.text !== undefined && k.controlKey === undefined && !k.modifiers?.length) this.queue.push({ text: k.text });
    else this.queue.push({ key: k });
    void this.run();
  }

  /** Text to paste as it is (the local clipboard, on Ctrl/⌘+V). */
  pasteText(text: string): void {
    if (this.closed || !text) return;
    this.queue.push({ text });
    void this.run();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (this.restoreTimer !== null) clearTimeout(this.restoreTimer);
    this.restoreTimer = null;
    try {
      while (this.queue.length && !this.closed) {
        const item = this.queue.shift()!;
        if ('key' in item) {
          this.out.key(item.key);
          continue;
        }
        // Text typed while the last paste settled goes out as one paste.
        let text = item.text;
        while (this.queue[0] && 'text' in this.queue[0]) text += (this.queue.shift() as { text: string }).text;
        this.out.clip(text);
        this.dirty = true;
        await this.wait(CLIP_SETTLE_MS);
        if (this.closed) return;
        this.out.key(this.out.pasteKey());
        await this.wait(PASTE_SETTLE_MS);
      }
    } finally {
      this.running = false;
    }
    if (this.dirty && !this.closed) {
      this.restoreTimer = setTimeout(() => {
        this.restoreTimer = null;
        if (this.running || this.queue.length) return;
        this.dirty = false;
        this.out.restore();
      }, RESTORE_AFTER_MS);
    }
  }

  /** Idle and nothing waiting (tests, and switching modes). */
  idle(): boolean {
    return !this.running && this.queue.length === 0;
  }

  destroy(): void {
    this.closed = true;
    this.queue.length = 0;
    if (this.restoreTimer !== null) clearTimeout(this.restoreTimer);
    if (this.dirty) this.out.restore();
    this.dirty = false;
  }
}
