// Shows the toolbar when the pointer reaches the top edge (or it is touched / focused) and hides it
// again after a short idle time, so the remote screen has the whole window.
export interface AutoHideOptions {
  /** Idle time before hiding (ms). */
  delayMs?: number;
  /** Height of the hot zone at the top of the window (px). */
  edgePx?: number;
}

export class AutoHide {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pinned = false;
  private hidden = false;
  /** False right after the user hid the bar on purpose: the top edge reveals it again only after the pointer has left it. */
  private armed = true;
  private readonly delay: number;
  private readonly edge: number;

  constructor(private readonly el: HTMLElement, private readonly grip: HTMLElement | null, o: AutoHideOptions = {}) {
    this.delay = o.delayMs ?? 3000;
    this.edge = o.edgePx ?? 48;
    this.show();
  }

  isHidden(): boolean {
    return this.hidden;
  }

  /** Keeps the toolbar up while something in it is in use (an open editor, a focused button). */
  pin(on: boolean): void {
    this.pinned = on;
    if (on) this.show();
    else this.schedule();
  }

  show(): void {
    this.armed = true;
    this.hidden = false;
    this.el.classList.remove('hidden');
    this.grip?.setAttribute('hidden', '');
    this.schedule();
  }

  hide(): void {
    if (this.pinned || this.el.matches(':hover')) {
      this.schedule();
      return;
    }
    this.hidden = true;
    this.el.classList.add('hidden');
    this.grip?.removeAttribute('hidden');
  }

  /** Hides now because the user asked (the hide button): ignores hover/pin and lets go of the edge until the pointer leaves it. */
  dismiss(): void {
    this.pinned = false;
    this.armed = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.hidden = true;
    this.el.classList.add('hidden');
    this.grip?.removeAttribute('hidden');
  }

  /** Pointer position over the stage: reveal at the top edge. */
  pointerAt(clientY: number): void {
    if (clientY > this.edge) this.armed = true;
    else if (this.armed) this.show();
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), this.delay);
  }

  destroy(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
