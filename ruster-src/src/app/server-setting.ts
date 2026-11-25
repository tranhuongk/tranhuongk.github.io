// The ID server the page talks to, picked in the "Máy chủ" select and kept per device:
// our own hbbs (default), RustDesk's public server, or a custom host + key.
import { PUBLIC_SERVER_KEY, SELF_SERVER_KEY } from '../net/crypto';
import { DEFAULT_SERVER, PUBLIC_SERVER } from '../net/rendezvous';

export const SERVER_KEY = 'ruster.server';
export const SERVER_PUBKEY_KEY = 'ruster.serverKey';

export type ServerChoice = 'self' | 'public' | 'custom';

const KNOWN_KEYS: Record<string, string> = {
  [DEFAULT_SERVER]: SELF_SERVER_KEY,
  [PUBLIC_SERVER]: PUBLIC_SERVER_KEY,
};

const trimUrl = (server: string) => server.trim().replace(/\/+$/, '');

function stored(key: string): string | undefined {
  try {
    return localStorage.getItem(key)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function store(key: string, value: string | undefined): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // storage blocked: nothing is kept
  }
}

export function loadServer(): string {
  return stored(SERVER_KEY) ?? DEFAULT_SERVER;
}

/** Ed25519 key that signs the ID server's relay answers; undefined for an unknown server. */
export function loadServerKey(server: string = loadServer()): string | undefined {
  return stored(SERVER_PUBKEY_KEY) ?? KNOWN_KEYS[trimUrl(server)];
}

/** Which option of the "Máy chủ" select the stored setting matches. */
export function serverChoice(): ServerChoice {
  if (stored(SERVER_PUBKEY_KEY)) return 'custom';
  const s = trimUrl(loadServer());
  if (s === DEFAULT_SERVER) return 'self';
  if (s === PUBLIC_SERVER) return 'public';
  return 'custom';
}

/** Stores the choice; `custom` takes a host (wss://… or a bare domain) and an optional key. */
export function saveServer(choice: ServerChoice, host = '', key = ''): void {
  if (choice === 'self') {
    store(SERVER_KEY, undefined);
    store(SERVER_PUBKEY_KEY, undefined);
  } else if (choice === 'public') {
    store(SERVER_KEY, PUBLIC_SERVER);
    store(SERVER_PUBKEY_KEY, undefined);
  } else {
    store(SERVER_KEY, trimUrl(host) || undefined);
    store(SERVER_PUBKEY_KEY, key.trim() || undefined);
  }
}

/**
 * One-paste setup code for the machines being controlled (their ID/Relay server dialog → paste icon):
 * JSON {host, relay, api, key} → base64url (padded) → reversed, the same as the desktop app's export.
 * Undefined when there is nothing to paste (the public server, or a custom host without a key).
 */
export function serverConfigCode(server: string = loadServer(), key: string | undefined = loadServerKey(server)): string | undefined {
  if (!key || trimUrl(server) === PUBLIC_SERVER) return undefined;
  const host = trimUrl(server).replace(/^wss?:\/\//, '').replace(/\/ws\/id$/, '');
  if (!host) return undefined;
  const json = JSON.stringify({ host, relay: '', api: '', key });
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_');
  return [...b64].reverse().join('');
}
