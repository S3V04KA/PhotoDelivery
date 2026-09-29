import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { rm } from 'node:fs/promises';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { safeEquals } from '../auth/credentials';
import { LoginRateLimiter } from '../auth/rate-limit';
import { cookieFlags, SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from '../auth/session';
import type { Config } from '../config';
import { requireAdmin } from '../middleware/auth';
import { collectKeysUnder, keyExists, listSetFiles, listSets } from '../services/sets';
import type { Previewer } from '../services/preview';
import type { ObjectStore } from '../services/s3';
import { storeUpload, type StoredUpload, type UploadResult } from '../services/uploads';
import { asyncRoute, clientIp, isRecord, readField, stringField } from '../util/http';
import { baseNameOf, extensionOf, objectKey, thumbPrefix, validateObjectName, validateSetId } from '../util/media';

export const MAX_FILES_PER_REQUEST = 20;

const DELETE_CHUNK_SIZE = 1000;
const NO_FILES: string = 'Не выбрано ни одного файла';
const BAD_CREDENTIALS: string = 'Неверный логин или пароль';
const TOO_MANY_ATTEMPTS: string = 'Слишком много попыток. Попробуйте позже.';

export interface AdminDeps {
  readonly config: Config;
  readonly store: ObjectStore;
  readonly previewer: Previewer;
  readonly limiter: LoginRateLimiter;
}

function uploadedFiles(req: Request): readonly StoredUpload[] {
  const files: unknown = req.files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((entry: unknown) => {
    if (!isRecord(entry)) return [];
    const originalname = stringField(entry, 'originalname');
    const path = stringField(entry, 'path');
    return originalname.length > 0 && path.length > 0 ? [{ originalname, path }] : [];
  });
}

async function removeUploads(files: readonly StoredUpload[]): Promise<void> {
  await Promise.all(files.map((file) => rm(file.path, { force: true })));
}

function* batches(keys: readonly string[], size: number): Generator<string[]> {
  for (let offset = 0; offset < keys.length; offset += size) {
    yield keys.slice(offset, offset + size);
  }
}

function readCredentials(body: unknown): { login: string; password: string } {
  if (!isRecord(body)) return { login: '', password: '' };
  return { login: stringField(body, 'login'), password: stringField(body, 'password') };
}

export function createAdminRouter(deps: AdminDeps): Router {
  const router = Router();
  const guard = requireAdmin(deps.config.sessionSecret);
  const upload = multer({
    storage: multer.diskStorage({
      destination: os.tmpdir(),
      filename: (_req, file, callback) => {
        const ext = extensionOf(file.originalname);
        callback(null, ext.length > 0 ? `${randomUUID()}.${ext}` : randomUUID());
      },
    }),
    limits: { fileSize: deps.config.maxUploadBytes, files: MAX_FILES_PER_REQUEST },
  }).array('files', MAX_FILES_PER_REQUEST);

  router.post('/login', (req: Request, res: Response) => {
    const body: unknown = req.body;
    const ip = clientIp(req);
    if (deps.limiter.isBlocked(ip)) {
      res.status(429).json({ error: TOO_MANY_ATTEMPTS });
      return;
    }
    const input = readCredentials(body);
    const loginOk = safeEquals(input.login, deps.config.adminLogin);
    const passwordOk = safeEquals(input.password, deps.config.adminPassword);
    if (!loginOk || !passwordOk) {
      deps.limiter.recordFailure(ip);
      res.status(401).json({ error: BAD_CREDENTIALS });
      return;
    }
    deps.limiter.reset(ip);
    res.cookie(SESSION_COOKIE, signSession(deps.config.sessionSecret), {
      ...cookieFlags(deps.config.cookieSecure),
      maxAge: SESSION_TTL_SECONDS * 1000,
    });
    res.json({ ok: true });
  });

  router.post('/logout', guard, (_req: Request, res: Response) => {
    res.clearCookie(SESSION_COOKIE, cookieFlags(deps.config.cookieSecure));
    res.json({ ok: true });
  });

  router.get('/me', guard, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  router.get('/sets', guard, asyncRoute(async (_req, res) => {
    res.json({ sets: await listSets(deps.store) });
  }));

  router.get('/sets/:id/files', guard, asyncRoute(async (req, res) => {
    const setId = validateSetId(req.params.id);
    if (!setId.ok) {
      res.status(400).json({ error: setId.error });
      return;
    }
    res.json({ files: await listSetFiles(deps.store, setId.value) });
  }));

  router.post('/uploads', guard, upload, asyncRoute(async (req, res) => {
    const files = uploadedFiles(req);
    const body: unknown = req.body;
    const setId = validateSetId(readField(body, 'setId'));
    if (!setId.ok) {
      await removeUploads(files);
      res.status(400).json({ error: setId.error });
      return;
    }
    if (files.length === 0) {
      res.status(400).json({ error: NO_FILES });
      return;
    }
    const results: UploadResult[] = [];
    for (const file of files) {
      results.push(await storeUpload(deps, setId.value, file));
    }
    const done = results.filter((result) => result.ok).length;
    res.json({ results, done, failed: results.length - done });
  }));

  router.delete('/sets/:id', guard, asyncRoute(async (req, res) => {
    const setId = validateSetId(req.params.id);
    if (!setId.ok) {
      res.status(400).json({ error: setId.error });
      return;
    }
    const keys = await collectKeysUnder(deps.store, setId.value);
    for (const batch of batches(keys, DELETE_CHUNK_SIZE)) {
      await deps.store.deleteKeys(batch);
    }
    res.json({ deleted: keys.length });
  }));

  router.delete('/sets/:id/files', guard, asyncRoute(async (req, res) => {
    const setId = validateSetId(req.params.id);
    if (!setId.ok) {
      res.status(400).json({ error: setId.error });
      return;
    }
    const name = validateObjectName(readField(req.query, 'name'));
    if (!name.ok) {
      res.status(400).json({ error: name.error });
      return;
    }
    const original = objectKey(setId.value, name.value);
    const existed = await keyExists(deps.store, original);
    const thumbs = thumbPrefix(setId.value);
    await deps.store.deleteKeys([
      original,
      `${thumbs}${name.value}`,
      `${thumbs}${baseNameOf(name.value)}.jpg`,
    ]);
    res.json({ deleted: existed ? 1 : 0 });
  }));

  return router;
}
