import { afterEach, describe, expect, test, vi } from 'vitest';
import { VideoPlayer, VP9_CODEC } from './video';

class FakeDecoder {
  static last: FakeDecoder;
  state = 'configured';
  decodeQueueSize = 0;
  configured: unknown;
  chunks: { type: string; timestamp: number }[] = [];
  constructor(readonly init: { output: (f: unknown) => void; error: (e: Error) => void }) {
    FakeDecoder.last = this;
  }
  configure(c: unknown) {
    this.configured = c;
  }
  decode(chunk: { type: string; timestamp: number }) {
    this.chunks.push(chunk);
  }
  close() {
    this.state = 'closed';
  }
}

describe('VideoPlayer', () => {
  afterEach(() => vi.unstubAllGlobals());
  const setup = () => {
    vi.stubGlobal('VideoDecoder', FakeDecoder);
    vi.stubGlobal('EncodedVideoChunk', class { constructor(readonly init: { type: string; timestamp: number }) { Object.assign(this, init); } });
    const draws: number[][] = [];
    const sizes: number[][] = [];
    const keyRequests = vi.fn();
    const errors: string[] = [];
    const player = new VideoPlayer({ resize: (w, h) => sizes.push([w, h]), draw: () => draws.push([1]) }, keyRequests, (m) => errors.push(m));
    return { player, draws, sizes, keyRequests, errors };
  };
  const chunk = (key: boolean, pts: number) => ({ data: new Uint8Array([1]), key, pts });

  test('drops delta frames until a key frame and asks for one', () => {
    const { player, keyRequests } = setup();
    player.feed([chunk(false, 1)]);
    expect(keyRequests).toHaveBeenCalledTimes(1);
    expect(FakeDecoder.last).toBeUndefined();
    player.feed([chunk(true, 2), chunk(false, 3)]);
    expect(FakeDecoder.last.configured).toEqual({ codec: VP9_CODEC, optimizeForLatency: true });
    expect(FakeDecoder.last.chunks.map((c) => [c.type, c.timestamp])).toEqual([['key', 2000], ['delta', 3000]]);
  });

  test('a backed-up decoder skips ahead to the next key frame', () => {
    const { player, keyRequests } = setup();
    player.feed([chunk(true, 1)]);
    FakeDecoder.last.decodeQueueSize = 20;
    player.feed([chunk(false, 2)]);
    expect(keyRequests).toHaveBeenCalledTimes(1);
    expect(FakeDecoder.last.chunks).toHaveLength(1);
  });

  test('a decoder error is reported and the next key frame restarts decoding', () => {
    const { player, errors, keyRequests } = setup();
    player.feed([chunk(true, 1)]);
    const first = FakeDecoder.last;
    first.init.error(new Error('boom'));
    expect(errors[0]).toContain('boom');
    expect(keyRequests).toHaveBeenCalledTimes(1);
    player.feed([chunk(true, 2)]);
    expect(FakeDecoder.last).not.toBe(first);
  });

  test('close stops decoding', () => {
    const { player } = setup();
    player.feed([chunk(true, 1)]);
    const d = FakeDecoder.last;
    player.close();
    expect(d.state).toBe('closed');
    player.feed([chunk(true, 2)]);
    expect(d.chunks).toHaveLength(1);
  });
});
