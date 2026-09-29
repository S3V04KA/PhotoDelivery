import { s3Config } from './config';
import { SetNotFoundError, S3Error, type MediaItem, type MediaKind } from './types';

const ORIGIN = `${s3Config.endpoint}/${s3Config.bucket}`;
const THUMB_DIR = 'thumb';
const MAX_PAGES = 100;

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'tif', 'tiff', 'heic', 'heif',
]);
const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv', 'avi',
]);
const MISSING_CODES: ReadonlySet<string> = new Set(['NoSuchBucket', 'NoSuchKey', 'NoSuchUpload']);
const ACCESS_DENIED_CODE = 'AccessDenied';

const SET_NOT_FOUND_MESSAGE = 'Альбом не найден';
const ACCESS_DENIED_MESSAGE = 'Нет доступа к хранилищу';
const UNREACHABLE_MESSAGE = 'Не удалось получить ответ хранилища';
const GARBLED_MESSAGE = 'Хранилище вернуло некорректный ответ';
const NO_TOKEN_MESSAGE = 'Хранилище не вернуло маркер продолжения списка';
const TOO_MANY_PAGES_MESSAGE = 'Список файлов слишком длинный';

const SORT_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: 'base' };

type ListPage = {
  readonly keys: readonly string[];
  readonly nextToken: string | null;
};

function assertNever(kind: never): never {
  throw new Error(`неизвестный тип файла: ${String(kind)}`);
}

function normalizeSetId(rawSetId: string): string {
  const setId = rawSetId.trim().replace(/^\/+|\/+$/g, '');
  if (setId === '') throw new SetNotFoundError(SET_NOT_FOUND_MESSAGE);
  return setId;
}

function classify(filename: string): MediaKind | null {
  if (filename.startsWith('.')) return null;
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return null;
  const extension = filename.slice(dot + 1).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return null;
}

function thumbName(filename: string, kind: MediaKind): string {
  switch (kind) {
    case 'image':
      return filename;
    case 'video':
      return `${filename.slice(0, filename.lastIndexOf('.'))}.jpg`;
    default:
      return assertNever(kind);
  }
}

function encodePath(path: readonly string[]): string {
  return path.map((segment) => encodeURIComponent(segment)).join('/');
}

function toMediaItem(key: string, setId: string): MediaItem | null {
  const prefix = `${setId}/`;
  if (!key.startsWith(prefix)) return null;
  const name = key.slice(prefix.length);
  if (name.includes('/')) return null;
  const kind = classify(name);
  if (kind === null) return null;
  return {
    key,
    name,
    url: `${ORIGIN}/${encodePath(key.split('/'))}`,
    thumbUrl: `${ORIGIN}/${encodePath([setId, THUMB_DIR, thumbName(name, kind)])}`,
    kind,
  };
}

function readText(root: Document | Element, tag: string): string | null {
  const first = root.getElementsByTagName(tag).item(0);
  return first === null ? null : (first.textContent ?? '').trim();
}

function parseXml(body: string): XMLDocument | null {
  if (body.trim() === '') return null;
  const document = new DOMParser().parseFromString(body, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) return null;
  const root = document.documentElement;
  return root !== null && root.nodeName !== 'parsererror' ? document : null;
}

function storageFailure(status: number, code: string | null): S3Error | SetNotFoundError {
  if (status === 404 || (code !== null && MISSING_CODES.has(code))) {
    return new SetNotFoundError(SET_NOT_FOUND_MESSAGE);
  }
  if (status === 403 || code === ACCESS_DENIED_CODE) return new S3Error(ACCESS_DENIED_MESSAGE);
  return new S3Error(`Хранилище вернуло ошибку ${status}`);
}

function parsePage(document: XMLDocument): ListPage {
  const keys: string[] = [];
  for (const contents of Array.from(document.getElementsByTagName('Contents'))) {
    const key = readText(contents, 'Key');
    if (key !== null) keys.push(key);
  }
  if (readText(document, 'IsTruncated') !== 'true') return { keys, nextToken: null };
  const nextToken = readText(document, 'NextContinuationToken');
  if (nextToken === null || nextToken === '') throw new S3Error(NO_TOKEN_MESSAGE);
  return { keys, nextToken };
}

async function fetchPage(url: string): Promise<ListPage> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const document = parseXml(await response.text());
    const code = document === null ? null : readText(document, 'Code');
    if (!response.ok || code !== null) throw storageFailure(response.status, code);
    if (document === null || document.documentElement?.nodeName !== 'ListBucketResult') {
      throw new S3Error(GARBLED_MESSAGE);
    }
    return parsePage(document);
  } catch (error) {
    if (error instanceof S3Error || error instanceof SetNotFoundError) throw error;
    throw new S3Error(UNREACHABLE_MESSAGE, { cause: error });
  }
}

function toMediaItems(setId: string, keys: readonly string[]): MediaItem[] {
  const items: MediaItem[] = [];
  for (const key of keys) {
    const item = toMediaItem(key, setId);
    if (item !== null) items.push(item);
  }
  if (items.length === 0) throw new SetNotFoundError(SET_NOT_FOUND_MESSAGE);
  // Трёхаргументная форма обязательна: двухаргументная localeCompare игнорирует options в V8.
  return items.sort((a, b) => a.name.localeCompare(b.name, undefined, SORT_OPTIONS));
}

function listUrl(prefix: string, token: string | null): string {
  const query = `list-type=2&delimiter=/&prefix=${encodeURIComponent(prefix)}`;
  const tail = token === null ? '' : `&continuation-token=${encodeURIComponent(token)}`;
  return `${ORIGIN}?${query}${tail}`;
}

export async function listMedia(setId: string): Promise<MediaItem[]> {
  const id = normalizeSetId(setId);
  const keys: string[] = [];
  let token: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const listed = await fetchPage(listUrl(`${id}/`, token));
    keys.push(...listed.keys);
    if (listed.nextToken === null) return toMediaItems(id, keys);
    token = listed.nextToken;
  }
  throw new S3Error(TOO_MANY_PAGES_MESSAGE);
}
