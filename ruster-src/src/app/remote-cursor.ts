// The remote machine's own cursor shapes (arrow, I-beam, hand, resize…), sent by the peer as
// zstd-compressed RGBA and then named by id. They replace the local cursor over the picture, scaled
// with it, the way the official client does; on touch screens the touchpad cursor wears them too.
import { decompress } from 'fzstd';
import type { CursorShape } from '../proto/message';

export interface CursorImage {
  /** Null for a hidden cursor (the peer hides it while typing or playing video). */
  source: HTMLCanvasElement | null;
  width: number;
  height: number;
  hotx: number;
  hoty: number;
  /** The text I-beam: a tap with it on a touch screen opens the keyboard. */
  textBeam?: boolean;
}

/**
 * Whether RGBA cursor pixels look like the text I-beam: a tall narrow shape, hot spot in its middle,
 * a wide bar on top and a thin stem — the vertical resize arrows are as tall but end in a point.
 */
export function isTextBeam(px: Uint8Array, w: number, h: number, hotx: number, hoty: number): boolean {
  const solid = (x: number, y: number) => px[(y * w + x) * 4 + 3]! > 0x40;
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid(x, y)) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  if (x1 < 0 || bh < 8 || bh < 1.6 * bw) return false;
  if (Math.abs(hotx - (x0 + x1) / 2) > bw * 0.35 + 1 || Math.abs(hoty - (y0 + y1) / 2) > bh * 0.3) return false;
  const rowWidth = (y: number) => {
    let n = 0;
    for (let x = x0; x <= x1; x++) if (solid(x, y)) n++;
    return n;
  };
  const top = rowWidth(y0);
  const mid = rowWidth(Math.round((y0 + y1) / 2));
  return top >= 0.5 * bw && mid <= 0.5 * bw;
}

/** Rendered size bounds (CSS px, longest side): readable on a phone, not huge at 200 %. */
const MIN_PX = 16;
const MAX_PX = 64;
/** Browsers ignore cursor images above 128 px. */
const CSS_LIMIT = 128;

/** RGBA bytes of a shape: zstd-compressed normally, raw from peers that skip compression. */
export function shapePixels(s: CursorShape): Uint8Array | null {
  const need = s.width * s.height * 4;
  if (need <= 0 || !s.colors.length) return null;
  if (s.colors.length === need) return s.colors;
  try {
    const raw = decompress(s.colors);
    return raw.length >= need ? raw.subarray(0, need) : null;
  } catch {
    return null;
  }
}

export function decodeShape(s: CursorShape): CursorImage | null {
  if (!s.width || !s.height || !s.colors.length) return { source: null, width: 0, height: 0, hotx: 0, hoty: 0 };
  const px = shapePixels(s);
  if (!px) return null;
  const c = document.createElement('canvas');
  c.width = s.width;
  c.height = s.height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(px), s.width, s.height), 0, 0);
  return { source: c, width: s.width, height: s.height, hotx: s.hotx, hoty: s.hoty, textBeam: isTextBeam(px, s.width, s.height, s.hotx, s.hoty) };
}

/** CSS px per remote pixel → the scale actually drawn, kept within MIN_PX..MAX_PX. */
export function drawScale(img: Pick<CursorImage, 'width' | 'height'>, scale: number): number {
  const longest = Math.max(img.width, img.height, 1);
  return Math.min(Math.max(scale, MIN_PX / longest), MAX_PX / longest);
}

export interface Rendered {
  /** `cursor:` values, best first (image-set for sharp HiDPI, then a plain url). */
  css: string[];
  url: string;
  width: number;
  height: number;
  hotx: number;
  hoty: number;
}

function render(img: CursorImage, s: number, density: number): string {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * s * density));
  c.height = Math.max(1, Math.round(img.height * s * density));
  const ctx = c.getContext('2d');
  if (!ctx || !img.source) return '';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img.source, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

export class RemoteCursor {
  private readonly shapes = new Map<string, CursorImage>();
  private readonly asked = new Set<string>();
  private cache: { img: CursorImage; key: string; out: Rendered | null } | null = null;
  current: CursorImage | null = null;

  /** Stores a shape and shows it. False when its pixels cannot be read. */
  add(shape: CursorShape): boolean {
    const img = decodeShape(shape);
    if (!img) return false;
    if (this.shapes.size > 64) this.shapes.delete(this.shapes.keys().next().value as string);
    this.shapes.set(shape.id, img);
    this.current = img;
    return true;
  }

  /** Shows a shape named by id; false when we never got it (ask the peer once). */
  use(id: string): boolean {
    const img = this.shapes.get(id);
    if (img) {
      this.current = img;
      return true;
    }
    return false;
  }

  /** True the first time an unknown id is seen, so it is requested only once. */
  shouldAsk(id: string): boolean {
    if (this.asked.has(id)) return false;
    this.asked.add(id);
    return true;
  }

  /** The current shape drawn at `scale` CSS px per remote pixel; null while none / hidden. */
  rendered(scale: number, dpr: number): Rendered | null {
    const img = this.current;
    if (!img?.source) return null;
    const s = drawScale(img, scale);
    const density = Math.max(1, Math.min(dpr, 3));
    const key = `${s.toFixed(3)}@${density}`;
    if (this.cache?.img === img && this.cache.key === key) return this.cache.out;
    const width = Math.max(1, Math.round(img.width * s));
    const height = Math.max(1, Math.round(img.height * s));
    const hotx = Math.min(Math.max(Math.round(img.hotx * s), 0), width - 1);
    const hoty = Math.min(Math.max(Math.round(img.hoty * s), 0), height - 1);
    const url = render(img, s, 1);
    const css: string[] = [];
    const sharpDensity = Math.min(density, CSS_LIMIT / Math.max(width, height));
    if (sharpDensity > 1.01) {
      const sharp = render(img, s, sharpDensity);
      css.push(`image-set(url("${sharp}") ${sharpDensity.toFixed(2)}x) ${hotx} ${hoty}, default`);
    }
    if (Math.max(width, height) <= CSS_LIMIT) css.push(`url("${url}") ${hotx} ${hoty}, default`);
    const out = url ? { css, url: density > 1 ? render(img, s, density) : url, width, height, hotx, hoty } : null;
    this.cache = { img, key, out };
    return out;
  }

  /** The peer's cursor is the text I-beam (over a field it can type in). */
  textBeam(): boolean {
    return this.current?.textBeam === true;
  }

  /** The peer hid its cursor. */
  hidden(): boolean {
    return this.current !== null && this.current.source === null;
  }
}
