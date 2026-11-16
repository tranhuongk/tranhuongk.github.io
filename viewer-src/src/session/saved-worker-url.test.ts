// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { isWorkerUrl, loadWorkerUrl, persistWorkerUrl, WORKER_URL_STORAGE_KEY } from './saved-worker-url';

const DEFAULT = 'wss://default.example.workers.dev';

describe('saved worker url', () => {
  beforeEach(() => localStorage.clear());

  test('accepts only ws/wss URLs with a host', () => {
    expect(isWorkerUrl('wss://a.trycloudflare.com')).toBe(true);
    expect(isWorkerUrl('ws://127.0.0.1:8099')).toBe(true);
    expect(isWorkerUrl('https://a.com')).toBe(false);
    expect(isWorkerUrl('wss://')).toBe(false);
    expect(isWorkerUrl('abc')).toBe(false);
  });

  test('stores an override only with "Nhớ"', () => {
    persistWorkerUrl(' wss://relay.example.com ', DEFAULT, true);
    expect(loadWorkerUrl()).toBe('wss://relay.example.com');
    persistWorkerUrl('wss://relay.example.com', DEFAULT, false);
    expect(localStorage.getItem(WORKER_URL_STORAGE_KEY)).toBeNull();
  });

  test('the default and invalid input are not stored', () => {
    persistWorkerUrl(DEFAULT, DEFAULT, true);
    expect(localStorage.getItem(WORKER_URL_STORAGE_KEY)).toBeNull();
    persistWorkerUrl('not a url', DEFAULT, true);
    expect(localStorage.getItem(WORKER_URL_STORAGE_KEY)).toBeNull();
  });

  test('a malformed stored value is ignored', () => {
    localStorage.setItem(WORKER_URL_STORAGE_KEY, 'javascript:alert(1)');
    expect(loadWorkerUrl()).toBeNull();
  });
});
