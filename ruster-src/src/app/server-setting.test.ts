import { beforeEach, describe, expect, test } from 'vitest';
import { saveServer, serverConfigCode } from './server-setting';

// The code the desktop app's own export produces for our server (decoded and checked by hand).
const SELF_CODE = '=0nI9sWblZUeCZ0Y2xmUNlDMhNTV5EXa44WMw4WayI2QVdHMtFVd2hjYWpWRGplI6ISeltmIsIiI6ISawFmIsIiI6ISehxWZyJCLi8WauAXasN3cuEjMx0CN4ETL1cTLzATMiojI0N3boJye';

describe('serverConfigCode', () => {
  beforeEach(() => localStorage.clear());

  test('our server gives the one-paste code, byte for byte', () => {
    expect(serverConfigCode()).toBe(SELF_CODE);
  });

  test('the public server has no code; a custom host has one only with a key', () => {
    saveServer('public');
    expect(serverConfigCode()).toBeUndefined();
    saveServer('custom', 'rd.example.com');
    expect(serverConfigCode()).toBeUndefined();
    saveServer('custom', 'wss://rd.example.com/', 'KEY=');
    const code = serverConfigCode()!;
    const json = atob([...code].reverse().join('').replace(/-/g, '+').replace(/_/g, '/'));
    expect(JSON.parse(json)).toEqual({ host: 'rd.example.com', relay: '', api: '', key: 'KEY=' });
  });
});
