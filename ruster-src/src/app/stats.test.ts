import { afterEach, describe, expect, test, vi } from 'vitest';
import { FpsMeter, linkText, quality } from './stats';

describe('stats', () => {
  afterEach(() => vi.useRealTimers());

  test('quality thresholds', () => {
    expect([null, 10, 79, 80, 199, 200].map(quality)).toEqual(['unknown', 'good', 'good', 'ok', 'ok', 'bad']);
  });

  test('linkText joins what is known', () => {
    expect(linkText('webrtc', 24, 30)).toBe('WebRTC · 24 ms · 30 fps');
    expect(linkText('relay', null, 0)).toBe('Relay · 0 fps');
    expect(linkText(null, 5, 1)).toBe('5 ms · 1 fps');
  });

  test('FpsMeter reports the frames of each second and stops', () => {
    vi.useFakeTimers();
    const seen: number[] = [];
    const m = new FpsMeter((n) => seen.push(n));
    m.start();
    m.start();
    for (let i = 0; i < 12; i++) m.tick();
    vi.advanceTimersByTime(1000);
    for (let i = 0; i < 3; i++) m.tick();
    vi.advanceTimersByTime(1000);
    m.stop();
    vi.advanceTimersByTime(3000);
    expect(seen).toEqual([12, 3]);
  });
});
