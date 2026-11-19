// RendezvousMessage (union field numbers from the public RustDesk protocol) for the web
// client's ID server socket: OnlineRequest/OnlineResponse and PunchHoleResponse failures.
import { decodeText, lengthDelimited, readFields, stringField } from './wire';

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
