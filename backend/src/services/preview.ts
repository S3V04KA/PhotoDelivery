import { randomUUID } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { FormatEnum } from 'sharp';
import { baseNameOf, extensionOf, kindOf, THUMB_DIR } from '../util/media';
import { qualityScale, resolveFfmpegBinary, runFfmpeg } from './video-frame';

export type SharpFormat = keyof FormatEnum | 'avif';

const SHARP_INPUT_FORMATS: Readonly<Record<string, SharpFormat>> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  gif: 'gif',
  tiff: 'tiff',
  tif: 'tiff',
};

const QUALITY_AWARE_FORMATS: ReadonlySet<SharpFormat> = new Set<SharpFormat>(['jpeg', 'webp', 'avif']);

export class PreviewError extends Error {
  readonly reason: string;

  constructor(reason: string, options?: { cause?: unknown }) {
    super(reason, options);
    this.name = 'PreviewError';
    this.reason = reason;
  }
}

export interface PreviewRequest {
  readonly path: string;
  readonly fileName: string;
  readonly setId: string;
}

export interface PreviewResult {
  readonly key: string;
  readonly body: Buffer;
}

export interface Previewer {
  generate(request: PreviewRequest): Promise<PreviewResult>;
}

export interface PreviewerOptions {
  readonly thumbSize: number;
  readonly thumbQuality: number;
}

export function imageThumbKey(setId: string, fileName: string, keepExtension: boolean): string {
  const name = keepExtension ? fileName : `${baseNameOf(fileName)}.jpg`;
  return `${setId}/${THUMB_DIR}/${name}`;
}

export function videoThumbKey(setId: string, fileName: string): string {
  return `${setId}/${THUMB_DIR}/${baseNameOf(fileName)}.jpg`;
}

async function sizeOfFile(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

export function sharpFormatFor(fileName: string): SharpFormat | null {
  return SHARP_INPUT_FORMATS[extensionOf(fileName)] ?? null;
}

export class MediaPreviewer implements Previewer {
  readonly #thumbSize: number;
  readonly #thumbQuality: number;

  constructor(options: PreviewerOptions) {
    this.#thumbSize = options.thumbSize;
    this.#thumbQuality = options.thumbQuality;
  }

  async generate(request: PreviewRequest): Promise<PreviewResult> {
    const kind = kindOf(request.fileName);
    if (kind === 'video') return this.#videoFrame(request);
    if (kind === 'image') return this.#image(request);
    throw new PreviewError('Неподдерживаемый формат');
  }

  async #image(request: PreviewRequest): Promise<PreviewResult> {
    const format = sharpFormatFor(request.fileName);
    if (format !== null) {
      const sameFormat = await this.#render(request.path, format);
      if (sameFormat !== null) {
        return { key: imageThumbKey(request.setId, request.fileName, true), body: sameFormat };
      }
    }
    const asJpeg = await this.#render(request.path, 'jpeg');
    if (asJpeg !== null) {
      return { key: imageThumbKey(request.setId, request.fileName, false), body: asJpeg };
    }
    throw new PreviewError('Не удалось декодировать изображение');
  }

  async #render(filePath: string, format: SharpFormat): Promise<Buffer | null> {
    try {
      const pipeline = sharp(filePath)
        .rotate()
        .resize({
          width: this.#thumbSize,
          height: this.#thumbSize,
          fit: 'inside',
          withoutEnlargement: true,
        });
      const body = QUALITY_AWARE_FORMATS.has(format)
        ? await pipeline.toFormat(format, { quality: this.#thumbQuality }).toBuffer()
        : await pipeline.toFormat(format).toBuffer();
      return body;
    } catch {
      return null;
    }
  }

  async #videoFrame(request: PreviewRequest): Promise<PreviewResult> {
    const binary = await resolveFfmpegBinary();
    const target = path.join(os.tmpdir(), `pd-thumb-${randomUUID()}.jpg`);
    try {
      // ffmpeg может завершиться с кодом 0, не создав файл (нет кадров после seek
      // на видео короче точки поиска), поэтому успешным считаем только непустой выход.
      let lastCode = -1;
      let written = false;
      for (const seek of ['1', '0']) {
        lastCode = await runFfmpeg(binary, [
          '-ss', seek,
          '-i', request.path,
          '-frames:v', '1',
          '-vf', `scale=${this.#thumbSize}:${this.#thumbSize}:force_original_aspect_ratio=decrease`,
          '-q:v', String(qualityScale(this.#thumbQuality)),
          '-y', target,
        ]);
        if (lastCode === 0 && (await sizeOfFile(target)) > 0) {
          written = true;
          break;
        }
      }
      if (!written) {
        throw new PreviewError(`ffmpeg не смог извлечь кадр (код ${lastCode})`);
      }
      return { key: videoThumbKey(request.setId, request.fileName), body: await readFile(target) };
    } finally {
      await rm(target, { force: true });
    }
  }
}
