import type { RequestHandler } from 'express';

export const UNAUTHORIZED: string = 'Не авторизован';

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
};
