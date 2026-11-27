import './fonts.css';
import '../index.css';
import './stage.css';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ConnectScreen } from './connect';
import { DEFAULT_DEPS, Ruster, type RusterDeps } from './ruster';
import { STAGE_HTML } from './stage';

export type { AccountApi, RusterDeps } from './ruster';

/** Mounts the app into `root`: the React connect page plus the plain-DOM remote screen. */
export function mountRuster(root: HTMLElement, deps: RusterDeps = DEFAULT_DEPS): () => void {
  root.innerHTML = `<div id="connect-root"></div><section id="stage">${STAGE_HTML}</section>`;
  const ruster = new Ruster(root, root.querySelector<HTMLElement>('#stage')!, deps);
  const view = createRoot(root.querySelector<HTMLElement>('#connect-root')!);
  flushSync(() => view.render(<ConnectScreen ruster={ruster} now={deps.now} />));
  ruster.start();
  return () => {
    ruster.destroy();
    view.unmount();
    root.replaceChildren();
  };
}

const app = document.getElementById('app');
if (app) {
  // Follow the system light / dark setting (shadcn tokens switch on the .dark class).
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)');
  const theme = () => document.documentElement.classList.toggle('dark', Boolean(dark?.matches));
  theme();
  dark?.addEventListener('change', theme);
  mountRuster(app);
}
