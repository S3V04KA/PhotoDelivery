import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { extractEmbeddedJpeg } from '../util/embedded-jpeg';
import { baseNameOf, extensionOf, isRawImage, kindOf, mimeFor, objectKey } from '../util/media';
import { Semaphore } from '../util/semaphore';
import type { SharpFormat } from './preview';
import { listSetFiles, type FileEntry } from './sets';
import type { ObjectStore } from './s3';
import { resolveFfmpegBinary, runFfmpeg } from './video-frame';

/**
 * Что отдать на скачивание:
 *  - `social` — сжатый формат для соцсетей (фото JPEG/WebP/AVIF q80, видео 720p);
 *  - `jpeg`   — полное разрешение в JPEG (RAW → встроенное в файл превью);
 *  - `raw`    — полное разрешение, исходные байты файла.
 */
export type ArchiveQuality = 'social' | 'jpeg' | 'raw';

export const ARCHIVE_MIME = 'application/zip';

const SOCIAL_VIDEO_SUFFIX = '-720p.mp4';
const SOCIAL_QUALITY = 80;
const FULL_JPEG_QUALITY = 90;
const CONCURRENT_TRANSFORMS = 2;
const TRANSCODE_TIMEOUT_MS = 600_000;
const TRANSCODE_SCALE = 'scale=-2:min(720\\,ih)';

const SOCIAL_IMAGE_FORMATS: Readonly<Record<string, SharpFormat>> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  webp: 'webp',
  avif: 'avif',
};

export interface ArchiveEntry {
  readonly name: string;
  readonly mime: string;
  readonly mtime: Date;
  readonly body: Readable | Buffer;
  cleanup(): Promise<void>;
}

async function noCleanup(): Promise<void> {}

