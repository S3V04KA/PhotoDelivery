import { describe, expect, it } from 'vitest';
import { safeEquals } from './credentials';

describe('safeEquals', () => {
  it('возвращает true для одинаковых строк', () => {
    expect(safeEquals('secret-pass', 'secret-pass')).toBe(true);
  });

  it('возвращает false для разных строк', () => {
    expect(safeEquals('secret-pass', 'secret-pas')).toBe(false);
    expect(safeEquals('admin', 'Admin')).toBe(false);
  });

  it('не бросает на строках разной длины', () => {
    expect(safeEquals('a', 'a-very-long-secret-value')).toBe(false);
    expect(safeEquals('', 'x')).toBe(false);
    expect(safeEquals('', '')).toBe(true);
  });
});
