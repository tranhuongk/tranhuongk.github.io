// Draws the peer's VP9 video on a canvas through WebCodecs. Frames are decoded in order; until the
// first key frame arrives, delta frames are dropped and a key frame is requested.
import type { VideoChunk } from '../proto/message';

export const VP9_CODEC = 'vp09.00.10.08';

export interface VideoSink {
  /** Called once per decoded frame size change, before drawing. */
  resize(width: number, height: number): void;
  draw(frame: VideoFrame): void;
}

export class VideoPlayer {
  private decoder: VideoDecoder | null = null;
  private needKey = true;
  private closed = false;

  constructor(
    private readonly sink: VideoSink,
    private readonly requestKeyFrame: () => void,
    private readonly onError: (message: string) => void,
  ) {}

  static isSupported(): boolean {
    return typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';
  }

  private ensureDecoder(): VideoDecoder {
    if (this.decoder && this.decoder.state !== 'closed') return this.decoder;
    let lastW = 0;
    let lastH = 0;
    const decoder = new VideoDecoder({
      output: (frame) => {
        if (frame.displayWidth !== lastW || frame.displayHeight !== lastH) {
          lastW = frame.displayWidth;
          lastH = frame.displayHeight;
          this.sink.resize(lastW, lastH);
        }
        this.sink.draw(frame);
        frame.close();
      },
      error: (e) => {
        this.needKey = true;
        this.decoder = null;
        this.onError(`Lỗi giải mã video: ${e.message}`);
        this.requestKeyFrame();
      },
    });
    decoder.configure({ codec: VP9_CODEC, optimizeForLatency: true });
    this.decoder = decoder;
    return decoder;
  }

  feed(chunks: VideoChunk[]): void {
    if (this.closed) return;
    for (const c of chunks) {
      if (c.key) this.needKey = false;
      if (this.needKey) {
        this.requestKeyFrame();
        continue;
      }
      const decoder = this.ensureDecoder();
      // Keep latency low: a long decode queue means the peer is ahead of us; wait for a key frame.
      if (decoder.decodeQueueSize > 8 && !c.key) {
        this.needKey = true;
        this.requestKeyFrame();
        continue;
      }
      decoder.decode(
        new EncodedVideoChunk({ type: c.key ? 'key' : 'delta', timestamp: c.pts * 1000, data: c.data as Uint8Array<ArrayBuffer> }),
      );
    }
  }

  close(): void {
    this.closed = true;
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
  }
}
