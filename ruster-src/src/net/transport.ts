// What the session needs from a connection to the peer: framed messages in and out.
import type { SecretStream } from './crypto';

export interface Transport {
  send(bytes: Uint8Array): void;
  /** Next whole message; rejects when the connection closes, or after `timeoutMs`. */
  next(timeoutMs?: number): Promise<Uint8Array>;
  /** Relay only: switch to the secretbox stream. A WebRTC channel is already encrypted by DTLS. */
  secure(stream: SecretStream): void;
  close(): void;
}
