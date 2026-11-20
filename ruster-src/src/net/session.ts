// One RustDesk viewing session over the relay (web client flow):
//   ID server  ──PunchHoleRequest(force_relay)──▶  RelayResponse {uuid, relay, signed peer key}
//   relay      ──RequestRelay(uuid)──▶  peer's SignedId ──▶ our sealed key ──▶ secretbox frames
//   peer       ──Hash──▶ LoginRequest(proof) ──▶ LoginResponse ──▶ VideoFrame...
import { CONTROL_KEY, decodeIdPk, decodeMessage, encodeKey, encodeLoginRequest, encodeMouse, encodePublicKey,
  encodeRefreshVideo, encodeShowRemoteCursor, encodeTestDelayEcho, encodeVideoReceived, type KeyInput, type PeerSummary, type VideoChunk } from '../proto/message';
import { CLIENT_VERSION, decodeConnectReply, encodeIceCandidate, encodePunchHoleRequest, encodeRequestRelay, type RelayOffer } from '../proto/rendezvous';
import { fromBase64, loginProof, makeKeyOffer, openSigned, PUBLIC_SERVER_KEY, SecretStream } from './crypto';
import { Pipe, PipeError } from './pipe';
import { idSocketUrl, relaySocketUrl, type SocketFactory } from './rendezvous';
import type { Transport } from './transport';
import { DEFAULT_ICE_SERVERS, isMdnsCandidate, WebRtcTransport, type PeerConnectionFactory } from './webrtc';

