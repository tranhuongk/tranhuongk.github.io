// Remembered Worker/relay URL (Diagnostics → Worker URL). Stored only while "Nhớ trên thiết bị này"
// is on, and only when it differs from the build's default, so a later change of the default
// still reaches devices that never overrode it. "Quên thiết bị này" removes it with the other
// `uvweb.*` keys.

export const WORKER_URL_STORAGE_KEY = 'uvweb.workerUrl';

/** ws:// or wss:// with a host; what `workerChannelOpener` can dial. */
export function isWorkerUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'ws:' || u.protocol === 'wss:') && u.hostname !== '';
  } catch {
    return false;
  }
}

/** The stored URL, or null when absent, malformed or storage is blocked. */
export function loadWorkerUrl(): string | null {
  try {
    const raw = localStorage.getItem(WORKER_URL_STORAGE_KEY);
    return raw !== null && isWorkerUrl(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Keeps `url` when `remember` is on and it is a valid override of `defaultUrl`; removes the key
 * otherwise. Throws when storage is blocked.
 */
export function persistWorkerUrl(url: string, defaultUrl: string, remember: boolean): void {
  const value = url.trim();
  if (remember && value !== defaultUrl && isWorkerUrl(value)) localStorage.setItem(WORKER_URL_STORAGE_KEY, value);
  else localStorage.removeItem(WORKER_URL_STORAGE_KEY);
}
