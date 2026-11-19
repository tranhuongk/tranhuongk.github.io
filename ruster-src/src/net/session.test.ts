import nacl from 'tweetnacl';
import { describe, expect, test } from 'vitest';
import { decodeMessage, encodeIdPk, FIELD, MOUSE, BUTTON, CONTROL_KEY } from '../proto/message';
import { boolField, lengthDelimited, readFields, stringField, varintField } from '../proto/wire';
import { decodeIdPk } from '../proto/message';
import { loginProof, SecretStream } from './crypto';
import { RustSession, type SessionEvents } from './session';

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
  secret: SecretStream | null = null;
  online = true;
  relayServer = 'rs-ny.rustdesk.com:21117';
  refuse = '';
  version = '1.5.3';
  wrongSignature = false;
  challenge = 'chal-123';
  salt = 'salt-xyz';

  open = (url: string): WebSocket => {
    this.urls.push(url);
    return new FakeSocket(this, url) as unknown as WebSocket;
  };

  relayResponse(): Uint8Array {
    const pk = nacl.sign(encodeIdPk(PEER_ID, this.hostSign.publicKey), this.wrongSignature ? nacl.sign.keyPair().secretKey : this.server.secretKey);
    const body = [...stringField(2, 'uuid-1'), ...stringField(3, this.relayServer), ...lengthDelimited(5, pk),
      ...(this.refuse ? stringField(6, this.refuse) : []), ...(this.version ? stringField(7, this.version) : [])];
    return wrap(19, body);
  }

  failure(): Uint8Array {
    return wrap(11, [...varintField(3, 2), ...stringField(7, 'offline')]);
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

function run(world: World, password?: string) {
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
    serverKey: btoa(String.fromCharCode(...world.server.publicKey)),
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

  test('loginProof is sha256(sha256(password+salt)+challenge)', async () => {
    const sha = async (b: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
    const inner = await sha(enc.encode('pw' + 'salt'));
    const expected = await sha(new Uint8Array([...inner, ...enc.encode('chal')]));
    expect(await loginProof('pw', 'salt', 'chal')).toEqual(expected);
  });

  test('decodeIdPk reads back what encodeIdPk wrote', () => {
    expect(decodeIdPk(encodeIdPk('42', new Uint8Array([1, 2])))).toEqual({ id: '42', pk: new Uint8Array([1, 2]) });
  });
});
