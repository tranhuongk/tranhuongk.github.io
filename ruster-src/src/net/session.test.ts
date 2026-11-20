import nacl from 'tweetnacl';
import { describe, expect, test } from 'vitest';
import { decodeMessage, encodeIdPk, FIELD, MOUSE, BUTTON, CONTROL_KEY } from '../proto/message';
import { boolField, lengthDelimited, readFields, stringField, varintField } from '../proto/wire';
import { decodeIdPk } from '../proto/message';
import { loginProof, SecretStream } from './crypto';
import { RustSession, type SessionEvents, type SessionOptions } from './session';
import { encodeEndpoint } from './webrtc';

const PEER_ID = '156993080';
const PASSWORD = 'correct horse';
const enc = new TextEncoder();
const wrap = (field: number, body: number[]) => new Uint8Array(lengthDelimited(field, body));

/** A scripted RustDesk world: ID server, relay and peer, all in memory. */
class World {
  readonly server = nacl.sign.keyPair();
  readonly hostSign = nacl.sign.keyPair();
  readonly hostBox = nacl.box.keyPair();
  readonly urls: string[] = [];
  readonly clientFrames: Uint8Array[] = [];
  readonly idFrames: Uint8Array[] = [];
  readonly sockets: FakeSocket[] = [];
  /** webrtc_sdp_answer the ID server returns (empty: the peer took no offer). */
  webrtcAnswer = '';
  secret: SecretStream | null = null;
  online = true;
  relayServer = 'rs-ny.rustdesk.com:21117';
  refuse = '';
  failureText = 'offline';
  version = '1.5.3';
  wrongSignature = false;
  challenge = 'chal-123';
  salt = 'salt-xyz';

  open = (url: string): WebSocket => {
    this.urls.push(url);
    const socket = new FakeSocket(this, url);
    this.sockets.push(socket);
    return socket as unknown as WebSocket;
  };

  relayResponse(): Uint8Array {
    const pk = nacl.sign(encodeIdPk(PEER_ID, this.hostSign.publicKey), this.wrongSignature ? nacl.sign.keyPair().secretKey : this.server.secretKey);
    const body = [...stringField(2, 'uuid-1'), ...stringField(3, this.relayServer), ...lengthDelimited(5, pk),
      ...(this.refuse ? stringField(6, this.refuse) : []), ...(this.version ? stringField(7, this.version) : []),
      ...(this.webrtcAnswer ? stringField(12, this.webrtcAnswer) : [])];
    return wrap(19, body);
  }

  failure(): Uint8Array {
    return wrap(11, [...varintField(3, 2), ...stringField(7, this.failureText)]);
  }

  signedId(): Uint8Array {
    const signed = nacl.sign(encodeIdPk(PEER_ID, this.hostBox.publicKey), this.hostSign.secretKey);
    return wrap(FIELD.signedId, lengthDelimited(1, signed));
  }

  hash(): Uint8Array {
    return wrap(FIELD.hash, [...stringField(1, this.salt), ...stringField(2, this.challenge)]);
  }
}

class FakeSocket {
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  private kind: 'id' | 'relay';
  constructor(readonly world: World, readonly url: string) {
    this.kind = url.endsWith('/ws/id') ? 'id' : 'relay';
    queueMicrotask(() => this.onopen?.());
  }
  deliver(bytes: Uint8Array): void {
    const out = this.kind === 'relay' && this.world.secret && this.secured ? this.world.secret.seal(bytes) : bytes;
    queueMicrotask(() => this.onmessage?.({ data: out.slice().buffer as ArrayBuffer }));
  }
  secured = false;
  send(data: Uint8Array): void {
    if (this.kind === 'id') {
      this.world.idFrames.push(data);
      if (readFields(data)[0]?.field !== 8) return;
      this.deliver(this.world.online ? this.world.relayResponse() : this.world.failure());
      return;
    }
    if (this.secured) {
      this.world.clientFrames.push(this.world.secret!.open(data));
      this.onClientFrame(this.world.clientFrames[this.world.clientFrames.length - 1]!);
      return;
    }
    const top = readFields(data).find((f) => f.value instanceof Uint8Array)!;
    if (top.field === 18) this.deliver(this.world.signedId());
    else if (top.field === FIELD.publicKey) {
      const f = readFields(top.value as Uint8Array);
      const clientPk = f.find((x) => x.field === 1)!.value as Uint8Array;
      const sealed = f.find((x) => x.field === 2)!.value as Uint8Array;
      const key = nacl.box.open(sealed, new Uint8Array(24), clientPk, this.world.hostBox.secretKey)!;
      this.world.secret = new SecretStream(key);
      this.secured = true;
      this.deliver(this.world.hash());
    }
  }
  private onClientFrame(plain: Uint8Array): void {
    const m = decodeMessage(plain);
    if (m.kind === 'other' && readFields(plain)[0]!.field === FIELD.loginRequest) {
      const f = readFields(readFields(plain)[0]!.value as Uint8Array);
      const proof = f.find((x) => x.field === 2)?.value as Uint8Array | undefined;
      void loginProof(PASSWORD, this.world.salt, this.world.challenge).then((expected) => {
        const ok = proof && proof.length === expected.length && proof.every((b, i) => b === expected[i]);
        if (!ok) {
          this.deliver(wrap(FIELD.loginResponse, stringField(1, 'Wrong Password')));
          return;
        }
        const display = [...varintField(3, 1280), ...varintField(4, 720)];
        const peerInfo = [...stringField(2, 'HOST'), ...stringField(3, 'Mac OS'), ...lengthDelimited(4, display)];
        this.deliver(wrap(FIELD.loginResponse, lengthDelimited(2, peerInfo)));
        const keyFrame = lengthDelimited(1, [...lengthDelimited(1, [1, 2, 3]), ...boolField(2, true), ...varintField(3, 7)]);
        this.deliver(wrap(FIELD.videoFrame, lengthDelimited(6, keyFrame)));
      });
    }
  }
  close(): void {
    this.closed = true;
    queueMicrotask(() => this.onclose?.());
  }
}

