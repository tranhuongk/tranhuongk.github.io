import { describe, expect, test, vi } from 'vitest';
import {
  candidateInit, decodeEndpoint, encodeEndpoint, fingerprintOf, fragment, isMdnsCandidate, Reassembler, stripCandidates,
  WebRtcTransport,
} from './webrtc';

const SDP = [
  'v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=fingerprint:sha-256 AA:BB:CC',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'a=candidate:1 1 udp 1 192.0.2.1 5000 typ host',
  'a=end-of-candidates', 'a=fingerprint:sha-256 DD:EE', 'a=mid:0', '',
].join('\r\n');

describe('webrtc envelope', () => {
  test('strips candidate lines and keeps CRLF', () => {
    const out = stripCandidates(SDP);
    expect(out).not.toContain('a=candidate');
    expect(out).not.toContain('end-of-candidates');
    expect(out.endsWith('a=mid:0\r\n')).toBe(true);
  });

  test('encodes and decodes the offer/answer envelope with the ice policy', () => {
    const text = encodeEndpoint('offer', SDP);
    expect(text.startsWith('webrtc://')).toBe(true);
    const json = JSON.parse(atob(text.slice('webrtc://'.length)));
    expect(json).toMatchObject({ type: 'offer', ice_policy: 'all' });
    expect(decodeEndpoint(text)).toEqual({ type: 'offer', sdp: stripCandidates(SDP) });
    expect(() => decodeEndpoint('nope')).toThrow('Invalid WebRTC endpoint format');
    expect(() => decodeEndpoint('webrtc://' + btoa('{"type":1}'))).toThrow('lacks a session description');
  });

  test('fingerprint: session level first, else the application section', () => {
    expect(fingerprintOf(SDP)).toBe('sha-256 AA:BB:CC');
    expect(fingerprintOf('v=0\r\nm=audio 9 x\r\na=fingerprint:sha-256 11\r\nm=application 9 x\r\na=fingerprint:sha-256 22\r\n')).toBe('sha-256 22');
    expect(fingerprintOf('v=0\r\n')).toBe('');
  });

  test('candidate JSON → init, and mDNS candidates are recognised', () => {
    expect(candidateInit('{"candidate":"c","sdpMid":"0","sdpMLineIndex":0,"usernameFragment":"u"}')).toEqual({
      candidate: 'c', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'u',
    });
    expect(candidateInit('{"candidate":"c"}')).toEqual({ candidate: 'c', sdpMLineIndex: 0 });
    expect(() => candidateInit('{}')).toThrow();
    expect(isMdnsCandidate(JSON.stringify({ candidate: 'candidate:1 1 udp 1 abcd.local 5000 typ host' }))).toBe(true);
    expect(isMdnsCandidate(JSON.stringify({ candidate: 'candidate:1 1 udp 1 192.0.2.1 5000 typ host' }))).toBe(false);
  });
});

describe('fragments', () => {
  test('a small message is one END fragment; a large one is MORE… END and reassembles', () => {
    expect(fragment(new Uint8Array([7, 8]))).toEqual([new Uint8Array([0, 7, 8])]);
    const big = Uint8Array.from({ length: 250 }, (_, i) => i % 256);
    const parts = fragment(big, 100);
    expect(parts.map((p) => [p[0], p.length])).toEqual([[1, 101], [1, 101], [0, 51]]);
    const r = new Reassembler();
    expect(r.push(parts[0]!)).toBeUndefined();
    expect(r.push(parts[1]!)).toBeUndefined();
    expect(r.push(parts[2]!)).toEqual(big);
    expect(r.push(new Uint8Array([0, 1]))).toEqual(new Uint8Array([1]));
  });

  test('rejects an empty frame, a bare MORE and an unknown header', () => {
    const r = new Reassembler();
    expect(() => r.push(new Uint8Array())).toThrow('empty');
    expect(() => r.push(new Uint8Array([1]))).toThrow('no payload');
    expect(() => r.push(new Uint8Array([9, 1]))).toThrow('neither');
  });
});

class FakeDc {
  binaryType = '';
  readyState = 'connecting';
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
  send(b: Uint8Array) {
    this.sent.push(b);
  }
  close() {}
}

