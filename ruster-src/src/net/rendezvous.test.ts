import { describe, expect, test, vi } from 'vitest';
import { checkPeer, checkPeers, idSocketUrl, isValidPeerId, relaySocketUrl } from './rendezvous';

class FakeSocket {
  binaryType = '';
  sent: Uint8Array[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  reply(hex: string) {
    const bytes = new Uint8Array(hex.match(/../g)!.map((x) => parseInt(x, 16)));
    this.onmessage?.({ data: bytes.buffer });
  }
}

const open = (holder: { s?: FakeSocket }) => (url: string) => {
  holder.s = new FakeSocket(url);
  return holder.s as unknown as WebSocket;
};

describe('checkPeer', () => {
  test('builds the ID socket URL from a host, a host:port or a full URL', () => {
    expect(idSocketUrl('rs-ny.rustdesk.com')).toBe('wss://rs-ny.rustdesk.com/ws/id');
    expect(idSocketUrl('wss://example.com/')).toBe('wss://example.com/ws/id');
    expect(idSocketUrl('wss://example.com/ws/id')).toBe('wss://example.com/ws/id');
    expect(idSocketUrl('ws://127.0.0.1:21118')).toBe('ws://127.0.0.1:21118/ws/id');
  });

  test('validates ids', () => {
    expect(isValidPeerId('123456789')).toBe(true);
    expect(isValidPeerId('')).toBe(false);
    expect(isValidPeerId('a b')).toBe(false);
  });

  test('online when the first state bit is set', async () => {
    const h: { s?: FakeSocket } = {};
    const p = checkPeer('123456789', 'wss://x', open(h));
    h.s!.onopen!();
    expect(h.s!.sent).toHaveLength(1);
    h.s!.reply('c201030a0180');
    await expect(p).resolves.toEqual({ kind: 'online' });
    expect(h.s!.closed).toBe(true);
  });

  test('offline for a zero bit; an unexpected reply type is an error', async () => {
    const h: { s?: FakeSocket } = {};
    const p = checkPeer('123456789', 'wss://x', open(h));
    h.s!.onopen!();
    h.s!.reply('c201030a0100');
    await expect(p).resolves.toEqual({ kind: 'offline' });
    const p2 = checkPeer('123456789', 'wss://x', open(h));
    h.s!.reply('5a0418023a00');
    await expect(p2).resolves.toMatchObject({ kind: 'error' });
  });

  test('checkPeers asks once for many ids and maps the bits MSB first', async () => {
    const h: { s?: FakeSocket } = {};
    const p = checkPeers(['1', 'bad id', '2', '3'], 'wss://x', open(h));
    h.s!.onopen!();
    expect(h.s!.sent).toHaveLength(1);
    h.s!.reply('c201030a01a0');
    const r = await p;
    expect(r.ok && [...r.online]).toEqual([['1', true], ['2', false], ['3', true]]);
  });

  test('relaySocketUrl follows the official client: domains drop the port, IPs add 2', () => {
    expect(relaySocketUrl('rs-ny.rustdesk.com:21117', 'x')).toBe('wss://rs-ny.rustdesk.com/ws/relay');
    expect(relaySocketUrl('rs-ny.rustdesk.com', 'x')).toBe('wss://rs-ny.rustdesk.com/ws/relay');
    expect(relaySocketUrl('1.2.3.4:21117', 'x')).toBe('wss://1.2.3.4:21119');
    expect(relaySocketUrl('1.2.3.4', 'x')).toBe('wss://1.2.3.4:21119');
    expect(relaySocketUrl('', 'wss://srv.example.com/ws/id')).toBe('wss://srv.example.com/ws/relay');
    expect(relaySocketUrl('ws://h:1/ws/relay', 'x')).toBe('ws://h:1/ws/relay');
  });

  test('errors on a closed socket, garbage and timeout; rejects a bad id without a socket', async () => {
    const h: { s?: FakeSocket } = {};
    const p = checkPeer('1', 'wss://x', open(h));
    h.s!.onclose!();
    await expect(p).resolves.toMatchObject({ kind: 'error' });
    const g = checkPeer('1', 'wss://x', open(h));
    h.s!.reply('0a');
    await expect(g).resolves.toMatchObject({ kind: 'error' });
    vi.useFakeTimers();
    const t = checkPeer('1', 'wss://x', open(h), 50);
    await vi.advanceTimersByTimeAsync(60);
    await expect(t).resolves.toMatchObject({ kind: 'error' });
    vi.useRealTimers();
    const factory = vi.fn();
    await expect(checkPeer('bad id', 'wss://x', factory)).resolves.toMatchObject({ kind: 'error' });
    expect(factory).not.toHaveBeenCalled();
  });
});
