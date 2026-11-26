import { describe, expect, test } from 'vitest';
import { MOUSE } from '../proto/message';
import { MOUSE_TRACKPAD, Scroller, scrollWay, wheelPixels } from './scroll';

describe('scroll', () => {
  test('the way follows the peer: pixels on a Mac, wheel units on Windows, notches elsewhere or on old peers', () => {
    expect(scrollWay('Mac OS', '1.5.3')).toEqual({ type: MOUSE_TRACKPAD, perPx: 1 });
    expect(scrollWay('Windows', '1.3.0')).toEqual({ type: MOUSE_TRACKPAD, perPx: 1.2 });
    expect(scrollWay('Linux', '1.5.3')).toEqual({ type: MOUSE.wheel, perPx: 0.01 });
    expect(scrollWay('Mac OS', '1.2.3').type).toBe(MOUSE.wheel);
  });

  test('wheel deltas in lines or pages become pixels', () => {
    expect(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 800)).toEqual({ x: 0, y: 100 });
    expect(wheelPixels({ deltaX: 1, deltaY: 0, deltaMode: 2 }, 800)).toEqual({ x: 800, y: 0 });
  });

  test('a trackpad stream adds up instead of a notch per event', () => {
    const sent: number[][] = [];
    const s = new Scroller((t, x, y) => sent.push([t, x, y]), scrollWay('Linux', '1.5.3'));
    for (let i = 0; i < 25; i++) s.by(0, 4); // 25 small trackpad events = 100 px = one notch
    expect(sent).toEqual([[MOUSE.wheel, 0, -1]]);
  });

  test('a Mac peer scrolls the same pixels, the remainder kept', () => {
    const sent: number[][] = [];
    const s = new Scroller((t, x, y) => sent.push([t, x, y]), scrollWay('Mac OS', '1.5.3'));
    s.by(0, 2.5);
    s.by(0, 2.5);
    s.by(-7, 0);
    expect(sent).toEqual([[MOUSE_TRACKPAD, 0, -2], [MOUSE_TRACKPAD, 0, -3], [MOUSE_TRACKPAD, -7, -0]]);
  });
});
