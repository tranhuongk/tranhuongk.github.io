import { describe, expect, test, vi } from 'vitest';
import { CONTROL_KEY } from '../proto/message';
import { diffTyping, SoftKeyboard } from './soft-keyboard';

describe('soft keyboard', () => {
  test('diffTyping: added text, deletions, and Telex rewriting a letter', () => {
    expect(diffTyping('ab', 'abc')).toEqual({ backspaces: 0, text: 'c' });
    expect(diffTyping('abc', 'ab')).toEqual({ backspaces: 1, text: '' });
    expect(diffTyping('xa', 'xâ')).toEqual({ backspaces: 1, text: 'â' });
  });

  test('typing in the field sends text; deleting sends Backspace; Enter goes as a key', () => {
    const host = document.createElement('div');
    const sent: unknown[] = [];
    const kb = new SoftKeyboard(host, (k) => sent.push(k), vi.fn());
    kb.open();
    const f = kb.field;
    const start = f.value;
    f.value = start + 'hi';
    f.dispatchEvent(new Event('input'));
    f.value = start + 'h';
    f.dispatchEvent(new Event('input'));
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' }));
    expect(sent).toEqual([{ text: 'hi' }, { controlKey: CONTROL_KEY.Backspace }, { controlKey: CONTROL_KEY.Return, modifiers: undefined }]);
    kb.destroy();
  });

  test('IME composition is typed as it changes and corrected when it ends', () => {
    const host = document.createElement('div');
    const sent: unknown[] = [];
    const kb = new SoftKeyboard(host, (k) => sent.push(k), vi.fn());
    const f = kb.field;
    const start = f.value;
    f.dispatchEvent(new Event('compositionstart'));
    f.value = start + 'vie';
    f.dispatchEvent(new Event('input'));
    f.value = start + 'việt';
    f.dispatchEvent(new Event('compositionend'));
    expect(sent).toEqual([{ text: 'vie' }, { controlKey: CONTROL_KEY.Backspace }, { text: 'ệt' }]);
    kb.destroy();
  });

  test('macOS Telex: "aas" turns into "ấ" on the remote as it is typed', () => {
    const host = document.createElement('div');
    const sent: unknown[] = [];
    const kb = new SoftKeyboard(host, (k) => sent.push(k), vi.fn());
    const f = kb.field;
    const start = f.value;
    f.dispatchEvent(new Event('compositionstart'));
    for (const v of ['a', 'â', 'ấ']) {
      f.value = start + v;
      f.dispatchEvent(new Event('input'));
    }
    f.dispatchEvent(new Event('compositionend'));
    const bs = { controlKey: CONTROL_KEY.Backspace };
    expect(sent).toEqual([{ text: 'a' }, bs, { text: 'â' }, bs, { text: 'ấ' }]);
    kb.destroy();
  });

  test('Unikey-style rewrite: Backspace key, then the accented letter', () => {
    const host = document.createElement('div');
    const sent: unknown[] = [];
    const kb = new SoftKeyboard(host, (k) => sent.push(k), vi.fn());
    const f = kb.field;
    const start = f.value;
    f.value = start + 'a';
    f.dispatchEvent(new Event('input'));
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', cancelable: true }));
    f.value = start + 'aá';
    f.dispatchEvent(new Event('input'));
    expect(sent).toEqual([{ text: 'a' }, { controlKey: CONTROL_KEY.Backspace, modifiers: undefined }, { text: 'á' }]);
    kb.destroy();
  });

  test('a paste shortcut is handed over, not typed or sent as keys', () => {
    const host = document.createElement('div');
    const sent: unknown[] = [];
    const chords: unknown[] = [];
    const kb = new SoftKeyboard(host, (k) => sent.push(k), vi.fn(), (k) => chords.push(k));
    const e = new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', metaKey: true, cancelable: true });
    kb.field.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(sent).toEqual([]);
    expect(chords).toEqual([{ chr: 0x76, modifiers: [CONTROL_KEY.Meta] }]);
    kb.destroy();
  });

  test('with a gap, Telex "vao" → "vào" sends each Backspace apart, then the letters, in order', () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    const kb = new SoftKeyboard(host, (k) => sent.push(JSON.stringify(k)), () => {}, undefined, undefined, 25);
    kb.open();
    const start = kb.field.value;
    for (const v of ['v', 'va', 'vao', 'vào']) {
      kb.field.value = start + v;
      kb.field.dispatchEvent(new Event('input'));
    }
    expect(sent).toEqual(['{"text":"v"}', '{"text":"a"}', '{"text":"o"}', '{"controlKey":2}']);
    vi.advanceTimersByTime(24);
    expect(sent).toHaveLength(4);
    vi.advanceTimersByTime(1);
    expect(sent.at(-1)).toBe('{"controlKey":2}');
    vi.advanceTimersByTime(25);
    expect(sent.slice(4)).toEqual(['{"controlKey":2}', '{"text":"ào"}']);
    kb.destroy();
    vi.useRealTimers();
  });
});
