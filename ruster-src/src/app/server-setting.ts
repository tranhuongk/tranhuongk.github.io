// The ID server the page talks to: RustDesk's public one, unless `ruster.server` is set in
// localStorage (a self-hosted hbbs, e.g. wss://relay.example.com).
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
