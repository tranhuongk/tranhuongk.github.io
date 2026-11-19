// Remembered RustDesk ids ("Máy đã dùng"), kept in localStorage under `ruster.peers`.
// Only the id and an optional label are stored, never a password.
export const PEERS_KEY = 'ruster.peers';
export const MAX_PEERS = 20;

export interface SavedPeer {
  id: string;
  lastUsed: number;
}

const isPeer = (v: unknown): v is SavedPeer => {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === 'string' && /^[0-9A-Za-z_-]{1,32}$/.test(p.id) && typeof p.lastUsed === 'number' && Number.isFinite(p.lastUsed);
};

export function loadPeers(): SavedPeer[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PEERS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isPeer).sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_PEERS) : [];
  } catch {
    return [];
  }
}

function write(list: SavedPeer[]): SavedPeer[] {
  const next = [...list].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_PEERS);
  try {
    localStorage.setItem(PEERS_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: the list lives in this tab only
  }
  return next;
}

export function rememberPeer(id: string, now: number): SavedPeer[] {
  return write([...loadPeers().filter((p) => p.id !== id), { id, lastUsed: now }]);
}

export function removePeer(id: string): SavedPeer[] {
  return write(loadPeers().filter((p) => p.id !== id));
}
