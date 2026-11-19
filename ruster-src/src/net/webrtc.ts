// WebRTC data channel to the peer, negotiated through the ID server like the official web client:
//   offer  → `webrtc://` + base64({"type":"offer","sdp":<SDP without candidate lines>,"ice_policy":"all"})
//   answer → the same envelope in RelayResponse.webrtc_sdp_answer
//   ICE    → candidate JSON in RendezvousMessage.ice_candidate, keyed by the offer's DTLS fingerprint
// Messages travel on one ordered data channel, cut into ≤ 60000-byte fragments with a 1-byte
// header (1 = more follows, 0 = last).
import type { SecretStream } from './crypto';
import type { Transport } from './transport';
import { PipeError } from './pipe';

export const WEBRTC_PREFIX = 'webrtc://';
export const FRAGMENT_SIZE = 60_000;
export const MAX_MESSAGE = 1_073_741_823;
const FRAG_END = 0;
const FRAG_MORE = 1;
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

const toBase64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** The SDP without candidate lines (they travel separately over the ID server), CRLF terminated. */
export function stripCandidates(sdp: string): string {
  const lines = sdp.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.filter((l) => !l.startsWith('a=candidate:') && !l.startsWith('a=end-of-candidates')).map((l) => `${l}\r\n`).join('');
}

export function encodeEndpoint(type: 'offer' | 'answer', sdp: string, icePolicy = 'all'): string {
  const body: Record<string, string> = { type, sdp: stripCandidates(sdp), ice_policy: icePolicy };
  return WEBRTC_PREFIX + toBase64(new TextEncoder().encode(JSON.stringify(body)));
}

export function decodeEndpoint(text: string): { type: string; sdp: string } {
  if (!text.startsWith(WEBRTC_PREFIX)) throw new Error('Invalid WebRTC endpoint format');
  let parsed: { type?: unknown; sdp?: unknown };
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64(text.slice(WEBRTC_PREFIX.length))));
  } catch (e) {
    throw new Error(`Failed to decode WebRTC endpoint: ${(e as Error).message}`);
  }
  if (typeof parsed.type !== 'string' || typeof parsed.sdp !== 'string') throw new Error('WebRTC endpoint lacks a session description');
  return { type: parsed.type, sdp: parsed.sdp };
}

/** DTLS fingerprint: the session-level one, else the one of the application section. */
export function fingerprintOf(sdp: string): string {
  let sessionLevel = true;
  let inApplication = false;
  let application = '';
  for (const raw of sdp.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith('m=')) {
      sessionLevel = false;
      inApplication = line.startsWith('m=application');
      continue;
    }
    if (!line.startsWith('a=fingerprint:')) continue;
    const value = line.slice('a=fingerprint:'.length).trim();
    if (sessionLevel) return value;
    if (inApplication && !application) application = value;
  }
  return application;
}

export function fragment(bytes: Uint8Array, size = FRAGMENT_SIZE): Uint8Array[] {
  if (bytes.length > MAX_MESSAGE) throw new Error('Overflow');
  const out: Uint8Array[] = [];
  let at = 0;
  do {
    const end = Math.min(at + size, bytes.length);
    const piece = new Uint8Array(1 + end - at);
    piece[0] = end >= bytes.length ? FRAG_END : FRAG_MORE;
    piece.set(bytes.subarray(at, end), 1);
    out.push(piece);
    at = end;
  } while (at < bytes.length);
  return out;
}

export class Reassembler {
  private parts: Uint8Array[] = [];
  private length = 0;

  /** The whole message when `piece` completes one, otherwise undefined. */
  push(piece: Uint8Array): Uint8Array | undefined {
    if (piece.length === 0) this.fail('WebRTC data channel ended (reset or empty message)');
    const header = piece[0];
    if (header === FRAG_MORE && piece.length === 1) this.fail('WebRTC FRAG_MORE fragment carries no payload');
    if (header !== FRAG_END && header !== FRAG_MORE) this.fail(`WebRTC fragment header ${header} is neither FRAG_END nor FRAG_MORE`);
    const body = piece.subarray(1);
    if (this.length + body.length > MAX_MESSAGE) this.fail('WebRTC reassembled message exceeded maximum frame size');
    if (header === FRAG_END && this.parts.length === 0) return body;
    this.parts.push(body);
    this.length += body.length;
    if (header === FRAG_MORE) return undefined;
    const whole = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      whole.set(p, at);
      at += p.length;
    }
    this.reset();
    return whole;
  }

  private reset(): void {
    this.parts = [];
    this.length = 0;
  }

  private fail(message: string): never {
    this.reset();
    throw new Error(message);
  }
}

