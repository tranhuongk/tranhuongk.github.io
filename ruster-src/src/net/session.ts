// One RustDesk viewing session over the relay (web client flow):
//   ID server  ──PunchHoleRequest(force_relay)──▶  RelayResponse {uuid, relay, signed peer key}
//   relay      ──RequestRelay(uuid)──▶  peer's SignedId ──▶ our sealed key ──▶ secretbox frames
//   peer       ──Hash──▶ LoginRequest(proof) ──▶ LoginResponse ──▶ VideoFrame...
import { decodeIdPk, decodeMessage, encodeKey, encodeLoginRequest, encodeMouse, encodePublicKey,
  encodeRefreshVideo, encodeTestDelayEcho, encodeVideoReceived, type KeyInput, type PeerSummary, type VideoChunk } from '../proto/message';
import { CLIENT_VERSION, decodeConnectReply, encodePunchHoleRequest, encodeRequestRelay } from '../proto/rendezvous';
import { fromBase64, loginProof, makeKeyOffer, openSigned, PUBLIC_SERVER_KEY, SecretStream } from './crypto';
import { Pipe, PipeError } from './pipe';
import { idSocketUrl, relaySocketUrl, type SocketFactory } from './rendezvous';

export class SessionError extends Error {
  constructor(readonly kind: 'offline' | 'refused' | 'old' | 'handshake' | 'login' | 'transport' | 'codec', message: string) {
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
}

const STEP_TIMEOUT_MS = 15_000;

export class RustSession {
  private relay: Pipe | null = null;
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
    this.o.events.closed(error);
  }

  close(): void {
    this.finish(null);
  }

  private status(text: string): void {
    this.o.events.status(text);
  }

  private async connect(): Promise<void> {
    this.status('Hỏi máy chủ RustDesk…');
    const id = new Pipe(this.open(idSocketUrl(this.o.server)), 'ID server');
    await id.open();
    id.send(encodePunchHoleRequest(this.o.peerId));
    const reply = decodeConnectReply(await id.next(STEP_TIMEOUT_MS));
    id.close();
    if (reply.kind === 'failure') {
      throw new SessionError('offline', reply.detail || 'Máy đích không trực tuyến hoặc ID không tồn tại.');
    }
    if (reply.kind !== 'relay') throw new SessionError('handshake', `Phản hồi lạ từ máy chủ (trường ${reply.field}).`);
    const { offer } = reply;
    if (offer.refuseReason) throw new SessionError('refused', offer.refuseReason);
    if (!offer.version) throw new SessionError('old', 'Phiên bản RustDesk bên máy đích quá cũ, không hỗ trợ web.');

    this.status('Nối relay…');
    const relay = new Pipe(this.open(relaySocketUrl(offer.relayServer, this.o.server)), 'relay');
    this.relay = relay;
    await relay.open();
    relay.send(encodeRequestRelay(offer.uuid));
    await this.secure(relay, offer.signedPk);
    this.status('Đã mã hoá, chờ máy đích…');
  }

  private async secure(relay: Pipe, signedPk: Uint8Array): Promise<void> {
    const serverKey = fromBase64(this.o.serverKey ?? PUBLIC_SERVER_KEY);
    const vouched = signedPk.length ? openSigned(signedPk, serverKey) : null;
    if (!vouched) throw new SessionError('handshake', 'Chữ ký khoá của máy chủ RustDesk không hợp lệ.');
    const vouchedPeer = decodeIdPk(vouched);
    if (vouchedPeer.id !== this.o.peerId || vouchedPeer.pk.length !== 32) {
      throw new SessionError('handshake', 'Khoá do máy chủ cấp không khớp ID máy đích.');
    }
    const first = decodeMessage(await relay.next(STEP_TIMEOUT_MS));
    if (first.kind !== 'signedId') throw new SessionError('handshake', 'Máy đích không gửi danh tính đã ký.');
    const opened = openSigned(first.id, vouchedPeer.pk);
    if (!opened) throw new SessionError('handshake', 'Danh tính của máy đích không xác minh được.');
    const peer = decodeIdPk(opened);
    if (peer.id !== this.o.peerId || peer.pk.length !== 32) {
      throw new SessionError('handshake', 'Danh tính của máy đích không khớp ID.');
    }
    const offer = makeKeyOffer(peer.pk, this.o.random);
    relay.send(encodePublicKey(offer.asymmetric, offer.symmetric));
    relay.secure(new SecretStream(offer.key));
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
      }),
    );
  }

  private async pump(): Promise<void> {
    const relay = this.relay;
    if (!relay) return;
    for (;;) {
      const msg = decodeMessage(await relay.next());
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

  requestKeyFrame(): void {
    if (this.canSend()) this.relay!.send(encodeRefreshVideo());
  }
}
