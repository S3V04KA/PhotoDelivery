export interface S3Config {
  /** URL S3-совместимого API без завершающего слэша. */
  readonly endpoint: string;
  /** Имя бакета. */
  readonly bucket: string;
}

const DEFAULT_ENDPOINT = 'http://localhost:9000';
const DEFAULT_BUCKET = 'photos';

/** import.meta.env индексирован как any, поэтому значение сужаем до unknown вручную. */
function readEnv(name: string): string | undefined {
  const value: unknown = import.meta.env[name];
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? undefined : trimmed;
}

export const s3Config: S3Config = {
  endpoint: (readEnv('VITE_S3_ENDPOINT') ?? DEFAULT_ENDPOINT).replace(/\/+$/, ''),
  bucket: readEnv('VITE_S3_BUCKET') ?? DEFAULT_BUCKET,
};
