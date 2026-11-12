import { s3Config } from './config';
import type { MediaKind } from './validate';

const THUMB_DIR = 'thumb';
const ORIGIN = `${s3Config.endpoint}/${s3Config.bucket}`;

/**
 * Форматы, превью которых бэкенд пишет под исходным именем. Остальным (heic,
 * bmp, RAW…) — `thumb/{basename}.jpg`, потому что они не рендерятся как есть.
 * Зеркалит backend/src/services/preview.ts `SHARP_INPUT_FORMATS`.
 */
const THUMB_KEEP_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'avif',
  'gif',
  'tif',
  'tiff',
]);

/**
 * Public read URL for an object in the bucket. The endpoint and bucket are
 * configuration, not data, so only the path segments are percent-encoded —
 * which is what keeps Cyrillic names, spaces and `#`/`?` inside a name from
 * corrupting the URL.
 */
export function publicUrl(...segments: readonly string[]): string {
  return `${ORIGIN}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

/**
 * Preview URL, or null for kinds the site never previews. Video previews — and
 * previews of formats the transcoder could not keep (heic, bmp, RAW) — live at
 * `thumb/{basename}.jpg`; the rest keep the original name.
 */
export function thumbUrl(setId: string, name: string, kind: MediaKind): string | null {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;

  if (kind === 'image') {
    const keepName = dot > 0 && THUMB_KEEP_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
    return publicUrl(setId, THUMB_DIR, keepName ? name : `${base}.jpg`);
  }

  if (kind === 'video') {
    return publicUrl(setId, THUMB_DIR, `${base}.jpg`);
  }

  return null;
}
