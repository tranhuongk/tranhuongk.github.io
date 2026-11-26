import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PeerSummary } from '../proto/message';
import { Stage, STAGE_HTML, type StageSession } from './stage';

const PEER: PeerSummary = { hostname: 'MAC', platform: 'Mac OS', username: 'u', version: '1.5.3', width: 1920, height: 1080, originX: 0, originY: 0 };

function session(): StageSession & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls, path: 'webrtc',
    sendMouse: () => {}, sendKey: (k) => calls.push(`key:${JSON.stringify(k)}`), requestKeyFrame: () => calls.push('keyframe'),
    setShowRemoteCursor: (on) => calls.push(`cursor:${on}`), sendCtrlAltDel: (p) => calls.push(`cad:${p}`), close: () => calls.push('close'),
    requestCursorData: (id) => calls.push(`want:${id}`), sendClipboardText: (t) => calls.push(`clip:${t}`),
  };
}

describe('Stage', () => {
  let root: HTMLElement;
  let s: ReturnType<typeof session>;
  let renamed: string[];
  let stage: Stage;
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.stubGlobal('VideoDecoder', class { state = 'configured'; configure() {} decode() {} close() {} });
    vi.stubGlobal('EncodedVideoChunk', class {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    document.body.innerHTML = `<section id="stage">${STAGE_HTML}</section>`;
    root = document.getElementById('stage')!;
    s = session();
    renamed = [];
    stage = new Stage(root, s, { peer: PEER, title: 'MAC', rename: (n) => (renamed.push(n), n || 'MAC'), onError: () => {}, silenceMs: 2000 });
  });
  afterEach(() => {
    stage.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;

  test('start needs WebCodecs and a 2D canvas', () => {
    vi.unstubAllGlobals();
    expect(stage.start()).toBe(false);
  });

  test('shows the title, the link chip and toggles 100 % / fit', () => {
    expect(stage.start()).toBe(true);
    expect($('bar-name').textContent).toBe('MAC');
    stage.setDelay(24);
    expect($('link-text').textContent).toBe('WebRTC · 24 ms · 0 fps');
    expect($('link').dataset.quality).toBe('good');
    stage.setDelay(300);
    expect($('link').dataset.quality).toBe('bad');
    $('btn-fit').click();
    expect($('btn-fit').textContent).toBe('Vừa khung');
    $('btn-fit').click();
    expect($('btn-fit').textContent).toBe('100%');
  });

  test('toolbar buttons reach the session', () => {
    stage.start();
    $('btn-cad').click();
    $('btn-cursor').click();
    expect($('btn-cursor').getAttribute('aria-pressed')).toBe('false');
    $('btn-cursor').click();
    expect($('btn-cursor').getAttribute('aria-pressed')).toBe('true');
    $('disconnect').click();
    expect(s.calls).toEqual(['cad:Mac OS', 'close']);
  });

  test('⌘V on the picture sends the pasted text first, then the keys', async () => {
    stage.start();
    const canvas = $('screen') as HTMLCanvasElement;
    canvas.focus();
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', metaKey: true, bubbles: true, cancelable: true }));
    expect(s.calls).toEqual([]);
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'xin chào' } });
    canvas.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(s.calls).toEqual(['clip:xin chào']);
    await vi.advanceTimersByTimeAsync(100);
    expect(s.calls).toEqual(['clip:xin chào', `key:${JSON.stringify({ chr: 0x76, modifiers: [23] })}`]);
  });

  test('⌘V with nothing to paste still reaches the peer', () => {
    stage.start();
    const canvas = $('screen') as HTMLCanvasElement;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(200);
    expect(s.calls).toEqual([`key:${JSON.stringify({ chr: 0x76, modifiers: [4] })}`]);
  });

  test('typing: the hidden field takes the keys, so Telex can type Vietnamese; text goes as keys', () => {
    stage.start();
    const field = root.querySelector('#soft-kbd') as HTMLInputElement;
    $('btn-ime').click();
    expect(document.activeElement).toBe(field);
    s.calls.length = 0;
    const start = field.value;
    for (const v of ['a', 'â', 'ấ']) {
      field.value = start + v;
      field.dispatchEvent(new Event('input'));
    }
    expect(s.calls).toEqual(['key:{"text":"a"}', 'key:{"controlKey":2}', 'key:{"text":"â"}', 'key:{"controlKey":2}', 'key:{"text":"ấ"}']);
  });

  test('"Đổi bộ gõ" sends Ctrl+Space to a Mac', async () => {
    stage.start();
    $('btn-ime').click();
    expect(s.calls).toEqual([`key:${JSON.stringify({ controlKey: 30, modifiers: [4] })}`]);
  });

  test('a cursor id never received is asked for once', () => {
    stage.start();
    stage.cursorEvent({ id: '42' });
    stage.cursorEvent({ id: '42' });
    expect(s.calls).toEqual(['want:42']);
  });

  test('remote clipboard that cannot be written offers a button', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: () => Promise.reject(new Error('not focused')) } });
    stage.start();
    stage.remoteClipboard([{ format: 0, compress: false, content: new TextEncoder().encode('abc') }]);
    await vi.waitFor(() => expect($('clip-offer').hidden).toBe(false));
    vi.unstubAllGlobals();
  });

  test('rename in place: Enter saves and shows what rename returned, Escape cancels', () => {
    stage.start();
    $('bar-title').click();
    expect($('bar-rename').hidden).toBe(false);
    const input = $<HTMLInputElement>('bar-rename-input');
    input.value = 'Mac nhà';
    $('bar-rename').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(renamed).toEqual(['Mac nhà']);
    expect($('bar-name').textContent).toBe('Mac nhà');
    expect($('bar-rename').hidden).toBe(true);
    $('bar-title').click();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect($('bar-rename').hidden).toBe(true);
    expect(renamed).toHaveLength(1);
  });

  test('the banner appears when the peer goes quiet and disappears with new data', () => {
    stage.start();
    vi.advanceTimersByTime(3000);
    expect($('lost').hidden).toBe(false);
    stage.feed([]);
    vi.advanceTimersByTime(1000);
    expect($('lost').hidden).toBe(true);
  });

  test('the toolbar hides itself and returns at the top edge', () => {
    stage.start();
    vi.advanceTimersByTime(3100);
    expect($('hud').classList.contains('hidden')).toBe(true);
    root.dispatchEvent(Object.assign(new Event('pointermove'), { clientY: 5 }));
    expect($('hud').classList.contains('hidden')).toBe(false);
  });
});
