import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { criticalEnvMissing, loadConfig } from './config';

const COMPLETE_ENV: Readonly<Record<string, string>> = {
  ADMIN_LOGIN: 'admin',
  ADMIN_PASSWORD: 'secret-pass',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_BUCKET: 'photos',
};

describe('criticalEnvMissing', () => {
  it('не находит пропусков в полном окружении', () => {
    expect(criticalEnvMissing(COMPLETE_ENV)).toEqual([]);
  });

  it('перечисляет только пустые критические переменные', () => {
    expect(criticalEnvMissing({ ...COMPLETE_ENV, ADMIN_PASSWORD: '   ' })).toEqual(['ADMIN_PASSWORD']);
    expect(criticalEnvMissing({ ...COMPLETE_ENV, S3_SECRET_ACCESS_KEY: undefined })).toEqual(['S3_SECRET_ACCESS_KEY']);
    expect(criticalEnvMissing({})).toEqual(['ADMIN_PASSWORD', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']);
  });
});

describe('loadConfig', () => {
  it('подставляет значения по умолчанию', () => {
    const config = loadConfig(COMPLETE_ENV);
    expect(config.port).toBe(8080);
    expect(config.s3.endpoint).toBe('http://localhost:9000');
    expect(config.s3.region).toBe('us-east-1');
    expect(config.s3.bucket).toBe('photos');
    expect(config.maxUploadMb).toBe(512);
    expect(config.maxUploadBytes).toBe(512 * 1024 * 1024);
    expect(config.thumbSize).toBe(512);
    expect(config.thumbQuality).toBe(80);
    expect(config.cookieSecure).toBe(false);
  });

  it('читает порт, лимиты и флаги из окружения', () => {
    const config = loadConfig({
      ...COMPLETE_ENV,
      PORT: '9000',
      MAX_UPLOAD_MB: '10',
      THUMB_SIZE: '256',
      THUMB_QUALITY: '60',
      COOKIE_SECURE: 'true',
    });
    expect(config.port).toBe(9000);
    expect(config.maxUploadBytes).toBe(10 * 1024 * 1024);
    expect(config.thumbSize).toBe(256);
    expect(config.thumbQuality).toBe(60);
    expect(config.cookieSecure).toBe(true);
  });

  it('клампит числа в допустимые границы и игнорирует мусор', () => {
    const config = loadConfig({ ...COMPLETE_ENV, MAX_UPLOAD_MB: '99999', THUMB_QUALITY: 'abc', PORT: '0' });
    expect(config.maxUploadMb).toBe(10240);
    expect(config.thumbQuality).toBe(80);
    expect(config.port).toBe(1);
  });

  it('берёт SESSION_SECRET из окружения, иначе выводит его из логина и пароля', () => {
    const withSecret = loadConfig({ ...COMPLETE_ENV, SESSION_SECRET: 'from-env' });
    expect(withSecret.sessionSecret).toBe('from-env');

    const derived = loadConfig(COMPLETE_ENV);
    expect(derived.sessionSecret).toBe(
      createHash('sha256').update('admin:secret-pass:photo-delivery').digest('hex'),
    );
    expect(derived.sessionSecret).not.toContain('secret-pass');
  });
});
