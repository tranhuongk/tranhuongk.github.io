// Numbers shown on the connection chip: frames per second, delay, and how good the link looks.

export type Quality = 'good' | 'ok' | 'bad' | 'unknown';

export function quality(delayMs: number | null): Quality {
  if (delayMs === null) return 'unknown';
  if (delayMs < 80) return 'good';
  if (delayMs < 200) return 'ok';
  return 'bad';
}

export function linkText(path: 'relay' | 'webrtc' | null, delayMs: number | null, fps: number): string {
  const parts: string[] = [];
  if (path) parts.push(path === 'webrtc' ? 'WebRTC' : 'Relay');
  if (delayMs !== null) parts.push(`${delayMs} ms`);
  parts.push(`${fps} fps`);
  return parts.join(' · ');
}

/** Counts frames and reports the count once a second. */
export class FpsMeter {
  private frames = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly onFps: (fps: number) => void) {}

  tick(): void {
    this.frames++;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.onFps(this.frames);
      this.frames = 0;
    }, 1000);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.frames = 0;
  }
}
