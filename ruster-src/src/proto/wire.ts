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
