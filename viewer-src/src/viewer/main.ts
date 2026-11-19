// Entry of the web viewer page. In `vite dev` only, `?fake` swaps the relay for a local demo
// session (no network, no credentials) so the UI can be exercised without a Windows machine;
// the production build drops that branch and its module entirely (the demo needs no crypto, so it
// also works on http://<LAN-IP>; the real session does not and is refused there).
import { WORKER_URL } from '../config';
import { resolveIPv4 } from '../net/dns';
import { RelaySession } from '../session/relay-session';
import { workerChannelOpener } from '../session/worker-channel';
import './fonts.css';
import { insecureContextNotice } from './secure-context';
import { mountViewer, type ViewerDeps } from './viewer';

/** Per-relay open times of earlier command connections (see RelaySessionDeps.commandLatency). */
const COMMAND_LATENCY_STORAGE_KEY = 'uvweb.commandLatency';

const realSession: ViewerDeps['createSession'] = ({ workerUrl }) =>
  new RelaySession({
    openChannel: workerChannelOpener({ workerUrl }),
    resolve: resolveIPv4,
    commandLatency: {
      load: () => {
        try {
          const parsed: unknown = JSON.parse(localStorage.getItem(COMMAND_LATENCY_STORAGE_KEY) ?? '{}');
          return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, number>) : {};
        } catch {
          return {};
        }
      },
      save: (latency) => localStorage.setItem(COMMAND_LATENCY_STORAGE_KEY, JSON.stringify(latency)),
    },
    now: () => performance.now(),
  });

function start(createSession: ViewerDeps['createSession'], insecureNotice: string | null): void {
  const app = document.getElementById('app');
  if (app) mountViewer(app, { createSession, workerUrl: WORKER_URL, insecureNotice });
}

if (import.meta.env.DEV && new URLSearchParams(location.search).has('fake')) {
  void import('./dev-fake-session').then((m) => start(m.createDevFakeSession(new URLSearchParams(location.search)), null));
} else {
  start(realSession, insecureContextNotice());
}
