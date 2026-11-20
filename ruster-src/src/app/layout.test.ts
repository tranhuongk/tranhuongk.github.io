import { describe, expect, test } from 'vitest';
import { canvasSize } from './layout';

describe('canvasSize', () => {
  test('fit scales up and down, keeping the aspect ratio', () => {
    expect(canvasSize('fit', 1920, 1080, 960, 600, 1)).toEqual({ width: 960, height: 540 });
    expect(canvasSize('fit', 1280, 720, 1920, 1080, 1)).toEqual({ width: 1920, height: 1080 });
    expect(canvasSize('fit', 1000, 1000, 400, 800, 2)).toEqual({ width: 400, height: 400 });
  });

  test('actual is one remote pixel per device pixel', () => {
    expect(canvasSize('actual', 3420, 2224, 800, 600, 2)).toEqual({ width: 1710, height: 1112 });
    expect(canvasSize('actual', 1920, 1080, 800, 600, 1)).toEqual({ width: 1920, height: 1080 });
  });

  test('degenerate sizes do not produce NaN', () => {
    expect(canvasSize('fit', 0, 0, 100, 100, 1)).toEqual({ width: 0, height: 0 });
    expect(canvasSize('fit', 100, 100, 0, 0, 1)).toEqual({ width: 100, height: 100 });
  });
});
