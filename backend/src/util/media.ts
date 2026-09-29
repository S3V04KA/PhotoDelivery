const IMAGE_EXTENSIONS = [
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'tif', 'tiff', 'heic', 'heif',
] as const;

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv', 'avi'] as const;

const MIME_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
};

export const FALLBACK_MIME = 'application/octet-stream';

export type MediaKind = 'image' | 'video' | 'other';

export type Validation<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function baseNameOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

export function kindOf(name: string): MediaKind {
  const ext = extensionOf(name);
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image';
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return 'video';
  return 'other';
}

export function mimeFor(name: string): string {
  return MIME_TYPES[extensionOf(name)] ?? FALLBACK_MIME;
}

function hasUnsafeChars(value: string): boolean {
  return /[\\/\u0000-\u001f\u007f]/.test(value);
}

function isReservedSegment(value: string): boolean {
  return value === '.' || value === '..';
}

export function validateSetId(raw: unknown): Validation<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'Некорректный идентификатор сета' };
  const id = raw.trim();
  if (id.length === 0) return { ok: false, error: 'Идентификатор сета не указан' };
  if (id.length > 128) return { ok: false, error: 'Идентификатор сета длиннее 128 символов' };
  if (hasUnsafeChars(id)) return { ok: false, error: 'Некорректный идентификатор сета' };
  if (isReservedSegment(id)) return { ok: false, error: 'Некорректный идентификатор сета' };
  return { ok: true, value: id };
}

export function validateObjectName(raw: unknown): Validation<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'Некорректное имя файла' };
  if (raw.length === 0) return { ok: false, error: 'Имя файла не указано' };
  if (raw.length > 255) return { ok: false, error: 'Имя файла длиннее 255 символов' };
  if (hasUnsafeChars(raw)) return { ok: false, error: 'Некорректное имя файла' };
  if (isReservedSegment(raw)) return { ok: false, error: 'Некорректное имя файла' };
  return { ok: true, value: raw };
}

export const THUMB_DIR = 'thumb';

export function objectKey(setId: string, name: string): string {
  return `${setId}/${name}`;
}

export function thumbPrefix(setId: string): string {
  return `${setId}/${THUMB_DIR}/`;
}