export function candidateInit(json: string): RTCIceCandidateInit {
  const e = JSON.parse(json) as { candidate?: unknown; sdpMid?: unknown; sdpMLineIndex?: unknown; usernameFragment?: unknown };
  if (typeof e.candidate !== 'string') throw new Error('ICE candidate JSON lacks a candidate string');
  const init: RTCIceCandidateInit = { candidate: e.candidate };
  if (typeof e.sdpMid === 'string' && e.sdpMid !== '') init.sdpMid = e.sdpMid;
  if (typeof e.sdpMLineIndex === 'number') init.sdpMLineIndex = e.sdpMLineIndex;
  else if (init.sdpMid === undefined) init.sdpMLineIndex = 0;
  if (typeof e.usernameFragment === 'string') init.usernameFragment = e.usernameFragment;
  return init;
}

/** mDNS (`xxxx.local`) candidates hide a LAN address the ID server could not use anyway. */
export function isMdnsCandidate(json: string): boolean {
  try {
    const c = (JSON.parse(json) as { candidate?: string }).candidate ?? '';
    return /\.local(\s|$)/i.test(c.split(/\s+/)[4] ?? '');
  } catch {
    return false;
  }
}

export type PeerConnectionFactory = (config: RTCConfiguration) => RTCPeerConnection;
const defaultFactory: PeerConnectionFactory = (config) => new RTCPeerConnection(config);

export class WebRtcTransport implements Transport {
  readonly sessionKey: string = '';
  remoteFingerprint = '';
  private readonly pc: RTCPeerConnection;
  private readonly dc: RTCDataChannel;
  private readonly reassembler = new Reassembler();
  private queue: Uint8Array[] = [];
  private waiter: { resolve: (b: Uint8Array) => void; reject: (e: Error) => void } | null = null;
  private failure: PipeError | null = null;
  private opened = false;
  private openWaiters: { resolve: () => void; reject: (e: Error) => void }[] = [];
  private remoteSet = false;
  private pendingRemote: string[] = [];
  private localHandler: ((candidate: string) => void) | null = null;
  private pendingLocal: string[] = [];
  private closed = false;

  static isSupported(): boolean {
    return typeof RTCPeerConnection === 'function';
  }

