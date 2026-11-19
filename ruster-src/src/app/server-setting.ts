// The ID server the page talks to; an override is kept on the device like the viewer's Worker URL.
import { DEFAULT_SERVER } from '../net/rendezvous';

export const SERVER_KEY = 'ruster.server';

export function loadServer(): string {
  try {
    const v = localStorage.getItem(SERVER_KEY)?.trim();
    return v ? v : DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}

export function saveServer(value: string): void {
  const v = value.trim();
  try {
    if (v && v !== DEFAULT_SERVER) localStorage.setItem(SERVER_KEY, v);
    else localStorage.removeItem(SERVER_KEY);
  } catch {
    // storage blocked
  }
}
