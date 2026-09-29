import { createHash } from 'node:crypto';

export interface S3Config {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

export interface Config {
  readonly port: number;
  readonly s3: S3Config;
  readonly adminLogin: string;
  readonly adminPassword: string;
  readonly sessionSecret: string;
  readonly maxUploadMb: number;
  readonly maxUploadBytes: number;
  readonly thumbSize: number;
  readonly thumbQuality: number;
  readonly cookieSecure: boolean;
}

export const CRITICAL_ENV = ['ADMIN_PASSWORD', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;

export type Env = Readonly<Record<string, string | undefined>>;

export function criticalEnvMissing(env: Env): readonly string[] {
  return CRITICAL_ENV.filter((name) => (env[name] ?? '').trim().length === 0);
}

function text(env: Env, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value.trim().length === 0 ? fallback : value;
}

function intInRange(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function deriveSessionSecret(login: string, password: string): string {
  return createHash('sha256').update(`${login}:${password}:photo-delivery`).digest('hex');
}

export function loadConfig(env: Env): Config {
  const adminLogin = text(env, 'ADMIN_LOGIN', 'admin');
  const adminPassword = env.ADMIN_PASSWORD ?? '';
  const maxUploadMb = intInRange(env, 'MAX_UPLOAD_MB', 512, 1, 10240);
  return {
    port: intInRange(env, 'PORT', 8080, 1, 65535),
    s3: {
      endpoint: text(env, 'S3_ENDPOINT', 'http://localhost:9000'),
      region: text(env, 'S3_REGION', 'us-east-1'),
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
      bucket: text(env, 'S3_BUCKET', 'photos'),
    },
    adminLogin,
    adminPassword,
    sessionSecret: text(env, 'SESSION_SECRET', '') || deriveSessionSecret(adminLogin, adminPassword),
    maxUploadMb,
    maxUploadBytes: maxUploadMb * 1024 * 1024,
    thumbSize: intInRange(env, 'THUMB_SIZE', 512, 16, 4096),
    thumbQuality: intInRange(env, 'THUMB_QUALITY', 80, 1, 100),
    cookieSecure: env.COOKIE_SECURE === 'true',
  };
}
