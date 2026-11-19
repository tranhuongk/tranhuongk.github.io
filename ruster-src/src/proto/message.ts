// RustDesk `Message` (the session protocol inside the relay): only what a viewer needs.
// Field numbers are those of the public protocol.
import {
  boolField, bytesOf, concat, lengthDelimited, numberOf, readFields, sintField, stringField, textOf, unzigzag,
  varintField, type RawField,
} from './wire';

export const FIELD = {
  signedId: 3, publicKey: 4, testDelay: 5, videoFrame: 6, loginRequest: 7, loginResponse: 8, hash: 9,
  mouseEvent: 10, keyEvent: 15, misc: 19, peerInfo: 25,
} as const;

const wrap = (field: number, body: number[]): Uint8Array<ArrayBuffer> => new Uint8Array(lengthDelimited(field, body));

export function encodePublicKey(asymmetric: Uint8Array, symmetric: Uint8Array): Uint8Array<ArrayBuffer> {
  return wrap(FIELD.publicKey, [...lengthDelimited(1, asymmetric), ...lengthDelimited(2, symmetric)]);
}

export interface LoginOptions {
  targetId: string;
  myId: string;
  myName: string;
  /** sha256(sha256(password + salt) + challenge); empty when no password is known. */
  password: Uint8Array;
  sessionId: number;
  version: string;
  platform: string;
}

/** LoginRequest advertising VP9 as the only decoder (WebCodecs `vp09.00.10.08`). */
export function encodeLoginRequest(o: LoginOptions): Uint8Array<ArrayBuffer> {
  const supportedDecoding = [...varintField(1, 1)];
  const option = [...lengthDelimited(10, supportedDecoding)];
  const body = [
    ...stringField(1, o.targetId),
    ...(o.password.length ? lengthDelimited(2, o.password) : []),
    ...stringField(4, o.myId),
    ...stringField(5, o.myName),
    ...lengthDelimited(6, option),
    ...boolField(9, true),
    ...varintField(10, o.sessionId),
    ...stringField(11, o.version),
    ...stringField(13, o.platform),
  ];
  return wrap(FIELD.loginRequest, body);
}

/** Misc.video_received: acknowledges one video message (login asked for acks). */
export const encodeVideoReceived = (): Uint8Array<ArrayBuffer> => wrap(FIELD.misc, boolField(12, true));
/** Misc.refresh_video: asks for a new key frame. */
export const encodeRefreshVideo = (): Uint8Array<ArrayBuffer> => wrap(FIELD.misc, boolField(10, true));

/** Echo of a TestDelay the peer sent: same payload, returned unchanged. */
export const encodeTestDelayEcho = (raw: Uint8Array): Uint8Array<ArrayBuffer> => wrap(FIELD.testDelay, Array.from(raw));

export const MOUSE = { move: 0, down: 1, up: 2, wheel: 3 } as const;
export const BUTTON = { left: 1, right: 2, middle: 4, back: 8, forward: 16 } as const;

/** mask = (button << 3) | type; x/y are remote desktop pixels (sint32). */
export function encodeMouse(type: number, button: number, x: number, y: number): Uint8Array<ArrayBuffer> {
  const mask = (button << 3) | type;
  return wrap(FIELD.mouseEvent, [...varintField(1, mask), ...sintField(2, Math.round(x)), ...sintField(3, Math.round(y))]);
}

/** ControlKey enum values the keyboard code sends. */
export const CONTROL_KEY = {
  Alt: 1, Backspace: 2, CapsLock: 3, Control: 4, Delete: 5, DownArrow: 6, End: 7, Escape: 8,
  F1: 9, F10: 10, F11: 11, F12: 12, F2: 13, F3: 14, F4: 15, F5: 16, F6: 17, F7: 18, F8: 19, F9: 20,
  Home: 21, LeftArrow: 22, Meta: 23, PageDown: 25, PageUp: 26, Return: 27, RightArrow: 28, Shift: 29,
  Space: 30, Tab: 31, UpArrow: 32, Insert: 58,
} as const;

export interface KeyInput {
  /** A control key pressed and released as one click. */
  controlKey?: number;
  /** Typed text, delivered as an input string. */
  text?: string;
  /** Character key held with modifiers (Ctrl+C): lower-case character code. */
  chr?: number;
  modifiers?: number[];
}

