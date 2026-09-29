import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncRoute(route: AsyncRoute): RequestHandler {
  return (req, res, next) => {
    route(req, res, next).catch(next);
  };
}

export function parseCookies(header: string | undefined): Readonly<Record<string, string>> {
  const jar: Record<string, string> = {};
  if (header === undefined) return jar;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    if (key.length > 0) jar[key] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return jar;
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function stringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

export function readField(source: unknown, key: string): unknown {
  return isRecord(source) ? source[key] : undefined;
}

const PLAIN_FILENAME = /^[\x20-\x7e]*$/;

export function contentDisposition(fileName: string): string {
  if (PLAIN_FILENAME.test(fileName) && !fileName.includes('"') && !fileName.includes('\\')) {
    return `attachment; filename="${fileName}"`;
  }
  const ascii = fileName.replace(/[^\x20-\x7e"\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

