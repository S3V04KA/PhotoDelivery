/**
 * Client-side prefilter and validation. Both mirror the backend contract
 * exactly: nothing here is allowed to be stricter than the server, and
 * anything the server accepts must not be silently dropped by the client.
 */

export type MediaKind = 'image' | 'video' | 'other';

/** Зеркалит бэкенд и публичный сайт. */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'avif',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
]);

const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4',
  'webm',
  'mov',
  'm4v',
  'ogv',
  'mkv',
  'avi',
]);

export const MAX_SET_ID_LENGTH = 128;

/** C0 control range plus DEL — none of these can appear in an S3 key. */
const FORBIDDEN_CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export type SetIdCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };

/**
 * A set id becomes an S3 key prefix, so it is trimmed, length-capped and may
 * not contain slashes, control characters, or the relative-path spellings.
 */
export function validateSetId(raw: string): SetIdCheck {
  const value = raw.trim();

  if (value === '') {
    return { ok: false, error: 'Введите ID сета' };
  }

  if (value.length > MAX_SET_ID_LENGTH) {
    return { ok: false, error: `ID длиннее ${MAX_SET_ID_LENGTH} символов` };
  }

  if (value.includes('/') || value.includes('\\')) {
    return { ok: false, error: 'ID не может содержать слэши' };
  }

  if (value === '.' || value === '..') {
    return { ok: false, error: 'ID не может быть «.» или «..»' };
  }

  if (FORBIDDEN_CONTROL_CHARS.test(value)) {
    return { ok: false, error: 'ID не может содержать служебные символы' };
  }

  return { ok: true, value };
}

/** Lower-cased extension without the dot, or '' when there is none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');

  if (dot <= 0) {
    return '';
  }

  return name.slice(dot + 1).toLowerCase();
}

export function mediaKind(name: string): MediaKind {
  const extension = extensionOf(name);

  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }

  if (VIDEO_EXTENSIONS.has(extension)) {
    return 'video';
  }

  return 'other';
}

export function isSupportedMedia(name: string): boolean {
  return mediaKind(name) !== 'other';
}

/** «фото» / «видео» / «файл» for the kind chip in the file list. */
export function kindLabel(kind: MediaKind): string {
  switch (kind) {
    case 'image':
      return 'фото';
    case 'video':
      return 'видео';
    case 'other':
      return 'файл';
  }
}