export function encodeKey(k: KeyInput): Uint8Array<ArrayBuffer> {
  const body = [...boolField(2, true)];
  if (k.controlKey !== undefined) body.push(...varintField(3, k.controlKey));
  if (k.chr !== undefined) body.push(...varintField(4, k.chr));
  if (k.text !== undefined) body.push(...stringField(6, k.text));
  if (k.modifiers?.length) body.push(...lengthDelimited(8, k.modifiers.flatMap((m) => [m])));
  return wrap(FIELD.keyEvent, body);
}

// --- incoming -------------------------------------------------------------------------------

export type Incoming =
  | { kind: 'signedId'; id: Uint8Array }
  | { kind: 'hash'; salt: string; challenge: string }
  | { kind: 'loginResponse'; error: string; peer: PeerSummary | null }
  | { kind: 'video'; codec: string; frames: VideoChunk[] }
  | { kind: 'testDelay'; raw: Uint8Array }
  | { kind: 'other'; field: number };

export interface PeerSummary {
  hostname: string;
  platform: string;
  username: string;
  version: string;
  width: number;
  height: number;
  /** Top-left of the shown display on the remote desktop (mouse coordinates are absolute). */
  originX: number;
  originY: number;
}

export interface VideoChunk {
  data: Uint8Array;
  key: boolean;
  /** Milliseconds. */
  pts: number;
}

const VIDEO_CODECS: Record<number, string> = { 6: 'vp9', 10: 'h264', 11: 'h265', 12: 'vp8', 13: 'av1' };

function decodePeer(bytes: Uint8Array): PeerSummary {
  const f = readFields(bytes);
  const displays = f.filter((x) => x.field === 4 && x.value instanceof Uint8Array);
  const current = numberOf(f, 5);
  const display = displays[current]?.value ?? displays[0]?.value;
  const d = display instanceof Uint8Array ? readFields(display) : ([] as RawField[]);
  return {
    username: textOf(f, 1), hostname: textOf(f, 2), platform: textOf(f, 3), version: textOf(f, 7),
    width: numberOf(d, 3), height: numberOf(d, 4), originX: unzigzag(numberOf(d, 1)), originY: unzigzag(numberOf(d, 2)),
  };
}

export function decodeMessage(bytes: Uint8Array): Incoming {
  // The peer also sends messages whose only field is a number (cursor_id, field 14) or nothing at
  // all; those carry nothing we act on and must not end the session.
  const top = readFields(bytes)[0];
  if (!top || !(top.value instanceof Uint8Array)) return { kind: 'other', field: top?.field ?? 0 };
  const inner = readFields(top.value);
  switch (top.field) {
    case FIELD.signedId:
      return { kind: 'signedId', id: bytesOf(inner, 1) ?? new Uint8Array() };
    case FIELD.hash:
      return { kind: 'hash', salt: textOf(inner, 1), challenge: textOf(inner, 2) };
    case FIELD.loginResponse: {
      const peer = bytesOf(inner, 2);
      return { kind: 'loginResponse', error: textOf(inner, 1), peer: peer ? decodePeer(peer) : null };
    }
    case FIELD.videoFrame: {
      for (const f of inner) {
        const codec = VIDEO_CODECS[f.field];
        if (!codec || !(f.value instanceof Uint8Array)) continue;
        const frames = readFields(f.value)
          .filter((x) => x.field === 1 && x.value instanceof Uint8Array)
          .map((x) => {
            const e = readFields(x.value as Uint8Array);
            return { data: bytesOf(e, 1) ?? new Uint8Array(), key: numberOf(e, 2) !== 0, pts: numberOf(e, 3) };
          });
        return { kind: 'video', codec, frames };
      }
      return { kind: 'video', codec: 'unknown', frames: [] };
    }
    case FIELD.testDelay:
      return { kind: 'testDelay', raw: top.value };
    default:
      return { kind: 'other', field: top.field };
  }
}

/** IdPk {id, pk}: what both the ID server and the peer sign. */
export function decodeIdPk(bytes: Uint8Array): { id: string; pk: Uint8Array; dtlsFingerprint: string } {
  const f = readFields(bytes);
  return { id: textOf(f, 1), pk: bytesOf(f, 2) ?? new Uint8Array(), dtlsFingerprint: textOf(f, 3) };
}

export function encodeIdPk(id: string, pk: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array([...stringField(1, id), ...lengthDelimited(2, pk)]);
}

export { concat };
