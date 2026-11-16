// Remembered remote PCs ("máy đã kết nối"): partner ID, the name the PC reported and when it was
// last connected. The partner PASSWORD is never stored (UltraViewer rotates it per run anyway).
//
// Storage: key `uvweb.partners` (JSON array) in localStorage only, and only while
// "Nhớ trên thiết bị này" is on, like every other `uvweb.*` key. "Quên thiết bị này" removes it.

export const PARTNERS_STORAGE_KEY = 'uvweb.partners';
export const MAX_SAVED_PARTNERS = 20;
const MAX_NAME_LENGTH = 60;

export interface SavedPartner {
  /** Decimal digits, same rule as the connect form. */
  id: string;
  /** Name the PC reported on its last connection ("" when it sent none). */
  name: string;
  /** Epoch milliseconds of the last accepted connection. */
  lastUsed: number;
}

function isSavedPartner(value: unknown): value is SavedPartner {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' && /^[0-9]{1,64}$/.test(v.id) &&
    typeof v.name === 'string' &&
    typeof v.lastUsed === 'number' && Number.isFinite(v.lastUsed)
  );
}

function sorted(list: SavedPartner[]): SavedPartner[] {
  return [...list].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_SAVED_PARTNERS);
}

/** Newest first. Empty when nothing is stored, the JSON is malformed or storage is blocked. */
export function loadPartners(): SavedPartner[] {
  try {
    const raw = localStorage.getItem(PARTNERS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? sorted(parsed.filter(isSavedPartner)) : [];
  } catch {
    return [];
  }
}

function write(list: SavedPartner[]): SavedPartner[] {
  const next = sorted(list);
  localStorage.setItem(PARTNERS_STORAGE_KEY, JSON.stringify(next));
  return next;
}

/** Adds or refreshes one PC (a blank `name` keeps the stored one). Throws when storage is blocked. */
export function rememberPartner(id: string, name: string | null, now: number): SavedPartner[] {
  const reported = (name ?? '').trim().slice(0, MAX_NAME_LENGTH);
  const list = loadPartners();
  const old = list.find((p) => p.id === id);
  const entry: SavedPartner = { id, name: reported || old?.name || '', lastUsed: now };
  return write([...list.filter((p) => p.id !== id), entry]);
}

/** Removes one PC from the list. */
export function removePartner(id: string): SavedPartner[] {
  return write(loadPartners().filter((p) => p.id !== id));
}

/** Drops the whole list (used when "Nhớ trên thiết bị này" is switched off). */
export function clearPartners(): void {
  try {
    localStorage.removeItem(PARTNERS_STORAGE_KEY);
  } catch {
    // storage blocked: nothing was stored
  }
}