interface Recorder {
  statuses: string[];
  needs: (string | null)[];
  ready: { width: number; height: number; hostname: string }[];
  video: { key: boolean; pts: number; bytes: number[] }[];
  closed: ({ kind: string; message: string } | null)[];
}

function run(world: World, password?: string, extra: Partial<SessionOptions> = {}) {
  const rec: Recorder = { statuses: [], needs: [], ready: [], video: [], closed: [] };
  const events: SessionEvents = {
    status: (t) => rec.statuses.push(t),
    needPassword: (r) => rec.needs.push(r),
    ready: (p) => rec.ready.push({ width: p.width, height: p.height, hostname: p.hostname }),
    video: (frames) => frames.forEach((f) => rec.video.push({ key: f.key, pts: f.pts, bytes: [...f.data] })),
    closed: (e) => rec.closed.push(e && { kind: e.kind, message: e.message }),
  };
  const session = new RustSession({
    peerId: PEER_ID, server: 'wss://rs-ny.rustdesk.com', password, events, open: world.open,
    serverKey: btoa(String.fromCharCode(...world.server.publicKey)), ...extra,
  });
  const done = session.run();
  return { rec, session, done };
}

const until = async (cond: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('condition not met');
    await new Promise((r) => setTimeout(r, 1));
  }
};

