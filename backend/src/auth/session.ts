import { createHmac } from 'node:crypto';
import { safeEquals } from './credentials';

export const SESSION_COOKIE = 'pd_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const VERSION = 'v1';
const EXPIRY_PATTERN = /^\d{1,15}$/;

function signature(secret: string, expiresAt: number): string {
  return createHmac('sha256', secret).update(`${VERSION}:${expiresAt}`).digest('hex');
}

export function signSession(secret: string, nowMs: number = Date.now()): string {
  const expiresAt = Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
  return `${VERSION}.${expiresAt}.${signature(secret, expiresAt)}`;
}

export function verifySession(
  token: string | undefined,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  if (token === undefined) return false;
  const parts = token.split('.');
  const version = parts[0];
  const expiresAtRaw = parts[1];
  const providedSignature = parts[2];
  if (version !== VERSION || expiresAtRaw === undefined || providedSignature === undefined) return false;
  if (!EXPIRY_PATTERN.test(expiresAtRaw)) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!safeEquals(signature(secret, expiresAt), providedSignature)) return false;
  return expiresAt * 1000 > nowMs;
}

export interface CookieFlags {
  readonly httpOnly: true;
  readonly sameSite: 'strict';
  readonly path: '/';
  readonly secure: boolean;
}

export function cookieFlags(secure: boolean): CookieFlags {
  return { httpOnly: true, sameSite: 'strict', path: '/', secure };
}
