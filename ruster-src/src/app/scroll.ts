// Scrolling that keeps the distance of this machine: the browser's wheel deltas already carry the
// local scroll speed (system setting, acceleration, trackpad momentum), so the peer scrolls by that
// distance instead of one wheel notch per event — trackpads fire dozens of events a second.
import { MOUSE } from '../proto/message';

/** Trackpad scroll: Mac peers take it in pixels, Windows peers in wheel units (120 a notch). */
export const MOUSE_TRACKPAD = 4;
/** What one wheel notch scrolls in a browser (Chrome/Edge, 3 lines). */
export const NOTCH_PX = 100;
export const LINE_PX = NOTCH_PX / 3;
/** At most this many units in one message (a Mac peer posts one event per pixel). */
const MAX_UNITS = 2000;

type Way = { type: number; perPx: number };

function newerThan(version: string, min: number[]): boolean {
  const v = version.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < min.length; i++) {
    if ((v[i] ?? 0) !== min[i]) return (v[i] ?? 0) > min[i]!;
  }
  return true;
}

/** How the peer takes a scroll: pixels (Mac), wheel units (Windows), else whole notches. */
export function scrollWay(platform: string, version: string): Way {
  const trackpad = newerThan(version, [1, 2, 4]);
  if (trackpad && /mac/i.test(platform)) return { type: MOUSE_TRACKPAD, perPx: 1 };
  if (trackpad && /windows/i.test(platform)) return { type: MOUSE_TRACKPAD, perPx: 120 / NOTCH_PX };
  return { type: MOUSE.wheel, perPx: 1 / NOTCH_PX };
}

/** A wheel event's distance in pixels, whatever unit the browser used. */
export function wheelPixels(e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>, pagePx: number): { x: number; y: number } {
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? pagePx : 1;
  return { x: e.deltaX * unit, y: e.deltaY * unit };
}

export class Scroller {
  private rest = { x: 0, y: 0 };

  constructor(private readonly send: (type: number, x: number, y: number) => void, private readonly way: Way) {}

  /** Scrolls by a distance in pixels, wheel-event sense: positive = right / down. */
  by(px: number, py: number): void {
    this.rest.x += px * this.way.perPx;
    this.rest.y += py * this.way.perPx;
    const clamp = (n: number) => Math.max(-MAX_UNITS, Math.min(MAX_UNITS, n));
    const ux = clamp(Math.trunc(this.rest.x));
    const uy = clamp(Math.trunc(this.rest.y));
    if (ux === 0 && uy === 0) return;
    this.rest.x = ux === Math.trunc(this.rest.x) ? this.rest.x - ux : 0;
    this.rest.y = uy === Math.trunc(this.rest.y) ? this.rest.y - uy : 0;
    // The peer's wheel: y up is positive.
    this.send(this.way.type, ux, -uy);
  }
}
