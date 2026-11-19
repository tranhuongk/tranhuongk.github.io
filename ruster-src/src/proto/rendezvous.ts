// RendezvousMessage (union field numbers from the public RustDesk protocol) for the web
// client's ID server socket: OnlineRequest/OnlineResponse and PunchHoleResponse failures.
import { bytesOf, decodeText, lengthDelimited, numberOf, readFields, stringField, textOf, varintField } from './wire';

const FIELD_ONLINE_REQUEST = 23;
const FIELD_ONLINE_RESPONSE = 24;
const FIELD_PUNCH_HOLE_RESPONSE = 11;

/** Asks which of `peers` are online; `from` is the asking client's own id (any label works). */
export function encodeOnlineRequest(from: string, peers: string[]): Uint8Array<ArrayBuffer> {
  const body = [...stringField(1, from), ...peers.flatMap((p) => stringField(2, p))];
  return new Uint8Array(lengthDelimited(FIELD_ONLINE_REQUEST, body));
}

export type RendezvousReply =
  | { kind: 'online'; states: Uint8Array }
  | { kind: 'punchHoleFailure'; failure: number; detail: string }
  | { kind: 'other'; field: number };

export function decodeRendezvous(bytes: Uint8Array): RendezvousReply {
  const top = readFields(bytes).find((f) => f.value instanceof Uint8Array);
  if (!top || !(top.value instanceof Uint8Array)) throw new Error('empty rendezvous message');
  if (top.field === FIELD_ONLINE_RESPONSE) {
    const states = readFields(top.value).find((f) => f.field === 1 && f.value instanceof Uint8Array);
    return { kind: 'online', states: states && states.value instanceof Uint8Array ? states.value : new Uint8Array() };
  }
  if (top.field === FIELD_PUNCH_HOLE_RESPONSE) {
    let failure = 0;
    let detail = '';
    for (const f of readFields(top.value)) {
      if (f.field === 3 && typeof f.value === 'number') failure = f.value;
      if (f.field === 7 && f.value instanceof Uint8Array) detail = decodeText(f.value);
    }
    return { kind: 'punchHoleFailure', failure, detail };
  }
  return { kind: 'other', field: top.field };
}

/** OnlineResponse.states: one bit per requested peer, MSB first (bit 7 of byte 0 is peer 0). */
export function isPeerOnline(states: Uint8Array, index: number): boolean {
  const byte = states[Math.floor(index / 8)];
  if (byte === undefined) return false;
  return (byte & (0x80 >> index % 8)) !== 0;
}

// --- connecting through the relay -------------------------------------------------------------

const FIELD_PUNCH_HOLE_REQUEST = 8;
const FIELD_REQUEST_RELAY = 18;
const FIELD_RELAY_RESPONSE = 19;
const FIELD_ICE_CANDIDATE = 29;
export const CLIENT_VERSION = '1.5.3';
const NAT_SYMMETRIC = 2;

/** PunchHoleRequest forcing the relay path (the browser cannot punch holes). */
export function encodePunchHoleRequest(peerId: string, licenceKey = '', webrtcOffer = ''): Uint8Array<ArrayBuffer> {
  const body = [
    ...stringField(1, peerId),
    ...varintField(2, NAT_SYMMETRIC),
    ...(licenceKey ? stringField(3, licenceKey) : []),
    ...varintField(4, 0),
    ...stringField(6, CLIENT_VERSION),
    ...varintField(8, 1),
    ...(webrtcOffer ? stringField(12, webrtcOffer) : []),
  ];
  return new Uint8Array(lengthDelimited(FIELD_PUNCH_HOLE_REQUEST, body));
}

/** First message on the relay socket: which rendezvous session to join. */
export function encodeRequestRelay(uuid: string, licenceKey = ''): Uint8Array<ArrayBuffer> {
  const body = [...stringField(2, uuid), ...(licenceKey ? stringField(6, licenceKey) : [])];
  return new Uint8Array(lengthDelimited(FIELD_REQUEST_RELAY, body));
}

export interface RelayOffer {
  uuid: string;
  relayServer: string;
  /** Peer public key signed by the ID server (verify with the server key). */
  signedPk: Uint8Array;
  version: string;
  refuseReason: string;
  /** `webrtc://…` endpoint of the peer, when it took the WebRTC offer. */
  webrtcAnswer: string;
}

export type ConnectReply =
  | { kind: 'relay'; offer: RelayOffer }
  | { kind: 'ice'; sessionKey: string; candidate: string }
  | { kind: 'failure'; failure: number; detail: string }
  | { kind: 'other'; field: number };

export function decodeConnectReply(bytes: Uint8Array): ConnectReply {
  const top = readFields(bytes).find((f) => f.value instanceof Uint8Array);
  if (!top || !(top.value instanceof Uint8Array)) throw new Error('empty rendezvous message');
  const inner = readFields(top.value);
  if (top.field === FIELD_RELAY_RESPONSE) {
    return {
      kind: 'relay',
      offer: {
        uuid: textOf(inner, 2),
        relayServer: textOf(inner, 3),
        signedPk: bytesOf(inner, 5) ?? new Uint8Array(),
        refuseReason: textOf(inner, 6),
        version: textOf(inner, 7),
        webrtcAnswer: textOf(inner, 12),
      },
    };
  }
  if (top.field === FIELD_ICE_CANDIDATE) {
    return { kind: 'ice', sessionKey: textOf(inner, 3), candidate: textOf(inner, 4) };
  }
  if (top.field === FIELD_PUNCH_HOLE_RESPONSE) {
    return { kind: 'failure', failure: numberOf(inner, 3), detail: textOf(inner, 7) };
  }
  return { kind: 'other', field: top.field };
}

/** Our ICE candidate (JSON of RTCIceCandidate) for the peer, keyed by the offer's DTLS fingerprint. */
export function encodeIceCandidate(peerId: string, sessionKey: string, candidate: string): Uint8Array<ArrayBuffer> {
  const body = [...stringField(1, peerId), ...stringField(3, sessionKey), ...stringField(4, candidate)];
  return new Uint8Array(lengthDelimited(FIELD_ICE_CANDIDATE, body));
}
