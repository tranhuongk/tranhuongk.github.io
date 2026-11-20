import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { PeerSummary } from '../proto/message';
import { Stage, STAGE_HTML, type StageSession } from './stage';

const PEER: PeerSummary = { hostname: 'MAC', platform: 'Mac OS', username: 'u', version: '1.5.3', width: 1920, height: 1080, originX: 0, originY: 0 };

function session(): StageSession & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls, path: 'webrtc',
    sendMouse: () => {}, sendKey: () => {}, requestKeyFrame: () => calls.push('keyframe'),
    setShowRemoteCursor: (on) => calls.push(`cursor:${on}`), sendCtrlAltDel: (p) => calls.push(`cad:${p}`), close: () => calls.push('close'),
  };
}

describe('Stage', () => {
  let root: HTMLElement;
  let s: ReturnType<typeof session>;
  let renamed: string[];
  let stage: Stage;
  beforeEach(() => {
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
    $('disconnect').click();
    expect(s.calls).toEqual(['cad:Mac OS', 'cursor:false', 'cursor:true', 'close']);
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