describe('RustSession', () => {
  test('full flow: relay, verified key exchange, password proof, peer info and a key frame', async () => {
    const w = new World();
    const { rec, session } = run(w, PASSWORD);
    await until(() => rec.video.length === 1);
    expect(w.urls).toEqual(['wss://rs-ny.rustdesk.com/ws/id', 'wss://rs-ny.rustdesk.com/ws/relay']);
    expect(rec.ready).toEqual([{ width: 1280, height: 720, hostname: 'HOST' }]);
    expect(rec.video[0]).toEqual({ key: true, pts: 7, bytes: [1, 2, 3] });
    // The client acknowledged the video message (login asked for acks).
    await until(() => w.clientFrames.some((f) => readFields(f)[0]?.field === FIELD.misc));
    expect(rec.needs).toEqual([]);
    session.close();
  });

  test('the first frames from the client are encrypted with counter 1, 2… and decrypt on the host', async () => {
    const w = new World();
    const { session, rec } = run(w, PASSWORD);
    await until(() => rec.video.length === 1);
    session.sendMouse(MOUSE.down, BUTTON.left, 10, 20);
    session.sendKey({ controlKey: CONTROL_KEY.Return });
    await until(() => w.clientFrames.length >= 4);
    const mouse = w.clientFrames.find((f) => readFields(f)[0]?.field === FIELD.mouseEvent)!;
    const inner = readFields(readFields(mouse)[0]!.value as Uint8Array);
    expect(inner.find((f) => f.field === 1)?.value).toBe((BUTTON.left << 3) | MOUSE.down);
    expect(inner.find((f) => f.field === 2)?.value).toBe(20); // zigzag(10)
    expect(inner.find((f) => f.field === 3)?.value).toBe(40); // zigzag(20)
    session.close();
  });

  test('a wrong password is reported and a second try with the right one gets in', async () => {
    const w = new World();
    const { session, rec } = run(w, 'nope');
    await until(() => rec.needs.length === 1);
    expect(rec.needs[0]).toBe('Wrong Password');
    session.submitPassword(PASSWORD);
    await until(() => rec.ready.length === 1);
    session.close();
  });

  test('without a password it asks for one once the peer sends its challenge', async () => {
    const w = new World();
    const { session, rec } = run(w);
    await until(() => rec.needs.length === 1);
    expect(rec.needs[0]).toBeNull();
    session.submitPassword(PASSWORD);
    await until(() => rec.ready.length === 1);
    session.close();
  });

  test('an offline peer, a refusal and an old peer end the session with the matching kind', async () => {
    for (const [setup, kind] of [
      [(w: World) => (w.online = false), 'offline'],
      [(w: World) => (w.refuse = 'too many'), 'refused'],
      [(w: World) => (w.version = ''), 'old'],
    ] as const) {
      const w = new World();
      setup(w);
      const { rec, done } = run(w, PASSWORD);
      await done;
      expect(rec.closed[0]).toMatchObject({ kind });
    }
  });

  test('a key the ID server did not sign is refused before any key is sent', async () => {
    const w = new World();
    w.wrongSignature = true;
    const { rec, done } = run(w, PASSWORD);
    await done;
    expect(rec.closed[0]).toMatchObject({ kind: 'handshake' });
    expect(w.clientFrames).toEqual([]);
  });

  test('with WebRTC offered: the offer goes in the request, our candidates reach the ID server, and a channel that never opens falls back to the relay', async () => {
    const w = new World();
    const SDP = 'v=0\r\na=fingerprint:sha-256 AA\r\nm=application 9 x\r\na=candidate:1 1 udp 1 192.0.2.1 5000 typ host\r\n';
    w.webrtcAnswer = encodeEndpoint('answer', SDP);
    let pc!: FakePeer;
    const { session, rec } = run(w, PASSWORD, {
      webrtc: true, webrtcGraceMs: 50,
      peerConnection: () => (pc = new FakePeer(SDP)) as unknown as RTCPeerConnection,
    });
    await until(() => w.idFrames.length >= 1);
    const request = readFields(readFields(w.idFrames[0]!)[0]!.value as Uint8Array);
    const offer = new TextDecoder().decode(request.find((f) => f.field === 12)!.value as Uint8Array);
    expect(offer.startsWith('webrtc://')).toBe(true);
    expect(request.find((f) => f.field === 8)?.value).toBe(1); // force_relay
    pc.onicecandidate!({ candidate: { candidate: 'candidate:9 1 udp 1 198.51.100.7 6000 typ srflx', toJSON: () => ({ candidate: 'candidate:9 1 udp 1 198.51.100.7 6000 typ srflx' }) } });
    await until(() => w.idFrames.some((f) => readFields(f)[0]?.field === 29));
    const ice = readFields(readFields(w.idFrames.find((f) => readFields(f)[0]?.field === 29)!)[0]!.value as Uint8Array);
    expect(new TextDecoder().decode(ice.find((f) => f.field === 3)!.value as Uint8Array)).toBe('sha-256 AA');
    await until(() => rec.video.length === 1, 4000);
    expect(session.path).toBe('relay');
    expect(rec.ready).toHaveLength(1);
    session.close();
  });

  test('loginProof is sha256(sha256(password+salt)+challenge)', async () => {
    const sha = async (b: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
    const inner = await sha(enc.encode('pw' + 'salt'));
    const expected = await sha(new Uint8Array([...inner, ...enc.encode('chal')]));
    expect(await loginProof('pw', 'salt', 'chal')).toEqual(expected);
  });

  test('decodeIdPk reads back what encodeIdPk wrote', () => {
    expect(decodeIdPk(encodeIdPk('42', new Uint8Array([1, 2])))).toEqual({ id: '42', pk: new Uint8Array([1, 2]), dtlsFingerprint: '' });
  });
});

class FakePeer {
  dc = { binaryType: '', readyState: 'connecting', send() {}, close() {}, onopen: null, onclose: null, onmessage: null };
  onicecandidate: ((e: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState = 'new';
  constructor(private readonly sdp: string) {}
  createDataChannel() {
    return this.dc;
  }
  async createOffer() {
    return { type: 'offer', sdp: this.sdp };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  async addIceCandidate() {}
  async getStats() {
    return new Map();
  }
  close() {}
}

describe('decodeMessage tolerates what the peer really sends', () => {
  test('a message whose only field is a number (cursor_id) or nothing at all is ignored', () => {
    expect(decodeMessage(new Uint8Array([0x70, 0x05]))).toEqual({ kind: 'other', field: 14 });
    expect(decodeMessage(new Uint8Array())).toEqual({ kind: 'other', field: 0 });
  });
});

describe('RustSession keeps going through number-only messages', () => {
  test('a cursor_id message after login does not end the session', async () => {
    const w = new World();
    const { session, rec } = run(w, PASSWORD);
    await until(() => rec.video.length === 1);
    const sock = w.sockets.find((s) => s.url.endsWith('/ws/relay'))!;
    sock.deliver(new Uint8Array([0x70, 0x05]));
    sock.deliver(new Uint8Array());
    sock.deliver(wrap(FIELD.videoFrame, lengthDelimited(6, lengthDelimited(1, [...lengthDelimited(1, [9]), ...boolField(2, false), ...varintField(3, 8)]))));
    await until(() => rec.video.length === 2);
    expect(rec.closed).toEqual([]);
    session.close();
  });
});

describe('cursor, delay and Ctrl+Alt+Del', () => {
  test('the login asks for the remote cursor, delay reports arrive and the toggles reach the peer', async () => {
    const w = new World();
    const delays: number[] = [];
    const rec: Recorder = { statuses: [], needs: [], ready: [], video: [], closed: [] };
    const session = new RustSession({
      peerId: PEER_ID, server: 'wss://rs-ny.rustdesk.com', password: PASSWORD, open: w.open,
      serverKey: btoa(String.fromCharCode(...w.server.publicKey)),
      events: {
        status: () => {}, needPassword: () => {}, ready: (p) => rec.ready.push({ width: p.width, height: p.height, hostname: p.hostname }),
        video: (f) => f.forEach((x) => rec.video.push({ key: x.key, pts: x.pts, bytes: [...x.data] })),
        delay: (ms) => delays.push(ms), closed: () => {},
      },
    });
    void session.run();
    await until(() => rec.video.length === 1);
    const login = w.clientFrames.find((f) => readFields(f)[0]?.field === FIELD.loginRequest)!;
    const option = readFields(readFields(readFields(login)[0]!.value as Uint8Array).find((f) => f.field === 6)!.value as Uint8Array);
    expect(option.find((f) => f.field === 3)?.value).toBe(2); // show_remote_cursor = Yes

    w.sockets.find((s) => s.url.endsWith('/ws/relay'))!.deliver(wrap(FIELD.testDelay, [...varintField(1, 5), ...varintField(3, 42)]));
    await until(() => delays.length === 1);
    expect(delays).toEqual([42]);

    session.setShowRemoteCursor(false);
    session.sendCtrlAltDel('Windows');
    session.sendCtrlAltDel('Mac OS');
    await until(() => w.clientFrames.filter((f) => readFields(f)[0]?.field === FIELD.keyEvent).length === 2);
    const misc = w.clientFrames.find((f) => readFields(f)[0]?.field === FIELD.misc && readFields(readFields(f)[0]!.value as Uint8Array)[0]?.field === 7)!;
    const optionMsg = readFields(readFields(readFields(misc)[0]!.value as Uint8Array)[0]!.value as Uint8Array);
    expect(optionMsg.find((f) => f.field === 3)?.value).toBe(1); // No
    const keys = w.clientFrames.filter((f) => readFields(f)[0]?.field === FIELD.keyEvent).map((f) => readFields(readFields(f)[0]!.value as Uint8Array));
    expect(keys[0]!.find((f) => f.field === 1)?.value).toBe(1); // down
    expect(keys[0]!.find((f) => f.field === 3)?.value).toBe(100); // CtrlAltDel
    expect(keys[1]!.find((f) => f.field === 3)?.value).toBe(5); // Delete + Alt/Control modifiers
    expect(keys[1]!.find((f) => f.field === 8)).toBeDefined();
    session.close();
  });
});

describe('account token and login-required answers', () => {
  test('the access token travels in the PunchHoleRequest (field 5)', async () => {
    const w = new World();
    const { session, rec } = run(w, PASSWORD, { token: 'ACCESS-TOKEN' });
    await until(() => rec.video.length === 1);
    const request = readFields(readFields(w.idFrames[0]!)[0]!.value as Uint8Array);
    expect(new TextDecoder().decode(request.find((f) => f.field === 5)!.value as Uint8Array)).toBe('ACCESS-TOKEN');
    session.close();
  });

  test('a "please log in" refusal ends the session with kind auth, whichever message carries it', async () => {
    const msg = 'The connection is not allowed. This public server currently requires users to log in before connecting.';
    for (const set of [(w: World) => (w.refuse = msg), (w: World) => (w.failureText = msg)]) {
      const w = new World();
      if (set.toString().includes('failureText')) w.online = false;
      set(w);
      const { rec, done } = run(w, PASSWORD);
      await done;
      expect(rec.closed[0]).toMatchObject({ kind: 'auth' });
    }
  });
});
