import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import multer from 'multer';
import { securityHeaders } from './middleware/security';
import { createAdminRouter, MAX_FILES_PER_REQUEST, type AdminDeps } from './routes/admin';
import { createSetsArchiveRouter } from './routes/sets-archive';
import { isRecord } from './util/http';
import { distDirOf } from './util/paths';

export const NOT_FOUND: string = 'Не найдено';
export const SERVER_ERROR: string = 'Внутренняя ошибка сервера';
export const BAD_REQUEST: string = 'Некорректный запрос';

const JSON_LIMIT = '16kb';

export interface StaticDirs {
  readonly frontDist: string;
  readonly adminDist: string;
}

export interface AppDeps extends AdminDeps {
  readonly logger: Pick<Console, 'log' | 'error'>;
  readonly dirs?: StaticDirs;
}

function multerMessage(error: multer.MulterError, maxUploadMb: number): string {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return `Файл слишком большой (макс. ${maxUploadMb} МБ)`;
    case 'LIMIT_FILE_COUNT':
      return `Слишком много файлов (макс. ${MAX_FILES_PER_REQUEST})`;
    case 'LIMIT_UNEXPECTED_FILE':
      return 'Неожиданное поле с файлом, ожидается поле files';
    case 'LIMIT_PART_COUNT':
      return 'Слишком много частей в запросе';
    default:
      return 'Ошибка загрузки файлов';
  }
}

function statusOf(error: unknown): number | null {
  if (!isRecord(error)) return null;
  const status = error['status'] ?? error['statusCode'];
  return typeof status === 'number' ? status : null;
}

function apiErrorHandler(deps: AppDeps): ErrorRequestHandler {
  return (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: multerMessage(error, deps.config.maxUploadMb) });
      return;
    }
    if (statusOf(error) !== null) {
      res.status(400).json({ error: BAD_REQUEST });
      return;
    }
    deps.logger.error('[photo-delivery] ошибка обработки запроса:', error);
    res.status(500).json({ error: SERVER_ERROR });
  };
}

function spaFallback(indexFile: string): RequestHandler {
  return (_req, res) => {
    res.sendFile(indexFile);
  };
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  const dirs = deps.dirs ?? { frontDist: distDirOf('front'), adminDist: distDirOf('admin-panel') };
  const frontIndex = path.join(dirs.frontDist, 'index.html');
  const adminIndex = path.join(dirs.adminDist, 'index.html');
  const hasFront = existsSync(dirs.frontDist);
  const hasAdmin = existsSync(dirs.adminDist);

  app.use(securityHeaders);
  app.use('/api', express.json({ limit: JSON_LIMIT }));
  app.use('/api/admin', createAdminRouter(deps));
  app.use('/api', createSetsArchiveRouter({ store: deps.store }));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: NOT_FOUND });
  });
  app.use('/api', apiErrorHandler(deps));

  if (hasFront) app.use(express.static(dirs.frontDist));
  else deps.logger.log(`[photo-delivery] front/dist не найден (${dirs.frontDist}) — сайт не отдаётся этим сервером`);

  if (hasAdmin) app.use('/admin', express.static(dirs.adminDist));
  else deps.logger.log(`[photo-delivery] admin-panel/dist не найден (${dirs.adminDist}) — админка не отдаётся этим сервером`);

  if (hasAdmin) app.get('/admin/*', spaFallback(adminIndex));
  if (hasFront) app.get('*', spaFallback(frontIndex));

  return app;
}
