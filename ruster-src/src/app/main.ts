import './fonts.css';
import { checkPeer, isValidPeerId, type PeerStatus } from '../net/rendezvous';
import { loadPeers, rememberPeer, removePeer, type SavedPeer } from './saved-peers';
import { loadServer, saveServer } from './server-setting';

const LAYOUT = `
  <header class="top">
    <form id="check-form" autocomplete="off">
      <label>ID RustDesk
        <input id="peer" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
      <div class="row">
        <button id="check" type="submit" class="primary">Kiểm tra</button>
      </div>
    </form>
    <section id="saved" hidden>
      <h2 class="saved-title">Máy đã dùng</h2>
      <ul id="saved-list"></ul>
    </section>
    <p id="result" class="result" role="status" hidden></p>
  </header>
  <details id="diagnostics">
    <summary>Diagnostics</summary>
    <label>Máy chủ RustDesk
      <input id="server" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
  </details>
`;

const MESSAGES: Record<PeerStatus['kind'], (s: PeerStatus) => string> = {
  online: () => 'Máy đang trực tuyến.',
  offline: () => 'Máy không trực tuyến hoặc ID không tồn tại.',
  error: (s) => (s.kind === 'error' ? s.detail : ''),
};

export interface RusterDeps {
  check: typeof checkPeer;
  now: () => number;
}

export function mountRuster(root: HTMLElement, deps: RusterDeps = { check: checkPeer, now: () => Date.now() }): () => void {
  root.innerHTML = LAYOUT;
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const form = $<HTMLFormElement>('check-form');
  const peer = $<HTMLInputElement>('peer');
  const button = $<HTMLButtonElement>('check');
  const savedSection = $('saved');
  const savedList = $<HTMLUListElement>('saved-list');
  const result = $<HTMLParagraphElement>('result');
  const server = $<HTMLInputElement>('server');
  server.value = loadServer();

  const showResult = (kind: PeerStatus['kind'], text: string) => {
    result.hidden = false;
    result.dataset.kind = kind;
    result.textContent = text;
  };

  const renderSaved = (list: SavedPeer[] = loadPeers()) => {
    savedSection.hidden = list.length === 0;
    savedList.replaceChildren(
      ...list.map((p) => {
        const li = document.createElement('li');
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'saved-pick';
        pick.dataset.id = p.id;
        const id = document.createElement('span');
        id.className = 'saved-id';
        id.textContent = p.id;
        pick.append(id);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'text saved-del';
        del.dataset.id = p.id;
        del.setAttribute('aria-label', `Xoá ${p.id}`);
        del.textContent = '×';
        li.append(pick, del);
        return li;
      }),
    );
  };

  savedList.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!target?.dataset.id) return;
    if (target.classList.contains('saved-del')) renderSaved(removePeer(target.dataset.id));
    else {
      peer.value = target.dataset.id;
      peer.focus();
    }
  });
  server.addEventListener('input', () => saveServer(server.value));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const id = peer.value.trim();
    if (!isValidPeerId(id)) {
      showResult('error', 'ID không hợp lệ.');
      return;
    }
    button.disabled = true;
    showResult('error', 'Đang kiểm tra…');
    result.dataset.kind = '';
    void deps.check(id, server.value).then((status) => {
      button.disabled = false;
      showResult(status.kind, MESSAGES[status.kind](status));
      if (status.kind === 'online') renderSaved(rememberPeer(id, deps.now()));
    });
  });

  renderSaved();
  return () => root.replaceChildren();
}

const app = document.getElementById('app');
if (app) mountRuster(app);
