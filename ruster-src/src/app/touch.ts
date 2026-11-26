// Touch screens drive the remote mouse like a laptop touchpad (the AnyDesk way): a cursor of our own
// sits on the remote screen and fingers move it instead of clicking where they land.
//   1 finger drag → move the cursor          1 finger tap → left click
//   hold, then drag → left button held        2 finger tap → right click
//   2 finger drag → scroll                    pinch → zoom the view (it follows the cursor)
//   3 finger tap → show / hide the keyboard
import { BUTTON, MOUSE } from '../proto/message';
import type { Geometry, InputTarget } from './input';

export interface TouchView {
  /** Canvas box in client pixels. */
  rect(): { left: number; top: number; width: number; height: number };
  /** Scales the view by `factor` around a client point. */
  zoomBy(factor: number, clientX: number, clientY: number): void;
  /** Scrolls so the client point is on screen. */
  reveal(clientX: number, clientY: number): void;
  /** Draws our cursor at a client point (null hides it); `pressed` while the left button is held. */
  drawCursor(at: { x: number; y: number } | null, pressed: boolean): void;
  toggleKeyboard(): void;
  /** Short buzz when a hold turns into a drag. */
  buzz(): void;
}

export const TAP_MS = 280;
export const HOLD_MS = 450;
/** Finger travel (client px) that still counts as a tap. */
export const SLOP_PX = 8;
/** Two-finger travel per wheel notch (client px). */
export const NOTCH_PX = 18;

type Mode = 'idle' | 'pending' | 'moving' | 'dragging' | 'two' | 'scroll' | 'pinch' | 'three' | 'done';

interface Finger {
  x: number;
  y: number;
  startX: number;
  startY: number;
  t: number;
}

export class TouchPad {
  private readonly fingers = new Map<number, Finger>();
  private mode: Mode = 'idle';
  private startT = 0;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** Cursor in remote desktop pixels (fractional, so slow moves still add up). */
  private cx: number;
  private cy: number;
  private shown = false;
  private pinchDist = 0;
  private mid = { x: 0, y: 0 };
  private scrollRest = { x: 0, y: 0 };

  constructor(private readonly target: InputTarget, private readonly geometry: () => Geometry, private readonly view: TouchView) {
    const g = geometry();
    this.cx = g.originX + g.width / 2;
    this.cy = g.originY + g.height / 2;
  }

  cursor(): { x: number; y: number } {
    return { x: Math.round(this.cx), y: Math.round(this.cy) };
  }

  /** Client point of the cursor on the canvas. */
  cursorClient(): { x: number; y: number } {
    const g = this.geometry();
    const r = this.view.rect();
    return {
      x: r.left + ((this.cx - g.originX) / Math.max(g.width, 1)) * r.width,
      y: r.top + ((this.cy - g.originY) / Math.max(g.height, 1)) * r.height,
    };
  }

  /** Redraws the cursor after the view moved (zoom, scroll, resize). */
  redraw(): void {
    if (this.shown) this.view.drawCursor(this.cursorClient(), this.mode === 'dragging');
  }

  /** A real mouse took over: hide our cursor until the next touch, and follow where the mouse went. */
  mouseAt(x: number, y: number): void {
    this.cx = x;
    this.cy = y;
    if (this.shown) {
      this.shown = false;
      this.view.drawCursor(null, false);
    }
  }

  /** The peer moved its cursor itself (an app, or someone at that machine): follow it while idle. */
  remoteMoved(x: number, y: number): void {
    if (this.mode !== 'idle' && this.mode !== 'done') return;
    const g = this.geometry();
    this.cx = Math.min(Math.max(x, g.originX), g.originX + g.width - 1);
    this.cy = Math.min(Math.max(y, g.originY), g.originY + g.height - 1);
    this.redraw();
  }

  down(id: number, x: number, y: number, t: number): void {
    this.fingers.set(id, { x, y, startX: x, startY: y, t });
    if (!this.shown) {
      this.shown = true;
      this.redraw();
    }
    const n = this.fingers.size;
    if (n === 1) {
      if (this.mode !== 'idle' && this.mode !== 'done') return;
      this.mode = 'pending';
      this.startT = t;
      this.holdTimer = setTimeout(() => this.hold(), HOLD_MS);
    } else if (n === 2 && (this.mode === 'pending' || this.mode === 'moving')) {
      this.clearHold();
      this.mode = 'two';
      this.startT = Math.min(...[...this.fingers.values()].map((f) => f.t));
      this.pinchDist = this.spread();
      this.mid = this.middle();
      this.scrollRest = { x: 0, y: 0 };
    } else if (n === 3 && (this.mode === 'two' || this.mode === 'pending')) {
      this.mode = 'three';
    } else if (this.mode !== 'dragging') {
      this.clearHold();
      this.mode = 'done';
    }
  }

