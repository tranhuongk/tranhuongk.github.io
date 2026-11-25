// Asks RustDesk's ID server (WebSocket /ws/id, binary frames, bare protobuf) whether peers are
// online. The socket is injected so tests need no network.
import { decodeRendezvous, encodeOnlineRequest, isPeerOnline } from '../proto/rendezvous';

/** Our own hbbs/hbbr (iNET VPS, Hà Nội) behind Caddy: /ws/id → 21118, /ws/relay → 21119. */
export const DEFAULT_SERVER = 'wss://103-75-184-121.sslip.io';
/** RustDesk's public demo server. */
export const PUBLIC_SERVER = 'wss://rs-ny.rustdesk.com';
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

/** Online state of every id in one round trip; ids missing from the answer count as offline. */
export function checkPeers(
  ids: string[],
  server: string,
  open: SocketFactory = (url) => new WebSocket(url),
  timeoutMs = LOOKUP_TIMEOUT_MS,
): Promise<{ ok: true; online: Map<string, boolean> } | { ok: false; detail: string }> {
  const valid = ids.filter(isValidPeerId);
  if (valid.length === 0) return Promise.resolve({ ok: true, online: new Map() });
  return new Promise((resolve) => {
    let ws: WebSocket;
    try {
      ws = open(idSocketUrl(server));
    } catch (e) {
      resolve({ ok: false, detail: `Không mở được kết nối: ${(e as Error).message}` });
      return;
    }
    ws.binaryType = 'arraybuffer';
    let done = false;
    const finish = (result: { ok: true; online: Map<string, boolean> } | { ok: false; detail: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, detail: 'Máy chủ không trả lời.' }), timeoutMs);
    ws.onopen = () => ws.send(encodeOnlineRequest('ruster', valid));
    ws.onerror = () => finish({ ok: false, detail: 'Không kết nối được tới máy chủ.' });
    ws.onclose = () => finish({ ok: false, detail: 'Máy chủ đóng kết nối.' });
    ws.onmessage = (event) => {
      try {
        const reply = decodeRendezvous(new Uint8Array(event.data as ArrayBuffer));
        if (reply.kind !== 'online') {
          finish({ ok: false, detail: `Phản hồi lạ (trường ${reply.kind === 'other' ? reply.field : 'lỗi'}).` });
          return;
        }
        finish({ ok: true, online: new Map(valid.map((id, i) => [id, isPeerOnline(reply.states, i)])) });
      } catch (e) {
        finish({ ok: false, detail: `Phản hồi không đọc được: ${(e as Error).message}` });
      }
    };
  });
}

export async function checkPeer(
  id: string,
  server: string,
  open: SocketFactory = (url) => new WebSocket(url),
  timeoutMs = LOOKUP_TIMEOUT_MS,
): Promise<PeerStatus> {
  if (!isValidPeerId(id)) return { kind: 'error', detail: 'ID không hợp lệ.' };
  const r = await checkPeers([id], server, open, timeoutMs);
  if (!r.ok) return { kind: 'error', detail: r.detail };
  return r.online.get(id) ? { kind: 'online' } : { kind: 'offline' };
}

/** `relay_server` from the ID server → the relay's WebSocket URL (same rules as the official web client). */
export function relaySocketUrl(relayServer: string, fallbackServer: string): string {
  if (!relayServer.trim()) {
    const own = fallbackServer.trim().replace(/\/+$/, '').replace(/\/ws\/id$/, '');
    if (/^wss?:\/\//.test(own)) return `${own}/ws/relay`;
  }
  const raw = relayServer.trim() || fallbackServer.trim();
  if (/^wss?:\/\//.test(raw)) return raw;
  const ipv4 = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?$/);
  if (ipv4) return `wss://${ipv4[1]}:${ipv4[2] ? Number(ipv4[2]) + 2 : 21119}`;
  const host = raw.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  return `wss://${host}/ws/relay`;
}
