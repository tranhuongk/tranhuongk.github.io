import { describe, expect, test } from 'vitest';
import { decodeRendezvous, encodeOnlineRequest, isPeerOnline } from './rendezvous';

const hex = (s: string) => new Uint8Array(s.match(/../g)!.map((x) => parseInt(x, 16)));
const dump = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('rendezvous', () => {
  test('encodeOnlineRequest matches the bytes the live server accepted', () => {
    expect(dump(encodeOnlineRequest('ruster', ['123456789', '100000001']))).toBe(
      'ba011e0a0672757374657212093132333435363738391209313030303030303031',
    );
  });

  test('decodes an OnlineResponse and reads bits MSB first', () => {
    const reply = decodeRendezvous(hex('c201030a0100'));
    expect(reply).toEqual({ kind: 'online', states: new Uint8Array([0]) });
    expect(isPeerOnline(new Uint8Array([0b10100000]), 0)).toBe(true);
    expect(isPeerOnline(new Uint8Array([0b10100000]), 1)).toBe(false);
    expect(isPeerOnline(new Uint8Array([0b10100000]), 2)).toBe(true);
    expect(isPeerOnline(new Uint8Array([0]), 9)).toBe(false);
  });

  test('decodes the PunchHoleResponse failure the live server sent for a missing peer', () => {
    const reply = decodeRendezvous(
      hex('5a4618023a424661696c656420746f20636f6e6e6563743a207468652074617267657420646576696365206973206f66666c696e65206f7220646f6573206e6f742065786973742e'),
    );
    expect(reply).toMatchObject({ kind: 'punchHoleFailure', failure: 2 });
    expect(reply.kind === 'punchHoleFailure' && reply.detail).toContain('offline');
  });

  test('reports an unknown union field', () => {
    expect(decodeRendezvous(hex('820100'))).toEqual({ kind: 'other', field: 16 });
    expect(() => decodeRendezvous(new Uint8Array())).toThrow();
  });
});