class FakePc {
  dc = new FakeDc();
  onicecandidate: ((e: { candidate: { candidate: string; toJSON(): unknown } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState = 'new';
  added: unknown[] = [];
  remote: unknown;
  stats = new Map<string, unknown>();
  createDataChannel() {
    return this.dc;
  }
  async createOffer() {
    return { type: 'offer', sdp: SDP };
  }
  async setLocalDescription() {}
  async setRemoteDescription(d: unknown) {
    this.remote = d;
  }
  async addIceCandidate(c: unknown) {
    this.added.push(c);
  }
  async getStats() {
    return this.stats;
  }
  close() {}
}

const make = () => {
  const pc = new FakePc();
  const t = new WebRtcTransport([], () => pc as unknown as RTCPeerConnection);
  return { pc, t };
};

describe('WebRtcTransport', () => {
  test('createOffer gives the envelope and fixes the session key', async () => {
    const { t } = make();
    const text = await t.createOffer();
    expect(decodeEndpoint(text).type).toBe('offer');
    expect(t.sessionKey).toBe('sha-256 AA:BB:CC');
  });

  test('remote candidates wait for the answer, then are added', async () => {
    const { pc, t } = make();
    await t.createOffer();
    await t.addRemoteCandidate('{"candidate":"c1"}');
    expect(pc.added).toEqual([]);
    await t.setRemoteAnswer(encodeEndpoint('answer', SDP));
    expect(pc.added).toEqual([{ candidate: 'c1', sdpMLineIndex: 0 }]);
    expect(t.remoteFingerprint).toBe('sha-256 AA:BB:CC');
    await t.addRemoteCandidate('{"candidate":"c2"}');
    expect(pc.added).toHaveLength(2);
  });

  test('local candidates reach the handler, including ones gathered before it was set', () => {
    const { pc, t } = make();
    const cand = (c: string) => ({ candidate: { candidate: c, toJSON: () => ({ candidate: c }) } });
    pc.onicecandidate!(cand('early'));
    const seen: string[] = [];
    t.onLocalCandidate((c) => seen.push(c));
    pc.onicecandidate!(cand('late'));
    pc.onicecandidate!({ candidate: null });
    expect(seen).toEqual(['{"candidate":"early"}', '{"candidate":"late"}']);
  });

  test('open, send (fragmented), receive (reassembled) and close', async () => {
    const { pc, t } = make();
    const opened = t.waitOpen(1000);
    pc.dc.readyState = 'open';
    pc.dc.onopen!();
    await opened;
    t.send(new Uint8Array(130_000));
    expect(pc.dc.sent.map((p) => [p[0], p.length])).toEqual([[1, 60_001], [1, 60_001], [0, 10_001]]);
    const msg = t.next(1000);
    pc.dc.onmessage!({ data: new Uint8Array([0, 5, 6]).buffer });
    await expect(msg).resolves.toEqual(new Uint8Array([5, 6]));
    const pending = t.next(1000);
    t.close();
    await expect(pending).rejects.toThrow();
  });

  test('waitOpen times out; a corrupt fragment fails the transport', async () => {
    vi.useFakeTimers();
    const { pc, t } = make();
    const open = t.waitOpen(50);
    const assertion = expect(open).rejects.toThrow('quá thời gian');
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    vi.useRealTimers();
    const pending = t.next(1000);
    pc.dc.onmessage!({ data: new Uint8Array([9]).buffer });
    await expect(pending).rejects.toThrow('neither');
  });

  test('isRelayed reads the selected candidate pair', async () => {
    const { pc, t } = make();
    pc.stats.set('T', { type: 'transport', selectedCandidatePairId: 'P' });
    pc.stats.set('P', { type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' });
    pc.stats.set('L', { type: 'local-candidate', candidateType: 'srflx' });
    pc.stats.set('R', { type: 'remote-candidate', candidateType: 'host' });
    expect(await t.isRelayed()).toBe(false);
    pc.stats.set('R', { type: 'remote-candidate', candidateType: 'relay' });
    expect(await t.isRelayed()).toBe(true);
  });
});
