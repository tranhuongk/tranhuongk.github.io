// A WebSocket as a queue of binary frames, optionally behind the session's secretbox stream.
import type { SecretStream } from './crypto';

export class PipeError extends Error {
  constructor(readonly kind: 'open' | 'timeout' | 'closed' | 'decrypt', message: string) {
    super(message);
    this.name = 'PipeError';
  }
}

export class Pipe {
  private queue: Uint8Array[] = [];
  private waiter: { resolve: (b: Uint8Array) => void; reject: (e: Error) => void } | null = null;
  private stream: SecretStream | null = null;
  private failure: PipeError | null = null;
  private opened = false;

  constructor(private readonly ws: WebSocket, private readonly label: string) {
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (event) => {
      let bytes: Uint8Array = new Uint8Array(event.data as ArrayBuffer);
      try {
        if (this.stream) bytes = this.stream.open(bytes);
      } catch (e) {
        this.fail(new PipeError('decrypt', (e as Error).message));
        return;
      }
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w.resolve(bytes);
      } else this.queue.push(bytes);
    };
    ws.onclose = () => this.fail(new PipeError('closed', `${label}: kết nối đã đóng`));
    ws.onerror = () => {
      if (!this.opened) this.fail(new PipeError('open', `${label}: không kết nối được`));
    };
  }

  private fail(error: PipeError): void {
    if (this.failure) return;
    this.failure = error;
    this.waiter?.reject(error);
    this.waiter = null;
  }

  open(timeoutMs = 12_000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      const timer = setTimeout(() => reject(new PipeError('timeout', `${this.label}: quá thời gian kết nối`)), timeoutMs);
      this.ws.onopen = () => {
        clearTimeout(timer);
        this.opened = true;
        resolve();
      };
      const prevClose = this.ws.onclose;
      this.ws.onclose = (e) => {
        clearTimeout(timer);
        prevClose?.call(this.ws, e);
        reject(this.failure ?? new PipeError('closed', `${this.label}: kết nối đã đóng`));
      };
      const prevError = this.ws.onerror;
      this.ws.onerror = (e) => {
        clearTimeout(timer);
        prevError?.call(this.ws, e);
        reject(this.failure ?? new PipeError('open', `${this.label}: không kết nối được`));
      };
    });
  }

  send(bytes: Uint8Array): void {
    this.ws.send((this.stream ? this.stream.seal(bytes) : bytes) as Uint8Array<ArrayBuffer>);
  }

  /** Switches every later frame, both ways, to the secretbox stream. */
  secure(stream: SecretStream): void {
    this.stream = stream;
  }

  next(timeoutMs?: number): Promise<Uint8Array> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === undefined ? null : setTimeout(() => {
          this.waiter = null;
          reject(new PipeError('timeout', `${this.label}: không nhận được phản hồi`));
        }, timeoutMs);
      this.waiter = {
        resolve: (b) => {
          if (timer) clearTimeout(timer);
          resolve(b);
        },
        reject: (e) => {
          if (timer) clearTimeout(timer);
          reject(e);
        },
      };
    });
  }

  close(): void {
    try {
      this.ws.close(1000, 'bye');
    } catch {
      // already closed
    }
  }
}
