import { s3Config } from './config';
import type { MediaItem } from './types';

/*
 * Preview fallback chains.
 *
 * A bucket stores a preview under `{setId}/thumb/`, and which key it uses is not
 * a promise the site can make: photos keep their own name (`thumb/a.png`), while
 * videos — and photos the transcoder could not encode (heic, tiff) — land as
 * `thumb/{basename}.jpg`. So every tile and every viewer slide walks a short
 * chain of candidates instead of trusting one URL. URL building mirrors s3.ts
 * segment for segment and is duplicated here on purpose: s3.ts is the listing
 * contract and must not grow a second responsibility.
 */

const ORIGIN = `${s3Config.endpoint}/${s3Config.bucket}`;
const THUMB_DIR = 'thumb';

/** Formats no browser but Safari paints in <img> without a conversion step. */
const NON_DISPLAYABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  'tif', 'tiff', 'heic', 'heif',
]);

/** Segment-wise encoding, identical to s3.ts `encodePath`. */
function encodePath(path: readonly string[]): string {
  return path.map((segment) => encodeURIComponent(segment)).join('/');
}

/** Drops repeats while keeping the caller's order — a chain must not retry itself. */
function unique(candidates: readonly string[]): string[] {
  return [...new Set(candidates)];
}

/**
 * `thumb/{basename}.jpg` — the preview the backend writes whenever the
 * original's own name cannot be a preview, plus every video.
 */
export function thumbBasenameJpg(item: MediaItem): string {
  const setPath = item.key.split('/').slice(0, -1);
  const dot = item.name.lastIndexOf('.');
  const basename = dot <= 0 ? item.name : item.name.slice(0, dot);

  return `${ORIGIN}/${encodePath([...setPath, THUMB_DIR, `${basename}.jpg`])}`;
}

/**
 * Whether a browser can paint this file in <img> without a conversion step.
 * Only the four formats above are known to fail outside Safari, so anything
 * else gets a chance — except a name with no extension at all, which the
 * listing would never classify as an image.
 */
export function isDisplayableImage(name: string): boolean {
  const dot = name.lastIndexOf('.');

  if (dot <= 0) return false;

  const extension = name.slice(dot + 1).toLowerCase();

  return extension !== '' && !NON_DISPLAYABLE_EXTENSIONS.has(extension);
}

/** Tile sources: cheapest first, and never the original of a video. */
export function gridImageCandidates(item: MediaItem): string[] {
  switch (item.kind) {
    case 'image':
      return unique([item.thumbUrl, thumbBasenameJpg(item), item.url]);
    case 'video':
      return unique([item.thumbUrl, thumbBasenameJpg(item)]);
    default:
      throw new Error(`неизвестный тип файла: ${String(item.kind)}`);
  }
}

/**
 * Viewer sources. A renderable original comes first because the viewer is the
 * one place with room for full quality; otherwise the jpeg preview leads and
 * the original stays last as a Safari-only fallback.
 */
export function viewerImageCandidates(item: MediaItem): string[] {
  switch (item.kind) {
    case 'image':
      return isDisplayableImage(item.name)
        ? unique([item.url, item.thumbUrl, thumbBasenameJpg(item)])
        : unique([item.thumbUrl, thumbBasenameJpg(item), item.url]);
    case 'video':
      // The viewer hands a video to <video>; it never asks <img> for one.
      return [];
    default:
      throw new Error(`неизвестный тип файла: ${String(item.kind)}`);
  }
}
