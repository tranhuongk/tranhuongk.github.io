import { describe, expect, test } from 'vitest';
import { lengthDelimited, readFields, stringField, varint, varintField } from './wire';

describe('wire', () => {
  test('varint encodes small and multi-byte values', () => {
    expect(varint(0)).toEqual([0]);
    expect(varint(127)).toEqual([127]);
    expect(varint(300)).toEqual([0xac, 0x02]);
    expect(() => varint(-1)).toThrow();
  });

  test('round-trips string, varint and nested fields', () => {
    const inner = [...stringField(1, 'abc'), ...varintField(2, 300)];
    const bytes = new Uint8Array(lengthDelimited(8, inner));
    const [outer] = readFields(bytes);
    expect(outer?.field).toBe(8);
    const fields = readFields(outer!.value as Uint8Array);
    expect(fields.map((f) => f.field)).toEqual([1, 2]);
    expect(new TextDecoder().decode(fields[0]!.value as Uint8Array)).toBe('abc');
    expect(fields[1]!.value).toBe(300);
  });

  test('rejects truncated input', () => {
    expect(() => readFields(new Uint8Array([0x0a, 0x05, 0x61]))).toThrow('truncated');
    expect(() => readFields(new Uint8Array([0x80]))).toThrow('truncated');
  });
});
