import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BUTTON, MOUSE } from '../proto/message';
import { HOLD_MS, TouchPad, type TouchView } from './touch';

// Remote 1920×1080 shown at 960×540 from (0,0): one client px = 2 remote px.
const geo = { width: 1920, height: 1080, originX: 0, originY: 0 };

describe('TouchPad (AnyDesk-style touchpad)', () => {
  let sent: [number, number, number, number][];
  let view: TouchView & { zoomBy: ReturnType<typeof vi.fn>; toggleKeyboard: ReturnType<typeof vi.fn>; drawCursor: ReturnType<typeof vi.fn> };
  let pad: TouchPad;
  let scrolled: number[][];
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    view = {
      rect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
      zoomBy: vi.fn(), reveal: vi.fn(), drawCursor: vi.fn(), toggleKeyboard: vi.fn(), buzz: vi.fn(),
    } as unknown as typeof view;
    scrolled = [];
    pad = new TouchPad({ sendMouse: (...a) => sent.push(a), sendKey: vi.fn(), scroll: (x, y) => scrolled.push([x, y]) }, () => geo, view);
  });
  afterEach(() => vi.useRealTimers());
  const types = () => sent.map(([t, b]) => `${t}:${b}`);

  test('starts in the middle and shows our cursor on the first touch', () => {
    expect(pad.cursor()).toEqual({ x: 960, y: 540 });
    pad.down(1, 100, 100, 0);
    expect(view.drawCursor).toHaveBeenLastCalledWith({ x: 480, y: 270 }, false);
  });

  test('a tap clicks left where the cursor is, not where the finger landed', () => {
    pad.down(1, 10, 10, 0);
    pad.up(1, 120);
    expect(sent).toEqual([[MOUSE.down, BUTTON.left, 960, 540], [MOUSE.up, BUTTON.left, 960, 540]]);
  });

  test('a slow drag moves the cursor relatively, 1:1 with the picture, and sends no click', () => {
    pad.down(1, 100, 100, 0);
    pad.move(1, 110, 100, 100); // past the slop: 10 px in 100 ms (slow)
    pad.move(1, 120, 105, 200);
    pad.up(1, 300);
    expect(pad.cursor()).toEqual({ x: 1000, y: 550 });
    expect(types().every((t) => t === `${MOUSE.move}:0`)).toBe(true);
  });

  test('a quick flick moves further than a slow drag of the same length', () => {
    pad.down(1, 0, 0, 0);
    pad.move(1, 100, 0, 20);
    expect(pad.cursor().x - 960).toBeGreaterThan(200);
  });

  test('the cursor stays on the remote screen', () => {
    pad.down(1, 0, 0, 0);
    pad.move(1, -5000, -5000, 1000);
    expect(pad.cursor()).toEqual({ x: 0, y: 0 });
  });

  test('hold then drag holds the left button until the finger lifts', () => {
    pad.down(1, 50, 50, 0);
    vi.advanceTimersByTime(HOLD_MS);
    expect(view.buzz).toHaveBeenCalled();
    pad.move(1, 70, 50, HOLD_MS + 200);
    pad.up(1, HOLD_MS + 300);
    expect(types()).toEqual([`${MOUSE.down}:${BUTTON.left}`, `${MOUSE.move}:0`, `${MOUSE.up}:${BUTTON.left}`]);
  });

  test('a two-finger tap clicks right', () => {
    pad.down(1, 100, 100, 0);
    pad.down(2, 200, 100, 20);
    pad.up(1, 150);
    pad.up(2, 160);
    expect(types()).toEqual([`${MOUSE.down}:${BUTTON.right}`, `${MOUSE.up}:${BUTTON.right}`]);
  });

  test('two fingers moving up scroll down, as far as they travel on the picture', () => {
    pad.down(1, 100, 300, 0);
    pad.down(2, 200, 300, 0);
    for (let y = 300; y >= 200; y -= 10) {
      pad.move(1, 100, y, 400 - y);
      pad.move(2, 200, y, 400 - y);
    }
    pad.up(1, 500);
    pad.up(2, 500);
    const k = geo.width / 960;
    expect(scrolled.every(([x, y]) => x === -0 && y! > 0)).toBe(true);
    // Travel after the slop that started the scroll, in remote pixels.
    expect(scrolled.reduce((a, [, y]) => a + y!, 0)).toBeCloseTo(90 * k);
    expect(sent.some(([t]) => t === MOUSE.down)).toBe(false);
  });

  test('pinching zooms the view and sends nothing to the remote', () => {
    pad.down(1, 400, 300, 0);
    pad.down(2, 500, 300, 0);
    pad.move(2, 560, 300, 50);
    pad.move(2, 620, 300, 100);
    pad.up(1, 200);
    pad.up(2, 200);
    expect(view.zoomBy).toHaveBeenCalled();
    expect(view.zoomBy.mock.calls.at(-1)![0]).toBeGreaterThan(1);
    expect(sent).toEqual([]);
  });

  test('a three-finger tap toggles the keyboard', () => {
    pad.down(1, 100, 100, 0);
    pad.down(2, 200, 100, 0);
    pad.down(3, 300, 100, 0);
    pad.up(1, 100);
    pad.up(2, 100);
    pad.up(3, 100);
    expect(view.toggleKeyboard).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
  });

  test('a real mouse hides our cursor and the next touch starts from where the mouse left it', () => {
    pad.down(1, 0, 0, 0);
    pad.up(1, 500);
    pad.mouseAt(100, 200);
    expect(view.drawCursor).toHaveBeenLastCalledWith(null, false);
    pad.down(1, 0, 0, 1000);
    pad.up(1, 1100);
    expect(sent.at(-1)).toEqual([MOUSE.up, BUTTON.left, 100, 200]);
  });
});
