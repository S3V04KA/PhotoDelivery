import type { Express } from 'express';
import request from 'supertest';
import { createApp, type AppDeps, type StaticDirs } from '../app';
import { LoginRateLimiter } from '../auth/rate-limit';
import { loadConfig, type Config } from '../config';
import { FakePreviewer } from './fake-previewer';
import { InMemoryStore } from './in-memory-store';

export const TEST_ENV: Readonly<Record<string, string>> = {
  PORT: '8080',
  ADMIN_LOGIN: 'admin',
  ADMIN_PASSWORD: 'secret-pass',
  SESSION_SECRET: 'test-session-secret',
  S3_ACCESS_KEY_ID: 'test-key',
  S3_SECRET_ACCESS_KEY: 'test-secret',
  S3_BUCKET: 'photos',
};

export const MISSING_DIRS: StaticDirs = {
  frontDist: '/nonexistent/photo-delivery/front/dist',
  adminDist: '/nonexistent/photo-delivery/admin-panel/dist',
};

export interface Harness {
  readonly app: Express;
  readonly store: InMemoryStore;
  readonly previewer: FakePreviewer;
  readonly logs: readonly string[];
  readonly errors: readonly unknown[];
}

export function makeHarness(env: Readonly<Record<string, string>> = TEST_ENV, overrides: Partial<Config> = {}): Harness {
  const logs: string[] = [];
  const errors: unknown[] = [];
  const store = new InMemoryStore();
  const previewer = new FakePreviewer();
  const deps: AppDeps = {
    config: { ...loadConfig(env), ...overrides },
    store,
    previewer,
    limiter: new LoginRateLimiter(5, 15 * 60 * 1000),
    logger: {
      log: (message: string) => logs.push(message),
      error: (...parts: unknown[]) => errors.push(parts),
    },
    dirs: MISSING_DIRS,
  };
  return { app: createApp(deps), store, previewer, logs, errors };
}

export async function loginCookie(app: Express): Promise<string> {
  const response = await request(app)
    .post('/api/admin/login')
    .send({ login: TEST_ENV.ADMIN_LOGIN, password: TEST_ENV.ADMIN_PASSWORD });
  const header = response.headers['set-cookie'];
  const first = Array.isArray(header) ? header[0] : header;
  if (first === undefined) throw new Error('сессионная cookie не выдана');
  return first.split(';')[0] ?? '';
}
