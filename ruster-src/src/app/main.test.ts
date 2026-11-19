import { beforeEach, describe, expect, test, vi } from 'vitest';
import { mountRuster } from './main';
import { PEERS_KEY } from './saved-peers';
import { SERVER_KEY } from './server-setting';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ruster page', () => {
  let app: HTMLElement;
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
    app = document.getElementById('app')!;
  });

  const submit = (id: string) => {
    app.querySelector<HTMLInputElement>('#peer')!.value = id;
    app.querySelector<HTMLFormElement>('#check-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  };

  test('shows only the id field and the check button, no title or description', () => {
    mountRuster(app);
    expect(app.querySelector('h1')).toBeNull();
    expect(app.querySelector('#peer')).not.toBeNull();
    expect(app.querySelector('#check')?.textContent).toBe('Kiểm tra');
    expect(app.querySelector<HTMLElement>('#saved')!.hidden).toBe(true);
  });

  test('an online peer is reported and remembered; picking it fills the id; × forgets it', async () => {
    const check = vi.fn().mockResolvedValue({ kind: 'online' });
    mountRuster(app, { check, now: () => 1000 });
    submit('123456789');
    await flush();
    expect(check).toHaveBeenCalledWith('123456789', 'wss://rs-ny.rustdesk.com');
    expect(app.querySelector('#result')!.textContent).toContain('trực tuyến');
    expect(JSON.parse(localStorage.getItem(PEERS_KEY)!)).toEqual([{ id: '123456789', lastUsed: 1000 }]);
    app.querySelector<HTMLInputElement>('#peer')!.value = '';
    app.querySelector<HTMLButtonElement>('.saved-pick')!.click();
    expect(app.querySelector<HTMLInputElement>('#peer')!.value).toBe('123456789');
    app.querySelector<HTMLButtonElement>('.saved-del')!.click();
    expect(localStorage.getItem(PEERS_KEY)).toBe('[]');
    expect(app.querySelector<HTMLElement>('#saved')!.hidden).toBe(true);
  });

  test('an offline peer is not remembered, a bad id never reaches the network', async () => {
    const check = vi.fn().mockResolvedValue({ kind: 'offline' });
    mountRuster(app, { check, now: () => 1 });
    submit('123456789');
    await flush();
    expect(app.querySelector('#result')!.getAttribute('data-kind')).toBe('offline');
    expect(localStorage.getItem(PEERS_KEY)).toBeNull();
    submit('bad id');
    expect(check).toHaveBeenCalledTimes(1);
    expect(app.querySelector('#result')!.textContent).toBe('ID không hợp lệ.');
  });

  test('the server override is kept only when it differs from the default', () => {
    mountRuster(app);
    const server = app.querySelector<HTMLInputElement>('#server')!;
    server.value = 'wss://relay.example.com';
    server.dispatchEvent(new Event('input'));
    expect(localStorage.getItem(SERVER_KEY)).toBe('wss://relay.example.com');
    server.value = 'wss://rs-ny.rustdesk.com';
    server.dispatchEvent(new Event('input'));
    expect(localStorage.getItem(SERVER_KEY)).toBeNull();
  });
});
