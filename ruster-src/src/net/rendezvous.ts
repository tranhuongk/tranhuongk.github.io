// Asks RustDesk's ID server (WebSocket /ws/id, binary frames, bare protobuf) whether peers are
// online. The socket is injected so tests need no network.
import { decodeRendezvous, encodeOnlineRequest, isPeerOnline } from '../proto/rendezvous';

export const DEFAULT_SERVER = 'wss://rs-ny.rustdesk.com';
export const ID_PATH = '/ws/id';
const PEER_ID = /^[0-9A-Za-z_-]{1,32}$/;
export const LOOKUP_TIMEOUT_MS = 8_000;

export type SocketFactory = (url: string) => WebSocket;

export type PeerStatus =
  | { kind: 'online' }
  | { kind: 'offline' }
  | { kind: 'error'; detail: string };

export function isValidPeerId(id: string): boolean {
  return PEER_ID.test(id);
}

/** `wss://host`, `host` or `host:port` → the ws(s) URL of the ID socket. */
export function idSocketUrl(server: string): string {
  const trimmed = server.trim().replace(/\/+$/, '');
  if (/^wss?:\/\//.test(trimmed)) return trimmed.endsWith(ID_PATH) ? trimmed : trimmed + ID_PATH;
  return `wss://${trimmed}${ID_PATH}`;
}

export function checkPeer(
  id: string,
  server: string,
  open: SocketFactory = (url) => new WebSocket(url),
  timeoutMs = LOOKUP_TIMEOUT_MS,
): Promise<PeerStatus> {
  if (!isValidPeerId(id)) return Promise.resolve({ kind: 'error', detail: 'ID không hợp lệ.' });
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = open(idSocketUrl(server));
    } catch (e) {
      resolve({ kind: 'error', detail: `Không mở được kết nối: ${(e as Error).message}` });
      return;
    }
    ws.binaryType = 'arraybuffer';
    let done = false;
    const finish = (status: PeerStatus) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      resolve(status);
    };
    const timer = setTimeout(() => finish({ kind: 'error', detail: 'Máy chủ RustDesk không trả lời.' }), timeoutMs);
    ws.onopen = () => ws.send(encodeOnlineRequest('ruster', [id]));
    ws.onerror = () => finish({ kind: 'error', detail: 'Không kết nối được tới máy chủ RustDesk.' });
    ws.onclose = () => finish({ kind: 'error', detail: 'Máy chủ RustDesk đóng kết nối.' });
    ws.onmessage = (event) => {
      try {
        const reply = decodeRendezvous(new Uint8Array(event.data as ArrayBuffer));
        if (reply.kind === 'online') finish(isPeerOnline(reply.states, 0) ? { kind: 'online' } : { kind: 'offline' });
        else if (reply.kind === 'punchHoleFailure') finish({ kind: 'offline' });
        else finish({ kind: 'error', detail: `Phản hồi lạ (trường ${reply.field}).` });
      } catch (e) {
        finish({ kind: 'error', detail: `Phản hồi không đọc được: ${(e as Error).message}` });
      }
    };
  });
}
