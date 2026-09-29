import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type AppDeps } from './app';
import { LoginRateLimiter } from './auth/rate-limit';
import { loadConfig } from './config';
import { FakePreviewer } from './testing/fake-previewer';
import { InMemoryStore } from './testing/in-memory-store';
import { TEST_ENV } from './testing/harness';

const NOT_FOUND_BODY = { error: 'Не найдено' };

function appWith(dirs: { frontDist: string; adminDist: string }, logs: string[]): express.Express {
  const deps: AppDeps = {
    config: loadConfig(TEST_ENV),
    store: new InMemoryStore(),
    previewer: new FakePreviewer(),
    limiter: new LoginRateLimiter(5, 15 * 60 * 1000),
    logger: {
      log: (message: string) => logs.push(message),
      error: (...parts: unknown[]) => void parts,
    },
    dirs,
  };
  return createApp(deps);
}

describe('точки входа API', () => {
  it('отдаёт JSON 404 на неизвестный маршрут /api', async () => {
    const app = appWith({ frontDist: '/nonexistent/front', adminDist: '/nonexistent/admin' }, []);

    const response = await request(app).get('/api/nope');

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND_BODY);
  });

  it('отдаёт JSON 404 на неизвестный admin-маршрут', async () => {
    const app = appWith({ frontDist: '/nonexistent/front', adminDist: '/nonexistent/admin' }, []);

    const response = await request(app).post('/api/admin/nope').send({});

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND_BODY);
  });

  it('ставит защитные заголовки на каждый ответ', async () => {
    const app = appWith({ frontDist: '/nonexistent/front', adminDist: '/nonexistent/admin' }, []);

    const response = await request(app).get('/api/admin/me');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('не добавляет CORS-заголовков', async () => {
    const app = appWith({ frontDist: '/nonexistent/front', adminDist: '/nonexistent/admin' }, []);

    const response = await request(app).get('/api/admin/me').set('Origin', 'http://evil.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('отдаёт 400 на битый JSON', async () => {
    const app = appWith({ frontDist: '/nonexistent/front', adminDist: '/nonexistent/admin' }, []);

    const response = await request(app)
      .post('/api/admin/login')
      .set('Content-Type', 'application/json')
      .send('{"login":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Некорректный запрос' });
  });
});

describe('статика и SPA-фолбэки', () => {
  let root = '';

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'pd-app-'));
    const adminDist = path.join(root, 'admin');
    await writeFile(path.join(root, 'index.html'), '<html>site</html>');
    await mkdir(adminDist);
    await writeFile(path.join(adminDist, 'index.html'), '<html>admin</html>');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('отдаёт собранный сайт и админку', async () => {
    const app = appWith({ frontDist: root, adminDist: path.join(root, 'admin') }, []);

    expect((await request(app).get('/')).text).toBe('<html>site</html>');
    expect((await request(app).get('/admin/')).text).toBe('<html>admin</html>');
  });

  it('отдаёт index.html на клиентские маршруты обоих SPA', async () => {
    const app = appWith({ frontDist: root, adminDist: path.join(root, 'admin') }, []);

    expect((await request(app).get('/some/set/photo')).text).toBe('<html>site</html>');
    expect((await request(app).get('/admin/uploads/2026')).text).toBe('<html>admin</html>');
  });

  it('не отдаёт SPA-фолбэк на маршруты /api', async () => {
    const app = appWith({ frontDist: root, adminDist: path.join(root, 'admin') }, []);

    const response = await request(app).get('/api/admin/sets/deep/link');

    expect(response.status).toBe(404);
    expect(response.body).toEqual(NOT_FOUND_BODY);
  });

  it('пишет русский лог, если сборки нет', async () => {
    const logs: string[] = [];
    appWith({ frontDist: path.join(root, 'no-front'), adminDist: path.join(root, 'no-admin') }, logs);

    expect(logs).toHaveLength(2);
    expect(logs.join('\n')).toContain('front/dist не найден');
    expect(logs.join('\n')).toContain('admin-panel/dist не найден');
  });
});
