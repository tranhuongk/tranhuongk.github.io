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

  test('IME composition is typed once it ends', () => {
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
    expect(sent).toEqual([{ text: 'việt' }]);
    kb.destroy();
  });
});
