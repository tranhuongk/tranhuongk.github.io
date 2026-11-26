import { describe, expect, test } from 'vitest';
import { selfConfigCode } from './server-setting';

describe('RustDesk config code', () => {
  test('the Hà Nội code is the one RustDesk imports (verified by hand earlier)', () => {
    expect(selfConfigCode()).toBe('=0nI9sWblZUeCZ0Y2xmUNlDMhNTV5EXa44WMw4WayI2QVdHMtFVd2hjYWpWRGplI6ISeltmIsIiI6ISawFmIsIiI6ISehxWZyJCLi8WauAXasN3cuEjMx0CN4ETL1cTLzATMiojI0N3boJye');
  });
});
