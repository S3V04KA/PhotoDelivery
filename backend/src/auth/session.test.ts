import { describe, expect, it } from 'vitest';
import { cookieFlags, SESSION_TTL_SECONDS, signSession, verifySession } from './session';

const SECRET = 'test-session-secret';
const OTHER_SECRET = 'another-secret';
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

describe('verifySession', () => {
  it('принимает подписанный токен', () => {
    const token = signSession(SECRET, NOW);
    expect(verifySession(token, SECRET, NOW + 60_000)).toBe(true);
  });

  it('отклоняет токен с подменённой подписью', () => {
    const token = signSession(SECRET, NOW);
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
    expect(verifySession(tampered, SECRET, NOW)).toBe(false);
  });

  it('отклоняет токен, подписанный чужим секретом', () => {
    expect(verifySession(signSession(OTHER_SECRET, NOW), SECRET, NOW)).toBe(false);
  });

  it('отклоняет просроченный токен и принимает на границе TTL', () => {
    const token = signSession(SECRET, NOW);
    const expiresAt = Math.floor(NOW / 1000) + SESSION_TTL_SECONDS;
    expect(verifySession(token, SECRET, expiresAt * 1000 - 1)).toBe(true);
    expect(verifySession(token, SECRET, expiresAt * 1000)).toBe(false);
  });

  it('отклоняет мусор и отсутствие cookie', () => {
    for (const token of [undefined, '', 'v1', 'v2.1.abc', 'v1.notanumber.abc', 'v1.100.']) {
      expect(verifySession(token, SECRET, NOW)).toBe(false);
    }
  });

  it('не принимает токен с подменённым сроком годности', () => {
    const token = signSession(SECRET, NOW);
    const [version, , signature] = token.split('.');
    const forged = `${version}.${Math.floor(NOW / 1000) + SESSION_TTL_SECONDS * 10}.${signature ?? ''}`;
    expect(verifySession(forged, SECRET, NOW)).toBe(false);
  });
});

describe('cookieFlags', () => {
  it('ставит HttpOnly, SameSite=strict и Path=/', () => {
    expect(cookieFlags(false)).toEqual({ httpOnly: true, sameSite: 'strict', path: '/', secure: false });
  });

  it('включает Secure по флагу COOKIE_SECURE', () => {
    expect(cookieFlags(true).secure).toBe(true);
  });
});

describe('signSession', () => {
  it('живёт 7 дней и содержит версию, срок и подпись', () => {
    const token = signSession(SECRET, NOW);
    const [version, expiresAt, signature] = token.split('.');
    expect(version).toBe('v1');
    expect(Number(expiresAt)).toBe(Math.floor(NOW / 1000) + SESSION_TTL_SECONDS);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySession(token, SECRET, NOW + 7 * DAY_MS - 1)).toBe(true);
  });
});
