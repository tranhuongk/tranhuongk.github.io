// The cryptography of a RustDesk session (NaCl primitives via tweetnacl):
//  - the ID server and the peer sign {id, pk} with Ed25519 (nacl.sign.open verifies);
//  - the client seals a fresh 32-byte symmetric key to the peer's Curve25519 key (nacl.box with an
//    all-zero nonce) and sends it with its ephemeral public key;
//  - after that every WebSocket frame is a secretbox whose 24-byte nonce is a little-endian
//    counter, one counter per direction, each starting at 1.
import nacl from 'tweetnacl';
import { concat } from '../proto/wire';

/** Ed25519 key of the public RustDesk ID servers (base64); custom servers publish their own. */
export const PUBLIC_SERVER_KEY = 'OeVuKk5nlHiXp+APNn0Y3pC1Iwpwn44JGqrQCsWqmBw=';

export function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function nonceFor(counter: number): Uint8Array {
  const nonce = new Uint8Array(24);
  let n = counter;
  for (let i = 0; i < 8 && n > 0; i++) {
    nonce[i] = n % 256;
    n = Math.floor(n / 256);
  }
  return nonce;
}

/** The message inside an Ed25519 signed blob, or null when the signature does not verify. */
export function openSigned(signed: Uint8Array, publicKey: Uint8Array): Uint8Array | null {
  try {
    return nacl.sign.open(signed, publicKey);
  } catch {
    return null;
  }
}

export interface KeyOffer {
  /** Our ephemeral Curve25519 public key. */
  asymmetric: Uint8Array;
  /** The symmetric key sealed to the peer. */
  symmetric: Uint8Array;
  /** The symmetric key itself, used for the secretbox stream. */
  key: Uint8Array;
}

export function makeKeyOffer(peerBoxKey: Uint8Array, random: (n: number) => Uint8Array = nacl.randomBytes): KeyOffer {
  const pair = nacl.box.keyPair();
  const key = random(nacl.secretbox.keyLength);
  return { asymmetric: pair.publicKey, symmetric: nacl.box(key, new Uint8Array(24), peerBoxKey, pair.secretKey), key };
}

/** One direction pair of the secretbox stream. */
export class SecretStream {
  private sent = 0;
  private received = 0;
  constructor(private readonly key: Uint8Array) {}

  seal(plain: Uint8Array): Uint8Array {
    this.sent += 1;
    return nacl.secretbox(plain, nonceFor(this.sent), this.key);
  }

  /** Throws when the frame does not authenticate (wrong key, counter out of step, tampering). */
  open(cipher: Uint8Array): Uint8Array {
    this.received += 1;
    const plain = nacl.secretbox.open(cipher, nonceFor(this.received), this.key);
    if (!plain) throw new Error('frame did not decrypt');
    return plain;
  }
}

/** sha256(sha256(password + salt) + challenge), as the peer's Hash message asks. */
export async function loginProof(password: string, salt: string, challenge: string): Promise<Uint8Array<ArrayBuffer>> {
  const enc = new TextEncoder();
  const sha = async (data: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const inner = await sha(enc.encode(password + salt));
  return sha(concat(inner, enc.encode(challenge)));
}
