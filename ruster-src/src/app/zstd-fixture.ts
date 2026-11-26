// Test helper: zstd frames without a compressor.
/** A zstd frame holding `data` in one raw block (what a compressor emits for incompressible input). */
export function zstdRaw(data: Uint8Array): Uint8Array {
  const n = data.length;
  if (n >= 65792) throw new RangeError('fixture holds < 65792 bytes');
  // Single segment; the content size takes 1 byte below 256, else 2 bytes storing n − 256.
  const header = n < 256 ? [0x20, n] : [0x60, (n - 256) & 0xff, (n - 256) >> 8];
  const block = 1 | (n << 3); // last block, raw
  return new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, ...header, block & 0xff, (block >> 8) & 0xff, (block >> 16) & 0xff, ...data]);
}
