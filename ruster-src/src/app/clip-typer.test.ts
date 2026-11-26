import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CLIP_SETTLE_MS, ClipTyper, PASTE_SETTLE_MS, RESTORE_AFTER_MS } from './clip-typer';

describe('ClipTyper', () => {
  let log: string[];
  let typer: ClipTyper;
  beforeEach(() => {
    vi.useFakeTimers();
    log = [];
    typer = new ClipTyper({
      clip: (t) => log.push(`clip:${t}`),
      key: (k) => log.push(`key:${k.controlKey ?? String.fromCharCode(k.chr ?? 63)}`),
      pasteKey: () => ({ chr: 0x76, modifiers: [23] }),
      restore: () => log.push('restore'),
    });
  });
  afterEach(() => vi.useRealTimers());

  test('the first letter goes at once; letters typed while it settles go out as one paste', async () => {
    typer.push({ text: 'x' });
    typer.push({ text: 'i' });
    typer.push({ text: 'n' });
    await vi.advanceTimersByTimeAsync(2 * (CLIP_SETTLE_MS + PASTE_SETTLE_MS));
    expect(log).toEqual(['clip:x', 'key:v', 'clip:in', 'key:v']);
  });

  test('keys wait for the paste before them', async () => {
    typer.push({ text: 'a' });
    typer.push({ controlKey: 2 });
    typer.push({ text: 'á' });
    expect(log).toEqual(['clip:a']);
    await vi.advanceTimersByTimeAsync(CLIP_SETTLE_MS);
    expect(log).toEqual(['clip:a', 'key:v']);
    await vi.advanceTimersByTimeAsync(PASTE_SETTLE_MS);
    expect(log).toEqual(['clip:a', 'key:v', 'key:2', 'clip:á']);
  });

  test('the clipboard is restored once, after typing stops', async () => {
    typer.push({ text: 'a' });
    await vi.advanceTimersByTimeAsync(CLIP_SETTLE_MS + PASTE_SETTLE_MS + RESTORE_AFTER_MS - 10);
    typer.push({ text: 'b' });
    await vi.advanceTimersByTimeAsync(CLIP_SETTLE_MS + PASTE_SETTLE_MS + RESTORE_AFTER_MS + 10);
    expect(log.filter((x) => x === 'restore')).toHaveLength(1);
    expect(log.at(-1)).toBe('restore');
  });

  test('shortcuts and keys alone never touch the clipboard', async () => {
    typer.push({ chr: 0x63, modifiers: [23] });
    typer.push({ controlKey: 27 });
    await vi.advanceTimersByTimeAsync(RESTORE_AFTER_MS * 2);
    expect(log).toEqual(['key:c', 'key:27']);
  });
});
