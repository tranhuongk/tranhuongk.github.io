// Remembered RustDesk machines ("Máy đã kết nối"), kept in localStorage under `ruster.peers`.
// Stored per machine: the id, when it was last used, the name the user gave it and the host name the
// machine reported. Never a password.
export const PEERS_KEY = 'ruster.peers';
export const MAX_PEERS = 20;
export const MAX_NAME_LENGTH = 40;

export interface SavedPeer {
  id: string;
  lastUsed: number;
  /** Name chosen by the user; wins over `hostname`. */
  name?: string;
  /** Host name the machine reported when we last connected. */
  hostname?: string;
}

const isPeer = (v: unknown): v is SavedPeer => {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === 'string' && /^[0-9A-Za-z_-]{1,32}$/.test(p.id) &&
    typeof p.lastUsed === 'number' && Number.isFinite(p.lastUsed) &&
    (p.name === undefined || typeof p.name === 'string') &&
    (p.hostname === undefined || typeof p.hostname === 'string')
  );
};

const clean = (text: string | undefined): string => (text ?? '').trim().slice(0, MAX_NAME_LENGTH);

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

/** Adds or refreshes a machine; the user's name and an earlier host name survive a refresh. */
export function rememberPeer(id: string, now: number, hostname?: string): SavedPeer[] {
  const old = loadPeers().find((p) => p.id === id);
  const entry: SavedPeer = { id, lastUsed: now };
  const name = old?.name;
  const host = clean(hostname) || old?.hostname;
  if (name) entry.name = name;
  if (host) entry.hostname = host;
  return write([...loadPeers().filter((p) => p.id !== id), entry]);
}

/** Sets the user's name for a machine; a blank name removes it (the host name or id shows again). */
export function renamePeer(id: string, name: string): SavedPeer[] {
  const label = clean(name);
  return write(loadPeers().map((p) => {
    if (p.id !== id) return p;
    const { name: _old, ...rest } = p;
    return label ? { ...rest, name: label } : rest;
  }));
}

export function removePeer(id: string): SavedPeer[] {
  return write(loadPeers().filter((p) => p.id !== id));
}

/** What to call a machine in the list: the user's name, else its host name, else nothing. */
export function displayName(p: SavedPeer): string {
  return p.name || p.hostname || '';
}

/** `156993080` → `156 993 080` (display only). */
export function formatId(id: string): string {
  return /^\d+$/.test(id) ? id.replace(/\B(?=(\d{3})+$)/g, ' ') : id;
}

/** Vietnamese "5 phút trước" style age; older than a month falls back to the date. */
export function relativeTime(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return 'vừa xong';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ngày trước`;
  const date = new Date(then);
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

/** Stable 0–359 hue for a machine's avatar. */
export function avatarHue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function avatarLetter(p: SavedPeer): string {
  const label = displayName(p);
  const ch = (label || p.id).trim().charAt(0);
  return ch ? ch.toLocaleUpperCase('vi') : '?';
}