  constructor(iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS, factory: PeerConnectionFactory = defaultFactory) {
    this.pc = factory({ iceServers, iceTransportPolicy: 'all' });
    this.dc = this.pc.createDataChannel('bootstrap', { ordered: true });
    this.dc.binaryType = 'arraybuffer';
    this.dc.onopen = () => {
      this.opened = true;
      for (const w of this.openWaiters.splice(0)) w.resolve();
    };
    this.dc.onclose = () => this.fail('WebRTC data channel closed');
    this.dc.onmessage = (event) => this.receive(event);
    this.pc.onicecandidate = (event) => {
      if (!event.candidate || !event.candidate.candidate) return;
      const json = JSON.stringify(event.candidate.toJSON());
      if (this.localHandler) this.localHandler(json);
      else this.pendingLocal.push(json);
    };
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'failed' || state === 'closed') this.fail(`WebRTC connection ${state}`);
    };
  }

  /** The offer envelope for the ID server; also fixes `sessionKey`. */
  async createOffer(): Promise<string> {
    const offer = await this.pc.createOffer();
    const sdp = offer.sdp ?? '';
    const key = fingerprintOf(sdp);
    if (!key) throw new Error('SDP fingerprint attribute not found');
    (this as { sessionKey: string }).sessionKey = key;
    await this.pc.setLocalDescription(offer);
    return encodeEndpoint('offer', sdp);
  }

  async setRemoteAnswer(envelope: string): Promise<void> {
    const { type, sdp } = decodeEndpoint(envelope);
    this.remoteFingerprint = fingerprintOf(sdp);
    await this.pc.setRemoteDescription({ type: type as RTCSdpType, sdp });
    this.remoteSet = true;
    for (const c of this.pendingRemote.splice(0)) await this.addCandidate(c);
  }

  async addRemoteCandidate(json: string): Promise<void> {
    if (!json) return;
    if (!this.remoteSet) {
      if (this.pendingRemote.length >= 64) this.pendingRemote.shift();
      this.pendingRemote.push(json);
      return;
    }
    await this.addCandidate(json);
  }

  private async addCandidate(json: string): Promise<void> {
    try {
      await this.pc.addIceCandidate(candidateInit(json));
    } catch {
      // a bad or late candidate must not break the session
    }
  }

  onLocalCandidate(handler: ((candidate: string) => void) | null): void {
    this.localHandler = handler;
    if (handler) for (const c of this.pendingLocal.splice(0)) handler(c);
  }

  waitOpen(timeoutMs: number): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.opened) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.openWaiters = this.openWaiters.filter((w) => w !== waiter);
        reject(new PipeError('timeout', 'WebRTC: quá thời gian kết nối'));
      }, timeoutMs);
      const waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e: Error) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.openWaiters.push(waiter);
    });
  }

  /** True when the selected ICE pair goes through a TURN relay (not a direct path). */
  async isRelayed(): Promise<boolean> {
    const stats = await this.pc.getStats();
    let pair: RTCStats & { localCandidateId?: string; remoteCandidateId?: string; nominated?: boolean; state?: string } | undefined;
    stats.forEach((s) => {
      if (s.type === 'transport' && (s as { selectedCandidatePairId?: string }).selectedCandidatePairId) {
        pair = stats.get((s as { selectedCandidatePairId: string }).selectedCandidatePairId) ?? pair;
      }
    });
    if (!pair) {
      stats.forEach((s) => {
        const c = s as typeof pair & { type: string };
        if (c?.type === 'candidate-pair' && c.nominated && c.state === 'succeeded') pair = c;
      });
    }
    if (!pair) return true;
    const kind = (id?: string) => (id ? (stats.get(id) as { candidateType?: string } | undefined)?.candidateType : undefined);
    return kind(pair.localCandidateId) === 'relay' || kind(pair.remoteCandidateId) === 'relay';
  }

  secure(_stream: SecretStream): void {
    // DTLS already encrypts the channel.
  }

  send(bytes: Uint8Array): void {
    if (this.closed || this.dc.readyState !== 'open') return;
    for (const piece of fragment(bytes)) this.dc.send(piece as Uint8Array<ArrayBuffer>);
  }

  private receive(event: MessageEvent): void {
    if (!(event.data instanceof ArrayBuffer)) return;
    let whole: Uint8Array | undefined;
    try {
      whole = this.reassembler.push(new Uint8Array(event.data));
    } catch (e) {
      this.fail((e as Error).message);
      return;
    }
    if (!whole) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w.resolve(whole);
    } else this.queue.push(whole);
  }

  next(timeoutMs?: number): Promise<Uint8Array> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === undefined ? null : setTimeout(() => {
          this.waiter = null;
          reject(new PipeError('timeout', 'WebRTC: không nhận được phản hồi'));
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

  private fail(message: string): void {
    if (this.failure) return;
    this.failure = new PipeError('closed', message);
    this.waiter?.reject(this.failure);
    this.waiter = null;
    for (const w of this.openWaiters.splice(0)) w.reject(this.failure);
    this.teardown();
  }

  private teardown(): void {
    this.closed = true;
    this.dc.onmessage = null;
    this.dc.onclose = null;
    this.pc.onconnectionstatechange = null;
    this.pc.onicecandidate = null;
    try {
      this.dc.close();
    } catch {
      // already closed
    }
    try {
      this.pc.close();
    } catch {
      // already closed
    }
  }

  close(): void {
    if (this.closed) return;
    this.failure ??= new PipeError('closed', 'WebRTC: đã đóng');
    this.waiter?.reject(this.failure);
    this.waiter = null;
    for (const w of this.openWaiters.splice(0)) w.reject(this.failure);
    this.teardown();
  }
}
