import { describe, expect, test, vi } from 'vitest';
import { CLIP_FORMAT, decodeMessage, encodeClipboardText, FIELD } from '../proto/message';
import { lengthDelimited, varintField } from '../proto/wire';
import { clipText, ClipboardSync } from './clipboard';
import { zstdRaw } from './zstd-fixture';

const utf8 = (s: string) => new TextEncoder().encode(s);

describe('clipboard messages', () => {
  test('MultiClipboards from the peer: the text entry, compressed or not', () => {
    const clip = (compress: boolean, content: Uint8Array, format: number) =>
      lengthDelimited(1, [...varintField(1, compress ? 1 : 0), ...lengthDelimited(2, content), ...varintField(5, format)]);
    const msg = new Uint8Array(lengthDelimited(FIELD.multiClipboards, [
      ...clip(false, utf8('<b>x</b>'), CLIP_FORMAT.html),
      ...clip(true, zstdRaw(utf8('Xin chào 👋')), CLIP_FORMAT.text),
    ]));
    const m = decodeMessage(msg);
    expect(m.kind).toBe('clipboard');
    if (m.kind === 'clipboard') expect(clipText(m.items)).toBe('Xin chào 👋');
  });

  test('our Clipboard message decodes back to the same text', () => {
    const m = decodeMessage(encodeClipboardText('dán thử'));
    expect(m.kind === 'clipboard' && clipText(m.items)).toBe('dán thử');
  });

  test('no text entry → null', () => {
    expect(clipText([{ format: CLIP_FORMAT.imagePng, compress: false, content: new Uint8Array([1]) }])).toBeNull();
  });
});

describe('ClipboardSync', () => {
  const item = (t: string) => [{ format: CLIP_FORMAT.text, compress: false, content: utf8(t) }];

  test('remote text is written locally and not echoed back', async () => {
    const sent: string[] = [];
    const written: string[] = [];
    const sync = new ClipboardSync({ send: (t) => sent.push(t), offer: () => {} }, () => ({ writeText: async (t) => void written.push(t) }));
    await sync.fromRemote(item('a'));
    await sync.fromRemote(item('a'));
    expect(written).toEqual(['a']);
    expect(sync.toRemote('a')).toBe(false);
    expect(sync.toRemote('b')).toBe(true);
    expect(sync.toRemote('a', true)).toBe(true);
    expect(sent).toEqual(['b', 'a']);
  });

  test('a refused write is offered, then retried', async () => {
    const offers: (string | null)[] = [];
    let ok = false;
    const sync = new ClipboardSync({ send: () => {}, offer: (t) => offers.push(t) }, () => ({
      writeText: async () => {
        if (!ok) throw new Error('needs a click');
      },
    }));
    await sync.fromRemote(item('x'));
    ok = true;
    expect(await sync.retry()).toBe(true);
    expect(offers).toEqual(['x', null]);
  });

  test('reading without a gesture only when already granted', async () => {
    const readText = vi.fn(async () => 'local');
    const sent: string[] = [];
    const sync = new ClipboardSync({ send: (t) => sent.push(t), offer: () => {} }, () => ({ readText }));
    vi.stubGlobal('navigator', { permissions: { query: async () => ({ state: 'prompt' }) } });
    expect(await sync.pullLocal(false)).toBe(false);
    expect(readText).not.toHaveBeenCalled();
    expect(await sync.pullLocal(true)).toBe(true);
    expect(sent).toEqual(['local']);
    vi.unstubAllGlobals();
  });
});
