import { describe, expect, test, vi } from 'vitest';
import { BUTTON, CONTROL_KEY, MOUSE } from '../proto/message';
import { attachInput, keyInputFor, localIsApple, swapCommandControl, toRemote } from './input';

const rect = { left: 100, top: 50, width: 640, height: 360 };
const geo = { width: 1920, height: 1080, originX: 0, originY: 0 };
const key = (o: Partial<KeyboardEvent>) => ({ key: '', code: '', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, isComposing: false, ...o });

describe('input', () => {
  test('toRemote scales canvas pixels to the remote display and clamps', () => {
    expect(toRemote(100, 50, rect, geo)).toEqual({ x: 0, y: 0 });
    expect(toRemote(420, 230, rect, geo)).toEqual({ x: 960, y: 540 });
    expect(toRemote(9999, 9999, rect, geo)).toEqual({ x: 1919, y: 1079 });
    expect(toRemote(-5, -5, rect, { ...geo, originX: 1920 })).toEqual({ x: 1920, y: 0 });
  });

  test('keyInputFor: text, control keys, chords, and keys that send nothing', () => {
    expect(keyInputFor(key({ key: 'a', code: 'KeyA' }))).toEqual({ text: 'a' });
    expect(keyInputFor(key({ key: 'A', code: 'KeyA', shiftKey: true }))).toEqual({ text: 'A' });
    expect(keyInputFor(key({ key: ' ', code: 'Space' }))).toEqual({ text: ' ' });
    expect(keyInputFor(key({ key: 'Enter', code: 'Enter' }))).toEqual({ controlKey: CONTROL_KEY.Return, modifiers: undefined });
    expect(keyInputFor(key({ key: 'ArrowUp', code: 'ArrowUp' }))).toMatchObject({ controlKey: CONTROL_KEY.UpArrow });
    expect(keyInputFor(key({ key: 'c', code: 'KeyC', ctrlKey: true }))).toEqual({ chr: 99, modifiers: [CONTROL_KEY.Control] });
    expect(keyInputFor(key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBeNull();
    expect(keyInputFor(key({ key: 'a', code: 'KeyA', isComposing: true }))).toBeNull();
  });

  test('pointer and wheel events become mouse messages in remote coordinates', () => {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ ...rect, right: 740, bottom: 410, x: 100, y: 50, toJSON() {} });
    const sent: unknown[][] = [];
    const target = { sendMouse: (...a: unknown[]) => sent.push(a), sendKey: vi.fn(), scroll: (...a: unknown[]) => sent.push(['scroll', ...a]) };
    const detach = attachInput(canvas, target, () => geo);
    canvas.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 420, clientY: 230 }));
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { clientX: 420, clientY: 230, button: 2, pointerId: 1 }));
    canvas.dispatchEvent(Object.assign(new Event('pointerup'), { clientX: 420, clientY: 230, button: 2 }));
    canvas.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { deltaX: 0, deltaY: 120, deltaMode: 0 }));
    canvas.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { deltaX: 0, deltaY: -3, deltaMode: 1 }));
    expect(sent).toEqual([
      [MOUSE.move, 0, 960, 540],
      [MOUSE.down, BUTTON.right, 960, 540],
      [MOUSE.up, BUTTON.right, 960, 540],
      ['scroll', 0, 120],
      ['scroll', 0, -100],
    ]);
    detach();
    canvas.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 1, clientY: 1 }));
    expect(sent).toHaveLength(5);
  });

  test('⌘ ↔ Ctrl swap and Apple detection', () => {
    expect(swapCommandControl({ chr: 0x63, modifiers: [CONTROL_KEY.Meta, CONTROL_KEY.Shift] })).toEqual({ chr: 0x63, modifiers: [CONTROL_KEY.Control, CONTROL_KEY.Shift] });
    expect(swapCommandControl({ controlKey: CONTROL_KEY.Tab, modifiers: [CONTROL_KEY.Control] })).toEqual({ controlKey: CONTROL_KEY.Tab, modifiers: [CONTROL_KEY.Meta] });
    expect(swapCommandControl({ text: 'a' })).toEqual({ text: 'a' });
    expect(localIsApple({ platform: 'MacIntel', userAgent: '' })).toBe(true);
    expect(localIsApple({ platform: 'Win32', userAgent: '' })).toBe(false);
  });
});