  move(id: number, x: number, y: number, t: number): void {
    const f = this.fingers.get(id);
    if (!f) return;
    const dx = x - f.x;
    const dy = y - f.y;
    const dt = Math.max(t - f.t, 1);
    f.x = x;
    f.y = y;
    f.t = t;
    switch (this.mode) {
      case 'pending':
        if (Math.hypot(x - f.startX, y - f.startY) <= SLOP_PX) return;
        this.clearHold();
        this.mode = 'moving';
        this.moveBy(x - f.startX, y - f.startY, dt);
        return;
      case 'moving':
      case 'dragging':
        this.moveBy(dx, dy, dt);
        return;
      case 'two': {
        if (Math.abs(this.spread() - this.pinchDist) > 3 * SLOP_PX) {
          this.mode = 'pinch';
          this.pinchDist = this.spread();
          this.mid = this.middle();
        } else {
          const m = this.middle();
          if (Math.hypot(m.x - this.mid.x, m.y - this.mid.y) > SLOP_PX) {
            this.mode = 'scroll';
            this.mid = m;
          }
        }
        return;
      }
      case 'scroll': {
        const m = this.middle();
        this.scrollRest.x += m.x - this.mid.x;
        this.scrollRest.y += m.y - this.mid.y;
        this.mid = m;
        const nx = Math.trunc(this.scrollRest.x / NOTCH_PX);
        const ny = Math.trunc(this.scrollRest.y / NOTCH_PX);
        if (nx === 0 && ny === 0) return;
        this.scrollRest.x -= nx * NOTCH_PX;
        this.scrollRest.y -= ny * NOTCH_PX;
        // Content follows the fingers: fingers up = wheel down (y −1), fingers left = wheel right (x +1).
        for (let i = 0; i < Math.max(Math.abs(nx), Math.abs(ny)); i++) {
          this.target.sendMouse(MOUSE.wheel, 0, i < Math.abs(nx) ? -Math.sign(nx) : 0, i < Math.abs(ny) ? Math.sign(ny) : 0);
        }
        return;
      }
      case 'pinch': {
        const d = this.spread();
        const m = this.middle();
        if (this.pinchDist > 0 && d > 0) this.view.zoomBy(d / this.pinchDist, m.x, m.y);
        this.pinchDist = d;
        this.mid = m;
        this.redraw();
        return;
      }
      default:
    }
  }

  up(id: number, t: number, cancelled = false): void {
    if (!this.fingers.delete(id)) return;
    const left = this.fingers.size;
    const quick = t - this.startT <= TAP_MS;
    switch (this.mode) {
      case 'pending':
        this.clearHold();
        if (!cancelled && quick) this.click(BUTTON.left);
        this.mode = 'idle';
        break;
      case 'moving':
        this.mode = 'idle';
        break;
      case 'dragging':
        if (left === 0) {
          const p = this.cursor();
          this.target.sendMouse(MOUSE.up, BUTTON.left, p.x, p.y);
          this.mode = 'idle';
          this.redraw();
        }
        break;
      case 'two':
        if (!cancelled && quick) this.click(BUTTON.right);
        this.mode = left === 0 ? 'idle' : 'done';
        break;
      case 'three':
        if (!cancelled && quick) this.view.toggleKeyboard();
        this.mode = left === 0 ? 'idle' : 'done';
        break;
      default:
        this.mode = left === 0 ? 'idle' : 'done';
    }
  }

  destroy(): void {
    this.clearHold();
    if (this.mode === 'dragging') {
      const p = this.cursor();
      this.target.sendMouse(MOUSE.up, BUTTON.left, p.x, p.y);
    }
    this.fingers.clear();
    this.mode = 'idle';
  }

  private hold(): void {
    this.holdTimer = null;
    if (this.mode !== 'pending') return;
    this.mode = 'dragging';
    const p = this.cursor();
    this.target.sendMouse(MOUSE.down, BUTTON.left, p.x, p.y);
    this.view.buzz();
    this.redraw();
  }

  private clearHold(): void {
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private click(button: number): void {
    const p = this.cursor();
    this.target.sendMouse(MOUSE.down, button, p.x, p.y);
    this.target.sendMouse(MOUSE.up, button, p.x, p.y);
  }

  /** Finger travel → cursor travel: 1:1 with the screen as shown, up to 2.2× for quick flicks. */
  private moveBy(dx: number, dy: number, dt: number): void {
    const g = this.geometry();
    const r = this.view.rect();
    const speed = Math.hypot(dx, dy) / dt; // client px per ms
    const gain = 1 + Math.min(Math.max(speed - 0.25, 0) / 1.2, 1.2);
    const sx = r.width > 0 ? g.width / r.width : 1;
    const sy = r.height > 0 ? g.height / r.height : 1;
    this.cx = Math.min(Math.max(this.cx + dx * gain * sx, g.originX), g.originX + g.width - 1);
    this.cy = Math.min(Math.max(this.cy + dy * gain * sy, g.originY), g.originY + g.height - 1);
    const p = this.cursor();
    this.target.sendMouse(MOUSE.move, 0, p.x, p.y);
    const c = this.cursorClient();
    this.view.reveal(c.x, c.y);
    this.redraw();
  }

  private spread(): number {
    const [a, b] = [...this.fingers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private middle(): { x: number; y: number } {
    const [a, b] = [...this.fingers.values()];
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };
  }
}