export class SessionError extends Error {
  constructor(readonly kind: 'offline' | 'refused' | 'auth' | 'old' | 'handshake' | 'login' | 'transport' | 'codec', message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

export interface SessionEvents {
  status(text: string): void;
  /** The peer wants a password (first time, or after a wrong one). */
  needPassword(reason: string | null): void;
  ready(peer: PeerSummary): void;
  video(frames: VideoChunk[]): void;
  /** Round-trip time in ms measured by the peer (sent about once a second). */
  delay?(ms: number): void;
  closed(error: SessionError | null): void;
}

export interface SessionOptions {
  peerId: string;
  server: string;
  password?: string;
  events: SessionEvents;
  open?: SocketFactory;
  serverKey?: string;
  random?: (n: number) => Uint8Array;
  /** Peer id shown on the other side; any label. */
  myId?: string;
  myName?: string;
  /** Try a direct WebRTC channel next to the relay (default: when the browser has WebRTC). */
  webrtc?: boolean;
  peerConnection?: PeerConnectionFactory;
  iceServers?: RTCIceServer[];
  /** RustDesk account access token; the public server only serves logged-in controllers. */
  token?: string;
  /** Have the peer draw its cursor into the video (default on). */
  showRemoteCursor?: boolean;
  /** How long the relay waits for WebRTC to open before being used (ms). */
  webrtcGraceMs?: number;
}

/** The public server refuses controllers that are not logged in with a message that says so. */
const LOGIN_REQUIRED = /log ?in/i;
const STEP_TIMEOUT_MS = 30_000;
export const WEBRTC_OPEN_MS = 10_000;
export const WEBRTC_GRACE_MS = 3_000;
const ICE_RESEND_MS = 400;

export class RustSession {
  private relay: Transport | null = null;
  private idPipe: Pipe | null = null;
  /** Which path carries the session: shown in the status line and Diagnostics. */
  path: 'relay' | 'webrtc' | null = null;
  private password: string | null;
  private hash: { salt: string; challenge: string } | null = null;
  private done = false;
  private readonly open: SocketFactory;

  constructor(private readonly o: SessionOptions) {
    this.password = o.password ?? null;
    this.open = o.open ?? ((url) => new WebSocket(url));
  }

  /** Runs the whole session; resolves when it ends. Errors are reported through `events.closed`. */
  async run(): Promise<void> {
    try {
      await this.connect();
      await this.pump();
      this.finish(null);
    } catch (e) {
      this.finish(this.asError(e));
    }
  }

  private asError(e: unknown): SessionError | null {
    if (this.done) return null;
    if (e instanceof SessionError) return e;
    if (e instanceof PipeError) return new SessionError('transport', e.message);
    return new SessionError('transport', (e as Error).message);
  }

  private finish(error: SessionError | null): void {
    if (this.done) return;
    this.done = true;
    this.relay?.close();
    this.idPipe?.close();
    this.o.events.closed(error);
  }

  close(): void {
    this.finish(null);
  }

  private status(text: string): void {
    this.o.events.status(text);
  }

  private async connect(): Promise<void> {
    const t0 = Date.now();
    const step = (text: string) => this.status(`${text} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    step('Hỏi máy chủ RustDesk…');
    const id = new Pipe(this.open(idSocketUrl(this.o.server)), 'ID server');
    this.idPipe = id;
    await id.open();

    let rtc: WebRtcTransport | null = null;
    let offerEnvelope = '';
    if (this.o.webrtc ?? WebRtcTransport.isSupported()) {
      try {
        rtc = new WebRtcTransport(this.o.iceServers ?? DEFAULT_ICE_SERVERS, this.o.peerConnection);
        offerEnvelope = await rtc.createOffer();
        const sendCandidate = (candidate: string) => {
          if (isMdnsCandidate(candidate)) return;
          const bytes = encodeIceCandidate(this.o.peerId, rtc!.sessionKey, candidate);
          try {
            id.send(bytes);
            setTimeout(() => {
              if (!this.done) {
                try {
                  id.send(bytes);
                } catch {
                  // ID socket closed: the first copy was enough
                }
              }
            }, ICE_RESEND_MS);
          } catch {
            // ID socket closed
          }
        };
        rtc.onLocalCandidate(sendCandidate);
      } catch {
        rtc?.close();
        rtc = null;
        offerEnvelope = '';
      }
    }

    id.send(encodePunchHoleRequest(this.o.peerId, '', offerEnvelope, this.o.token ?? ''));
    const offer = await this.awaitRelayOffer(id, rtc);
    step('Máy chủ đã trả lời');
    // Keep feeding the peer's ICE candidates to WebRTC while the transports race.
    void this.pumpIce(id, rtc);
    if (offer.refuseReason) throw new SessionError(LOGIN_REQUIRED.test(offer.refuseReason) ? 'auth' : 'refused', offer.refuseReason);
    if (!offer.version) throw new SessionError('old', 'Phiên bản RustDesk bên máy đích quá cũ, không hỗ trợ web.');

    if (rtc && offer.webrtcAnswer) {
      try {
        await rtc.setRemoteAnswer(offer.webrtcAnswer);
      } catch {
        rtc.close();
        rtc = null;
      }
    } else {
      rtc?.close();
      rtc = null;
    }

    step('Nối relay…');
    const relayPromise = this.openRelay(offer);
    const chosen = await this.chooseTransport(relayPromise, rtc);
    this.relay = chosen.transport;
    this.path = chosen.path;
    await this.secure(chosen.transport, offer.signedPk, chosen.path === 'webrtc' ? rtc : null);
    id.close();
    step(chosen.path === 'webrtc' ? 'Đã mã hoá (WebRTC trực tiếp), chờ máy đích…' : 'Đã mã hoá (relay), chờ máy đích…');
  }

  private async awaitRelayOffer(id: Pipe, rtc: WebRtcTransport | null): Promise<RelayOffer> {
    for (;;) {
      const reply = decodeConnectReply(await id.next(STEP_TIMEOUT_MS));
      if (reply.kind === 'relay') return reply.offer;
      if (reply.kind === 'failure') {
        if (LOGIN_REQUIRED.test(reply.detail)) throw new SessionError('auth', reply.detail);
        throw new SessionError('offline', reply.detail || 'Máy đích không trực tuyến hoặc ID không tồn tại.');
      }
      if (reply.kind === 'ice') {
        if (rtc && reply.sessionKey === rtc.sessionKey) void rtc.addRemoteCandidate(reply.candidate);
        continue;
      }
      throw new SessionError('handshake', `Phản hồi lạ từ máy chủ (trường ${reply.field}).`);
    }
  }

  /** After the offer is answered, the ID socket still carries the peer's candidates. */
  private async pumpIce(id: Pipe, rtc: WebRtcTransport | null): Promise<void> {
    try {
      while (!this.done) {
        const reply = decodeConnectReply(await id.next());
        if (rtc && reply.kind === 'ice' && reply.sessionKey === rtc.sessionKey) void rtc.addRemoteCandidate(reply.candidate);
      }
    } catch {
      // the ID socket closes once the transport is chosen
    } finally {
      id.close();
    }
  }

  private async openRelay(offer: RelayOffer): Promise<Pipe> {
    const relay = new Pipe(this.open(relaySocketUrl(offer.relayServer, this.o.server)), 'relay');
    try {
      await relay.open();
    } catch (e) {
      relay.close();
      throw e;
    }
    relay.send(encodeRequestRelay(offer.uuid));
    return relay;
  }

  /** Direct WebRTC wins when it opens (within the grace window) over a non-TURN path; otherwise the relay. */
  private async chooseTransport(
    relayPromise: Promise<Pipe>,
    rtc: WebRtcTransport | null,
  ): Promise<{ transport: Transport; path: 'relay' | 'webrtc' }> {
    const settled = <T>(p: Promise<T>) => p.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
    const relay = settled(relayPromise);
    if (!rtc) {
      const r = await relay;
      if (!r.ok) throw r.error;
      return { transport: r.value, path: 'relay' };
    }
    const grace = this.o.webrtcGraceMs ?? WEBRTC_GRACE_MS;
    const direct = settled(rtc.waitOpen(WEBRTC_OPEN_MS).then(async () => ((await rtc.isRelayed()) ? Promise.reject(new Error('turn')) : true)));
    const first = await Promise.race([relay.then(() => 'relay' as const), direct.then(() => 'rtc' as const)]);
    let useRtc: boolean;
    if (first === 'rtc') useRtc = (await direct).ok;
    else {
      const window = new Promise<'late'>((resolve) => setTimeout(() => resolve('late'), grace));
      const second = await Promise.race([direct, window]);
      useRtc = second !== 'late' && second.ok;
    }
    const r = await relay;
    if (useRtc) {
      if (r.ok) r.value.close();
      return { transport: rtc, path: 'webrtc' };
    }
    rtc.close();
    if (!r.ok) throw r.error;
    return { transport: r.value, path: 'relay' };
  }

  private async secure(transport: Transport, signedPk: Uint8Array, rtc: WebRtcTransport | null): Promise<void> {
    const serverKey = fromBase64(this.o.serverKey ?? PUBLIC_SERVER_KEY);
    const vouched = signedPk.length ? openSigned(signedPk, serverKey) : null;
    if (!vouched) throw new SessionError('handshake', 'Chữ ký khoá của máy chủ RustDesk không hợp lệ.');
    const vouchedPeer = decodeIdPk(vouched);
    if (vouchedPeer.id !== this.o.peerId || vouchedPeer.pk.length !== 32) {
      throw new SessionError('handshake', 'Khoá do máy chủ cấp không khớp ID máy đích.');
    }
    const first = decodeMessage(await transport.next(STEP_TIMEOUT_MS));
    if (first.kind !== 'signedId') throw new SessionError('handshake', 'Máy đích không gửi danh tính đã ký.');
    const opened = openSigned(first.id, vouchedPeer.pk);
    if (!opened) throw new SessionError('handshake', 'Danh tính của máy đích không xác minh được.');
    const peer = decodeIdPk(opened);
    if (peer.id !== this.o.peerId || peer.pk.length !== 32) {
      throw new SessionError('handshake', 'Danh tính của máy đích không khớp ID.');
    }
    if (rtc && (!peer.dtlsFingerprint || peer.dtlsFingerprint !== rtc.remoteFingerprint)) {
      throw new SessionError('handshake', 'Chứng chỉ DTLS của kênh WebRTC không khớp danh tính máy đích (có thể bị chen giữa).');
    }
    const offer = makeKeyOffer(peer.pk, this.o.random);
    transport.send(encodePublicKey(offer.asymmetric, offer.symmetric));
    if (!rtc) transport.secure(new SecretStream(offer.key));
  }

  submitPassword(password: string): void {
    this.password = password;
    if (this.hash) void this.login();
  }

  private async login(): Promise<void> {
    const relay = this.relay;
    if (!relay || !this.hash) return;
    if (this.password === null) {
      this.o.events.needPassword(null);
      return;
    }
    const proof = await loginProof(this.password, this.hash.salt, this.hash.challenge);
    this.status('Đăng nhập…');
    const random = this.o.random ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
    const sessionId = new DataView(random(8).buffer as ArrayBuffer).getUint32(0, true);
    relay.send(
      encodeLoginRequest({
        targetId: this.o.peerId,
        myId: this.o.myId ?? 'ruster',
        myName: this.o.myName ?? 'ruster',
        password: proof,
        sessionId,
        version: CLIENT_VERSION,
        platform: 'Web',
        showRemoteCursor: this.o.showRemoteCursor ?? true,
      }),
    );
  }

  private async pump(): Promise<void> {
    const relay = this.relay;
    if (!relay) return;
    for (;;) {
      const frame = await relay.next();
      let msg: ReturnType<typeof decodeMessage>;
      try {
        msg = decodeMessage(frame);
      } catch {
        continue; // one undecodable message must not end the session
      }
      switch (msg.kind) {
        case 'hash':
          this.hash = { salt: msg.salt, challenge: msg.challenge };
          await this.login();
          break;
        case 'loginResponse':
          if (msg.error) {
            this.password = null;
            this.o.events.needPassword(msg.error);
          } else if (msg.peer) {
            this.status('Đã đăng nhập.');
            this.o.events.ready(msg.peer);
          }
          break;
        case 'video':
          if (msg.codec !== 'vp9') throw new SessionError('codec', `Máy đích gửi codec ${msg.codec}, ruster mới hỗ trợ VP9.`);
          relay.send(encodeVideoReceived());
          this.o.events.video(msg.frames);
          break;
        case 'testDelay':
          relay.send(encodeTestDelayEcho(msg.raw));
          if (msg.lastDelay > 0) this.o.events.delay?.(msg.lastDelay);
          break;
        default:
          break;
      }
    }
  }

  // --- input -------------------------------------------------------------------------------

  private canSend(): boolean {
    return !this.done && this.relay !== null;
  }

  sendMouse(type: number, button: number, x: number, y: number): void {
    if (this.canSend()) this.relay!.send(encodeMouse(type, button, x, y));
  }

  sendKey(key: KeyInput): void {
    if (this.canSend()) this.relay!.send(encodeKey(key));
  }

  setShowRemoteCursor(on: boolean): void {
    if (this.canSend()) this.relay!.send(encodeShowRemoteCursor(on));
  }

  /** Ctrl+Alt+Del the way the official client sends it (Windows has its own key, others Alt+Ctrl+Delete). */
  sendCtrlAltDel(platform: string): void {
    if (platform === 'Windows') this.sendKey({ down: true, controlKey: CONTROL_KEY.CtrlAltDel });
    else this.sendKey({ down: true, controlKey: CONTROL_KEY.Delete, modifiers: [CONTROL_KEY.Alt, CONTROL_KEY.Control] });
  }

  requestKeyFrame(): void {
    if (this.canSend()) this.relay!.send(encodeRefreshVideo());
  }
}
