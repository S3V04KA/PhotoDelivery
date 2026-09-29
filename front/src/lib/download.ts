/*
 * Download URLs for the backend archive/file endpoints.
 *
 * Both endpoints are public and same-origin: in production the backend serves
 * this bundle, so a relative `/api/...` URL is correct as written, and in dev
 * `vite.config.ts` proxies `/api` to the backend on :8080. Because the request
 * is same-origin, the temporary-anchor mechanism below is enough — the browser
 * applies the response's `Content-Disposition` filename to the saved file, so
 * a compressed video keeps the server-sent `…-720p.mp4` name. No blob, no
 * manual filename parsing, no cross-origin fallback needed.
 */

export type DownloadQuality = 'original' | 'compressed';

/**
 * What the plain download button sends. Compressed is the common case — 720p
 * video and a lighter photo are the sizes a phone actually shares — and the
 * original stays one chevron away. The server falls back to `original` when the
 * parameter is missing, so this constant is also what keeps that from
 * happening by accident: every call site passes a quality explicitly.
 */
export const DEFAULT_QUALITY: DownloadQuality = 'compressed';

const API_ROOT = '/api';

/** Segments are encoded one by one, so a space or `#` in a set id survives. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function qualityQuery(quality: DownloadQuality): string {
  return `quality=${quality}`;
}

/**
 * ZIP of a set. `names` narrows the archive to a selection; omitting it (or
 * passing an empty list) archives the whole set.
 */
export function archiveUrl(
  setId: string,
  names: readonly string[] | undefined,
  quality: DownloadQuality,
): string {
  const query = [qualityQuery(quality)];

  if (names !== undefined && names.length > 0) {
    query.push(`names=${encodeURIComponent(names.join(','))}`);
  }

  return `${API_ROOT}/sets/${encodeSegment(setId)}/archive?${query.join('&')}`;
}

/** One file. A compressed video is served by the backend as `…-720p.mp4`. */
export function fileUrl(setId: string, name: string, quality: DownloadQuality): string {
  const path = name.split('/').map(encodeSegment).join('/');

  return `${API_ROOT}/sets/${encodeSegment(setId)}/file/${path}?${qualityQuery(quality)}`;
}

/**
 * Hands the URL to the browser as a navigation-shaped download. The anchor is
 * never attached to the document flow: it is created, clicked and dropped, and
 * the `download` attribute is left empty so the response's Content-Disposition
 * filename wins over the URL's last segment.
 */
export function triggerDownload(url: string): void {
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = '';
  anchor.rel = 'noopener';
  anchor.hidden = true;

  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
