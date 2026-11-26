// Text clipboard kept in step between this browser and the remote machine.
//   remote → here   the peer sends its clipboard when it changes; we write it to the local clipboard,
//                   or, where the browser wants a click first (Safari, iOS), offer a button.
//   here → remote   Ctrl/⌘+V on the picture sends the pasted text before the keys; the "Dán" button
//                   does the same from a tap; on focus Chrome's granted clipboard is read and sent.
import { decompress } from 'fzstd';
import { CLIP_FORMAT, type ClipItem } from '../proto/message';

const DECODER = new TextDecoder('utf-8', { fatal: false });

/** The text of a peer clipboard message, or null when it holds no text. */
export function clipText(items: ClipItem[]): string | null {
  const item = items.find((i) => i.format === CLIP_FORMAT.text);
  if (!item) return null;
  try {
    const bytes = item.compress ? decompress(item.content) : item.content;
    return DECODER.decode(bytes);
  } catch {
    return null;
  }
}

export interface ClipboardHost {
  /** Puts text on the remote clipboard. */
  send(text: string): void;
  /** The local clipboard could not be written without a click: show `text` behind a button (null hides it). */
  offer(text: string | null): void;
}

interface ClipboardApi {
  writeText?(text: string): Promise<void>;
  readText?(): Promise<string>;
}

export class ClipboardSync {
  /** Last text both sides are known to hold, so neither echo goes back. */
  private last: string | null = null;
  private pending: string | null = null;
  /** Texts we put on the remote clipboard only to type them: their echo is not a copy. */
  private readonly echoes = new Set<string>();

  constructor(private readonly host: ClipboardHost, private readonly api: () => ClipboardApi | undefined = () => navigator.clipboard) {}

  async fromRemote(items: ClipItem[]): Promise<void> {
    const text = clipText(items);
    if (text === null || text === this.last || this.echoes.delete(text)) return;
    this.last = text;
    await this.write(text);
  }

  /** Writes the text still waiting (after a click, or once the page has focus again). */
  async retry(): Promise<boolean> {
    return this.pending === null ? true : this.write(this.pending);
  }

  private async write(text: string): Promise<boolean> {
    try {
      await this.api()?.writeText?.(text);
      if (!this.api()?.writeText) throw new Error('no clipboard');
      this.pending = null;
      this.host.offer(null);
      return true;
    } catch {
      this.pending = text;
      this.host.offer(text);
      return false;
    }
  }

  /** The text both clipboards hold, as far as we know (null: not known yet). */
  known(): string | null {
    return this.last;
  }

  /** Records that the remote clipboard now holds `text` (sent by another path). */
  setKnown(text: string): void {
    this.last = text;
  }

  /** The peer may send `text` back after we set it to type it: ignore that once. */
  ignoreEcho(text: string): void {
    this.echoes.add(text);
    if (this.echoes.size > 50) this.echoes.delete(this.echoes.values().next().value as string);
  }

  /** Sends local text to the peer; false when it already has it (`force` sends anyway: an explicit paste). */
  toRemote(text: string, force = false): boolean {
    if (!text || (!force && text === this.last)) return false;
    this.last = text;
    this.host.send(text);
    return true;
  }

  /** The local clipboard's text after a user gesture ('' when empty or refused). */
  async readLocal(): Promise<string> {
    try {
      return (await this.api()?.readText?.()) ?? '';
    } catch {
      return '';
    }
  }

  /**
   * Reads the local clipboard and sends it. Without a user gesture only when the browser already
   * granted clipboard reading, so no permission prompt pops up on its own.
   */
  async pullLocal(gesture: boolean): Promise<boolean> {
    const api = this.api();
    if (!api?.readText) return false;
    if (!gesture) {
      try {
        const st = await navigator.permissions?.query({ name: 'clipboard-read' as PermissionName });
        if (st?.state !== 'granted') return false;
      } catch {
        return false;
      }
    }
    try {
      return this.toRemote(await api.readText(), gesture);
    } catch {
      return false;
    }
  }
}
