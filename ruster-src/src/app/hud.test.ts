import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AutoHide } from './hud';

describe('AutoHide', () => {
  let el: HTMLElement;
  let grip: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="hud"></div><button id="grip" hidden></button>';
    el = document.getElementById('hud')!;
    grip = document.getElementById('grip')!;
  });
  afterEach(() => vi.useRealTimers());

  test('hides after the idle delay and shows the grip', () => {
    const h = new AutoHide(el, grip, { delayMs: 1000 });
    expect(el.classList.contains('hidden')).toBe(false);
    vi.advanceTimersByTime(999);
    expect(h.isHidden()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(h.isHidden()).toBe(true);
    expect(el.classList.contains('hidden')).toBe(true);
    expect(grip.hasAttribute('hidden')).toBe(false);
  });

  test('the top edge brings it back; elsewhere does not', () => {
    const h = new AutoHide(el, grip, { delayMs: 1000, edgePx: 40 });
    vi.advanceTimersByTime(1000);
    h.pointerAt(200);
    expect(h.isHidden()).toBe(true);
    h.pointerAt(10);
    expect(h.isHidden()).toBe(false);
    expect(grip.hasAttribute('hidden')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(h.isHidden()).toBe(true);
  });

  test('pinned (a control in use) stays up and hides after release', () => {
    const h = new AutoHide(el, grip, { delayMs: 500 });
    h.pin(true);
    vi.advanceTimersByTime(5000);
    expect(h.isHidden()).toBe(false);
    h.pin(false);
    vi.advanceTimersByTime(500);
    expect(h.isHidden()).toBe(true);
    h.destroy();
  });
});
