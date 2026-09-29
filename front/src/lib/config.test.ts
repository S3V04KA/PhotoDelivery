import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('s3Config', () => {
  it('читает endpoint и bucket из переменных окружения, отбрасывая слэш', async () => {
    // Given
    vi.stubEnv('VITE_S3_ENDPOINT', 'https://photos.example.com/');
    vi.stubEnv('VITE_S3_BUCKET', 'archive');

    // When
    const { s3Config } = await import('./config');

    // Then
    expect(s3Config).toEqual({ endpoint: 'https://photos.example.com', bucket: 'archive' });
  });

  it('подставляет локальные значения по умолчанию, если окружение пустое', async () => {
    // Given
    vi.stubEnv('VITE_S3_ENDPOINT', undefined);
    vi.stubEnv('VITE_S3_BUCKET', '   ');

    // When
    const { s3Config } = await import('./config');

    // Then
    expect(s3Config).toEqual({ endpoint: 'http://localhost:9000', bucket: 'photos' });
  });
});
