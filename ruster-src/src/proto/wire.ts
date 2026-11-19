// Minimal protobuf wire codec: just enough of the RustDesk rendezvous messages (hbb package) to
// ask the ID server about a peer. Field numbers are those of the public protocol.

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });

export function varint(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`bad varint ${value}`);
  const out: number[] = [];
  let n = value;
  while (n > 0x7f) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}

function tag(field: number, wireType: number): number[] {
  return varint(field * 8 + wireType);
}

export function lengthDelimited(field: number, bytes: ArrayLike<number>): number[] {
  return [...tag(field, 2), ...varint(bytes.length), ...Array.from(bytes)];
}

export function stringField(field: number, text: string): number[] {
  return lengthDelimited(field, TEXT_ENCODER.encode(text));
}

export function varintField(field: number, value: number): number[] {
  return [...tag(field, 0), ...varint(value)];
}

export interface RawField {
  field: number;
  wireType: number;
  /** Varint value (wireType 0) or the payload bytes (wireType 2). */
  value: number | Uint8Array;
}

/** Splits one message into its top-level fields. Throws on truncated or unsupported input. */
export function readFields(bytes: Uint8Array): RawField[] {
  const fields: RawField[] = [];
  let pos = 0;
  const readVarint = (): number => {
    let result = 0;
    let scale = 1;
    for (let i = 0; i < 10; i++) {
      const b = bytes[pos++];
      if (b === undefined) throw new Error('truncated varint');
      result += (b & 0x7f) * scale;
      if ((b & 0x80) === 0) return result;
      scale *= 128;
    }
    throw new Error('varint too long');
  };
  while (pos < bytes.length) {
    const key = readVarint();
    const field = Math.floor(key / 8);
    const wireType = key % 8;
    if (wireType === 0) fields.push({ field, wireType, value: readVarint() });
    else if (wireType === 2) {
      const len = readVarint();
      if (pos + len > bytes.length) throw new Error('truncated field');
      fields.push({ field, wireType, value: bytes.subarray(pos, pos + len) });
      pos += len;
    } else if (wireType === 1) pos += 8;
    else if (wireType === 5) pos += 4;
    else throw new Error(`unsupported wire type ${wireType}`);
  }
  return fields;
}

export function decodeText(bytes: Uint8Array): string {
  return TEXT_DECODER.decode(bytes);
}

export function boolField(field: number, value: boolean): number[] {
  return varintField(field, value ? 1 : 0);
}

/** sint32 / sint64 zigzag encoding (RustDesk mouse coordinates). */
export function sintField(field: number, value: number): number[] {
  const zigzag = value >= 0 ? value * 2 : -value * 2 - 1;
  return varintField(field, zigzag);
}

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function fieldOf(fields: RawField[], field: number): RawField | undefined {
  return fields.find((f) => f.field === field);
}

export function bytesOf(fields: RawField[], field: number): Uint8Array | undefined {
  const f = fieldOf(fields, field);
  return f && f.value instanceof Uint8Array ? f.value : undefined;
}

export function textOf(fields: RawField[], field: number): string {
  const b = bytesOf(fields, field);
  return b ? decodeText(b) : '';
}

export function numberOf(fields: RawField[], field: number): number {
  const f = fieldOf(fields, field);
  return f && typeof f.value === 'number' ? f.value : 0;
}

/** Inverse of sintField for a value read with readFields. */
export function unzigzag(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}