async function collect(source: Readable): Promise<Buffer> {
  const chunks: AsyncIterable<Uint8Array> = source;
  const parts: Buffer[] = [];
  for await (const raw of chunks) {
    parts.push(Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
  }
  return Buffer.concat(parts);
}

async function sizeOfFile(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

function removeFiles(...paths: readonly string[]): Promise<void> {
  return Promise.all(paths.map((file) => rm(file, { force: true }))).then(() => undefined);
}

function socialVideoName(name: string): string {
  return `${baseNameOf(name)}${SOCIAL_VIDEO_SUFFIX}`;
}

/** Имя JPEG-варианта, выведенного из другого формата: `photo.cr2` → `photo.jpg`. */
function jpegName(name: string): string {
  return `${baseNameOf(name)}.jpg`;
}

/**
 * Запись оригинала байт-в-байт. Используется для `raw`, для видео под `jpeg`
 * и как запасной вариант, когда преобразование не удалось — скачать файл
 * важнее, чем переименовать его.
 */
async function originalEntry(store: ObjectStore, setId: string, file: FileEntry): Promise<ArchiveEntry> {
  return {
    name: file.name,
    mime: mimeFor(file.name),
    mtime: mtimeOf(file),
    body: await store.getStream(objectKey(setId, file.name)),
    cleanup: noCleanup,
  };
}

export async function selectArchiveFiles(
  store: ObjectStore,
  setId: string,
  names: readonly string[],
): Promise<readonly FileEntry[]> {
  const media = (await listSetFiles(store, setId)).filter((file) => file.kind !== 'other');
  if (names.length === 0) return media;
  const wanted = new Set(names);
  return media.filter((file) => wanted.has(file.name));
}

async function socialPhoto(store: ObjectStore, setId: string, file: FileEntry): Promise<ArchiveEntry> {
  const key = objectKey(setId, file.name);

  // RAW: сжимаем встроенное JPEG-превью, оригинал в архив «для соцсетей» не идёт.
  if (isRawImage(file.name)) {
    const input = await collect(await store.getStream(key));
    const embedded = extractEmbeddedJpeg(input);
    if (embedded === null) {
      return { name: file.name, mime: mimeFor(file.name), mtime: mtimeOf(file), body: input, cleanup: noCleanup };
    }
    // .rotate() запекает EXIF-ориентацию: sharp всё равно выбрасывает метаданные.
    const body = await sharp(embedded).rotate().toFormat('jpeg', { quality: SOCIAL_QUALITY }).toBuffer();
    return { name: jpegName(file.name), mime: 'image/jpeg', mtime: mtimeOf(file), body, cleanup: noCleanup };
  }

  const format = SOCIAL_IMAGE_FORMATS[extensionOf(file.name)];
  if (format === undefined) {
    return originalEntry(store, setId, file);
  }
  const input = await collect(await store.getStream(key));
  const body = await sharp(input).rotate().toFormat(format, { quality: SOCIAL_QUALITY }).toBuffer();
  return { name: file.name, mime: mimeFor(file.name), mtime: mtimeOf(file), body, cleanup: noCleanup };
}

/**
 * Полное разрешение в JPEG: сами jpg отдаются как есть, RAW — встроенное
 * превью полного кадра, остальные форматы перекодируются. Если перекодировка
 * не удалась, остаётся оригинал, чтобы скачивание не срывалось.
 */
async function fullJpegPhoto(store: ObjectStore, setId: string, file: FileEntry): Promise<ArchiveEntry> {
  const key = objectKey(setId, file.name);
  const extension = extensionOf(file.name);

  if (isRawImage(file.name)) {
    const input = await collect(await store.getStream(key));
    const embedded = extractEmbeddedJpeg(input);
    if (embedded !== null) {
      return { name: jpegName(file.name), mime: 'image/jpeg', mtime: mtimeOf(file), body: embedded, cleanup: noCleanup };
    }
    return { name: file.name, mime: mimeFor(file.name), mtime: mtimeOf(file), body: input, cleanup: noCleanup };
  }

  if (extension === 'jpg' || extension === 'jpeg') {
    return originalEntry(store, setId, file);
  }

  const input = await collect(await store.getStream(key));
  try {
    const body = await sharp(input).rotate().toFormat('jpeg', { quality: FULL_JPEG_QUALITY }).toBuffer();
    return { name: jpegName(file.name), mime: 'image/jpeg', mtime: mtimeOf(file), body, cleanup: noCleanup };
  } catch {
    return { name: file.name, mime: mimeFor(file.name), mtime: mtimeOf(file), body: input, cleanup: noCleanup };
  }
}

async function socialVideo(store: ObjectStore, setId: string, file: FileEntry): Promise<ArchiveEntry> {
  const token = randomUUID();
  const extension = extensionOf(file.name);
  const input = path.join(os.tmpdir(), `pd-archive-in-${token}${extension.length > 0 ? `.${extension}` : ''}`);
  const output = path.join(os.tmpdir(), `pd-archive-out-${token}.mp4`);
  const temps = [input, output];
  try {
    await pipeline(await store.getStream(objectKey(setId, file.name)), createWriteStream(input));
    const code = await runFfmpeg(
      await resolveFfmpegBinary(),
      [
        '-i', input,
        '-vf', TRANSCODE_SCALE,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '28',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        '-y', output,
      ],
      { timeoutMs: TRANSCODE_TIMEOUT_MS },
    );
    if (code !== 0 || (await sizeOfFile(output)) === 0) {
      throw new Error(`ffmpeg не смог пережать видео (код ${code})`);
    }
    return {
      name: socialVideoName(file.name),
      mime: 'video/mp4',
      mtime: mtimeOf(file),
      body: createReadStream(output),
      cleanup: () => removeFiles(...temps),
    };
  } catch (error) {
    await removeFiles(...temps);
    throw error;
  }
}

function mtimeOf(file: FileEntry): Date {
  return new Date(file.lastModified);
}

export async function prepareEntry(
  store: ObjectStore,
  setId: string,
  file: FileEntry,
  quality: ArchiveQuality,
): Promise<ArchiveEntry> {
  const kind = kindOf(file.name);
  if (quality === 'social' && kind === 'image') return socialPhoto(store, setId, file);
  if (quality === 'social' && kind === 'video') return socialVideo(store, setId, file);
  if (quality === 'jpeg' && kind === 'image') return fullJpegPhoto(store, setId, file);
  return originalEntry(store, setId, file);
}

/**
 * Имя записи в архиве должно быть уникальным: сжатый RAW и снятый параллельно
 * jpg дают одно и то же `photo.jpg`, а RAW под `jpeg` конфликтует с любым
 * одноимённым файлом другого расширения.
 */
function claimName(used: Set<string>, name: string): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }

  const extension = extensionOf(name);
  const base = baseNameOf(name);

  for (let index = 1; ; index += 1) {
    const suffix = extension.length > 0 ? ` (${index}).${extension}` : ` (${index})`;
    const candidate = `${base}${suffix}`;

    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

export async function* streamArchive(
  store: ObjectStore,
  setId: string,
  files: readonly FileEntry[],
  quality: ArchiveQuality,
): AsyncGenerator<ArchiveEntry> {
  const limiter = new Semaphore(CONCURRENT_TRANSFORMS);
  const inFlight: Promise<ArchiveEntry>[] = [];
  const usedNames = new Set<string>();
  try {
    for (const file of files) {
      inFlight.push(limiter.run(() => prepareEntry(store, setId, file, quality)));
      if (inFlight.length >= CONCURRENT_TRANSFORMS) {
        const head = inFlight.shift();
        if (head !== undefined) yield claimNameEntry(usedNames, await head);
      }
    }
    while (inFlight.length > 0) {
      const head = inFlight.shift();
      if (head !== undefined) yield claimNameEntry(usedNames, await head);
    }
  } finally {
    await Promise.all(inFlight.splice(0).map((task) => task.then((entry) => entry.cleanup(), () => undefined)));
  }
}

function claimNameEntry(used: Set<string>, entry: ArchiveEntry): ArchiveEntry {
  return { ...entry, name: claimName(used, entry.name) };
}
