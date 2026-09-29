import { s3Config } from './config';
import type { MediaKind } from './validate';

const THUMB_DIR = 'thumb';
const ORIGIN = `${s3Config.endpoint}/${s3Config.bucket}`;

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
 * Preview URL, or null for kinds the site never previews. Video previews live
 * at `thumb/{basename}.jpg`; image previews keep the original name.
 */
export function thumbUrl(setId: string, name: string, kind: MediaKind): string | null {
  if (kind === 'image') {
    return publicUrl(setId, THUMB_DIR, name);
  }

  if (kind === 'video') {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    return publicUrl(setId, THUMB_DIR, `${base}.jpg`);
  }

  return null;
}
