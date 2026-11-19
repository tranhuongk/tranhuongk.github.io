import { beforeEach, describe, expect, test } from 'vitest';
import {
  avatarHue, avatarLetter, displayName, formatId, loadPeers, MAX_NAME_LENGTH, PEERS_KEY, relativeTime, rememberPeer,
  removePeer, renamePeer,
} from './saved-peers';

beforeEach(() => localStorage.clear());

describe('saved peers', () => {
  test('remembering keeps the user\'s name and the host name across refreshes', () => {
    rememberPeer('111', 1000, 'likks-macbook');
    renamePeer('111', 'Mac nhà');
    rememberPeer('111', 2000);
    expect(loadPeers()).toEqual([{ id: '111', lastUsed: 2000, name: 'Mac nhà', hostname: 'likks-macbook' }]);
    rememberPeer('111', 3000, 'new-host');
    expect(loadPeers()[0]).toMatchObject({ name: 'Mac nhà', hostname: 'new-host', lastUsed: 3000 });
  });

  test('renaming trims and caps the name; a blank name removes it; unknown ids are ignored', () => {
    rememberPeer('111', 1, 'host');
    renamePeer('111', `  ${'x'.repeat(100)}  `);
    expect(loadPeers()[0]!.name).toBe('x'.repeat(MAX_NAME_LENGTH));
    renamePeer('111', '   ');
    expect(loadPeers()[0]).toEqual({ id: '111', lastUsed: 1, hostname: 'host' });
    renamePeer('999', 'nobody');
    expect(loadPeers()).toHaveLength(1);
  });

  test('displayName prefers the user\'s name, then the host name', () => {
    expect(displayName({ id: '1', lastUsed: 0, name: 'A', hostname: 'B' })).toBe('A');
    expect(displayName({ id: '1', lastUsed: 0, hostname: 'B' })).toBe('B');
    expect(displayName({ id: '1', lastUsed: 0 })).toBe('');
  });

  test('entries saved by the first version (id + time only) still load; junk is dropped', () => {
    localStorage.setItem(PEERS_KEY, JSON.stringify([{ id: '222', lastUsed: 5 }, { id: 'bad id', lastUsed: 1 }, { id: '333', lastUsed: 2, name: 7 }]));
    expect(loadPeers()).toEqual([{ id: '222', lastUsed: 5 }]);
    expect(removePeer('222')).toEqual([]);
  });

  test('formatId groups digits; other ids stay as they are', () => {
    expect(formatId('156993080')).toBe('156 993 080');
    expect(formatId('1234567890')).toBe('1 234 567 890');
    expect(formatId('ab-12')).toBe('ab-12');
  });

  test('relativeTime in Vietnamese', () => {
    const now = Date.UTC(2026, 10, 20, 12, 0, 0);
    expect(relativeTime(now - 10_000, now)).toBe('vừa xong');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 phút trước');
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('3 giờ trước');
    expect(relativeTime(now - 2 * 86400_000, now)).toBe('2 ngày trước');
    expect(relativeTime(now - 90 * 86400_000, now)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(relativeTime(now + 5000, now)).toBe('vừa xong');
  });

  test('avatar: stable hue and the first letter of the name or id', () => {
    expect(avatarHue('156993080')).toBe(avatarHue('156993080'));
    expect(avatarHue('156993080')).toBeLessThan(360);
    expect(avatarLetter({ id: '1', lastUsed: 0, name: 'máy bàn' })).toBe('M');
    expect(avatarLetter({ id: '42', lastUsed: 0 })).toBe('4');
  });
});
