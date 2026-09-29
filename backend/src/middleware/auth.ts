import type { RequestHandler } from 'express';
import { SESSION_COOKIE, verifySession } from '../auth/session';
import { parseCookies } from '../util/http';
import { UNAUTHORIZED } from './security';

export function requireAdmin(sessionSecret: string): RequestHandler {
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (verifySession(token, sessionSecret)) {
      next();
      return;
    }
    res.status(401).json({ error: UNAUTHORIZED });
  };
}
