import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { baseNameOf, extensionOf, kindOf, mimeFor, objectKey } from '../util/media';
import { Semaphore } from '../util/semaphore';
import type { SharpFormat } from './preview';
import { listSetFiles, type FileEntry } from './sets';
import type { ObjectStore } from './s3';
import { resolveFfmpegBinary, runFfmpeg } from './video-frame';

export type ArchiveQuality = 'original' | 'compressed';

export const ARCHIVE_MIME = 'application/zip';

const COMPRESSED_VIDEO_SUFFIX = '-720p.mp4';
const COMPRESSED_QUALITY = 80;
const CONCURRENT_TRANSFORMS = 2;
const TRANSCODE_TIMEOUT_MS = 600_000;
const TRANSCODE_SCALE = 'scale=-2:min(720\\,ih)';

const COMPRESSED_IMAGE_FORMATS: Readonly<Record<string, SharpFormat>> = {
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

function compressedVideoName(name: string): string {
  return `${baseNameOf(name)}${COMPRESSED_VIDEO_SUFFIX}`;
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

async function compressedPhoto(store: ObjectStore, setId: string, file: FileEntry): Promise<ArchiveEntry> {
  const key = objectKey(setId, file.name);
  const format = COMPRESSED_IMAGE_FORMATS[extensionOf(file.name)];
  if (format === undefined) {
    return { name: file.name, mime: mimeFor(file.name), mtime: mtimeOf(file), body: await store.getStream(key), cleanup: noCleanup };
  }
  const input = await collect(await store.getStream(key));
  const body = await sharp(input).toFormat(format, { quality: COMPRESSED_QUALITY }).toBuffer();
  return { name: file.name, mime: mimeFor(file.name), mtime: mtimeOf(file), body, cleanup: noCleanup };
}

async function compressedVideo(store: ObjectStore, setId: string, file: FileEntry): Promise<ArchiveEntry> {
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
      name: compressedVideoName(file.name),
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
  if (quality === 'compressed' && kind === 'image') return compressedPhoto(store, setId, file);
  if (quality === 'compressed' && kind === 'video') return compressedVideo(store, setId, file);
  return {
    name: file.name,
    mime: mimeFor(file.name),
    mtime: mtimeOf(file),
    body: await store.getStream(objectKey(setId, file.name)),
    cleanup: noCleanup,
  };
}

export async function* streamArchive(
  store: ObjectStore,
  setId: string,
  files: readonly FileEntry[],
  quality: ArchiveQuality,
): AsyncGenerator<ArchiveEntry> {
  const limiter = new Semaphore(CONCURRENT_TRANSFORMS);
  const inFlight: Promise<ArchiveEntry>[] = [];
  try {
    for (const file of files) {
      inFlight.push(limiter.run(() => prepareEntry(store, setId, file, quality)));
      if (inFlight.length >= CONCURRENT_TRANSFORMS) {
        const head = inFlight.shift();
        if (head !== undefined) yield await head;
      }
    }
    while (inFlight.length > 0) {
      const head = inFlight.shift();
      if (head !== undefined) yield await head;
    }
  } finally {
    await Promise.all(inFlight.splice(0).map((task) => task.then((entry) => entry.cleanup(), () => undefined)));
  }
}
