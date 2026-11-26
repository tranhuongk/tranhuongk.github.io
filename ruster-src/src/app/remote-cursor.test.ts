import { describe, expect, test } from 'vitest';
import { decodeMessage, encodeRequestCursorData, FIELD } from '../proto/message';
import { lengthDelimited, readFields, sintField, varintField } from '../proto/wire';
import { zstdRaw } from './zstd-fixture';
import { drawScale, shapePixels } from './remote-cursor';

describe('cursor messages', () => {
  test('CursorData: id, signed hot spot, size, compressed pixels', () => {
    const rgba = new Uint8Array(2 * 2 * 4).fill(7);
    const body = [...varintField(1, 99), ...sintField(2, 1), ...sintField(3, -1), ...varintField(4, 2), ...varintField(5, 2),
      ...lengthDelimited(6, zstdRaw(rgba))];
    const m = decodeMessage(new Uint8Array(lengthDelimited(FIELD.cursorData, body)));
    expect(m.kind).toBe('cursorData');
    if (m.kind !== 'cursorData') return;
    expect(m.cursor).toMatchObject({ id: '99', hotx: 1, hoty: -1, width: 2, height: 2 });
    expect(Array.from(shapePixels(m.cursor)!)).toEqual(Array.from(rgba));
  });

  test('cursor_id is a bare number at the top level', () => {
    expect(decodeMessage(new Uint8Array(varintField(FIELD.cursorId, 123456789)))).toEqual({ kind: 'cursorId', id: '123456789' });
  });

  test('CursorPosition', () => {
    const m = decodeMessage(new Uint8Array(lengthDelimited(FIELD.cursorPosition, [...sintField(1, 640), ...sintField(2, -5)])));
    expect(m).toEqual({ kind: 'cursorPosition', x: 640, y: -5 });
  });

  test('uncompressed pixels are taken as they are; broken ones are refused', () => {
    const shape = { id: '1', hotx: 0, hoty: 0, width: 1, height: 1, colors: new Uint8Array([1, 2, 3, 4]) };
    expect(Array.from(shapePixels(shape)!)).toEqual([1, 2, 3, 4]);
    expect(shapePixels({ ...shape, colors: new Uint8Array([9, 9]) })).toBeNull();
  });

  test('request_cursor_data is Misc field 39', () => {
    const misc = readFields(encodeRequestCursorData('77'))[0]!;
    expect(misc.field).toBe(FIELD.misc);
    expect(readFields(misc.value as Uint8Array)).toEqual([{ field: 39, wireType: 0, value: 77 }]);
  });
});

describe('drawScale', () => {
  test('follows the picture scale, kept readable and not huge', () => {
    expect(drawScale({ width: 32, height: 32 }, 1)).toBe(1);
    expect(drawScale({ width: 32, height: 32 }, 0.2)).toBe(0.5); // 16 px at least
    expect(drawScale({ width: 32, height: 32 }, 4)).toBe(2); // 64 px at most
  });
});
