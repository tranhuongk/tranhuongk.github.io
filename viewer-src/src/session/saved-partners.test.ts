// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest';
import { clearPartners, loadPartners, MAX_SAVED_PARTNERS, PARTNERS_STORAGE_KEY, rememberPartner, removePartner } from './saved-partners';

describe('saved partners', () => {
  beforeEach(() => localStorage.clear());

  test('starts empty and ignores malformed storage', () => {
    expect(loadPartners()).toEqual([]);
    localStorage.setItem(PARTNERS_STORAGE_KEY, '{oops');
    expect(loadPartners()).toEqual([]);
    localStorage.setItem(PARTNERS_STORAGE_KEY, JSON.stringify([{ id: 'x', name: 'a', lastUsed: 1 }, { id: '1', name: 'ok', lastUsed: 2 }]));
    expect(loadPartners()).toEqual([{ id: '1', name: 'ok', lastUsed: 2 }]);
  });

  test('remembers a PC, newest first, and never stores a password', () => {
    rememberPartner('111', 'Kế toán', 1000);
    rememberPartner('222', 'Kho', 2000);
    expect(loadPartners().map((p) => p.id)).toEqual(['222', '111']);
    expect(localStorage.getItem(PARTNERS_STORAGE_KEY)).not.toMatch(/password/i);
  });

  test('reconnecting refreshes the entry and keeps the name when none is reported', () => {
    rememberPartner('111', 'Kế toán', 1000);
    rememberPartner('222', 'Kho', 2000);
    rememberPartner('111', null, 3000);
    expect(loadPartners()).toEqual([
      { id: '111', name: 'Kế toán', lastUsed: 3000 },
      { id: '222', name: 'Kho', lastUsed: 2000 },
    ]);
    rememberPartner('111', ' Kế toán 2 ', 4000);
    expect(loadPartners()[0]!.name).toBe('Kế toán 2');
  });

  test('keeps at most MAX_SAVED_PARTNERS, dropping the oldest', () => {
    for (let i = 0; i < MAX_SAVED_PARTNERS + 3; i++) rememberPartner(String(100 + i), '', i);
    const list = loadPartners();
    expect(list).toHaveLength(MAX_SAVED_PARTNERS);
    expect(list.some((p) => p.id === '100')).toBe(false);
  });

  test('removePartner and clearPartners', () => {
    rememberPartner('111', 'A', 1);
    rememberPartner('222', 'B', 2);
    expect(removePartner('111').map((p) => p.id)).toEqual(['222']);
    clearPartners();
    expect(localStorage.getItem(PARTNERS_STORAGE_KEY)).toBeNull();
  });
});
