import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { imageThumbKey, MediaPreviewer, PreviewError, sharpFormatFor, videoThumbKey } from './preview';
import { qualityScale, resolveFfmpegBinary, runFfmpeg } from './video-frame';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

async function ffmpegAvailable(): Promise<boolean> {
  try {
    execFileSync(await resolveFfmpegBinary(), ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_FFMPEG = await ffmpegAvailable();
const previewer = new MediaPreviewer({ thumbSize: 32, thumbQuality: 80 });
let workDir = '';

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'pd-preview-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('имена ключей превью', () => {
  it('сохраняет расширение оригинала, когда формат поддерживается', () => {
    expect(imageThumbKey('set-1', 'photo.png', true)).toBe('set-1/thumb/photo.png');
    expect(imageThumbKey('set-1', 'photo.JPEG', true)).toBe('set-1/thumb/photo.JPEG');
  });

  it('переходит на .jpg с basename, когда расширение не поддерживается', () => {
    expect(imageThumbKey('set-1', 'photo.bmp', false)).toBe('set-1/thumb/photo.jpg');
    expect(imageThumbKey('set-1', 'a.b.heic', false)).toBe('set-1/thumb/a.b.jpg');
  });

  it('для видео всегда берёт basename с .jpg', () => {
    expect(videoThumbKey('set-1', 'clip.mp4')).toBe('set-1/thumb/clip.jpg');
    expect(videoThumbKey('set-1', 'my.holiday.mov')).toBe('set-1/thumb/my.holiday.jpg');
  });
});

describe('sharpFormatFor', () => {
  it('отдаёт формат sharp для поддерживаемых расширений', () => {
    expect(sharpFormatFor('photo.jpg')).toBe('jpeg');
    expect(sharpFormatFor('photo.png')).toBe('png');
    expect(sharpFormatFor('photo.webp')).toBe('webp');
    expect(sharpFormatFor('photo.avif')).toBe('avif');
    expect(sharpFormatFor('photo.gif')).toBe('gif');
    expect(sharpFormatFor('photo.tif')).toBe('tiff');
  });

  it('возвращает null для неподдерживаемых расширений', () => {
    expect(sharpFormatFor('photo.bmp')).toBeNull();
    expect(sharpFormatFor('photo.heic')).toBeNull();
    expect(sharpFormatFor('notes.txt')).toBeNull();
  });
});

describe('qualityScale', () => {
  it('переводит качество 1..100 в диапазон -q:v 3..8', () => {
    expect(qualityScale(100)).toBe(3);
    expect(qualityScale(80)).toBe(4);
    expect(qualityScale(1)).toBe(8);
  });
});

describe('MediaPreviewer для изображений', () => {
  it('оставляет PNG в PNG и ужимает до THUMB_SIZE', async () => {
    const source = path.join(workDir, 'tiny.png');
    await writeFile(source, await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#3366ff' },
    }).png().toBuffer());

    const result = await previewer.generate({ path: source, fileName: 'tiny.png', setId: 'set-1' });

    expect(result.key).toBe('set-1/thumb/tiny.png');
    expect(result.body.subarray(0, PNG_MAGIC.length)).toEqual(PNG_MAGIC);
    const meta = await sharp(result.body).metadata();
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(32);
  });

  it('не увеличивает маленькое изображение', async () => {
    const source = path.join(workDir, 'small.png');
    await writeFile(source, await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#000000' },
    }).png().toBuffer());

    const result = await previewer.generate({ path: source, fileName: 'small.png', setId: 'set-1' });
    const meta = await sharp(result.body).metadata();
    expect(meta.width).toBe(16);
  });

  it('перекодирует в jpeg с basename, если расширение не поддерживается', async () => {
    const source = path.join(workDir, 'photo.bmp');
    await writeFile(source, await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#ff0000' },
    }).png().toBuffer());

    const result = await previewer.generate({ path: source, fileName: 'photo.bmp', setId: 'set-1' });

    expect(result.key).toBe('set-1/thumb/photo.jpg');
    expect(result.body.subarray(0, JPEG_MAGIC.length)).toEqual(JPEG_MAGIC);
  });

  it('бросает PreviewError, если файл не декодируется ни в одном формате', async () => {
    const source = path.join(workDir, 'broken.png');
    await writeFile(source, Buffer.from('this is not an image'));

    await expect(previewer.generate({ path: source, fileName: 'broken.png', setId: 'set-1' })).rejects.toThrowError(
      'Не удалось декодировать изображение',
    );
  });

  it('отказывается для неподдерживаемого типа файла', async () => {
    const source = path.join(workDir, 'notes.txt');
    await writeFile(source, 'text');

    await expect(previewer.generate({ path: source, fileName: 'notes.txt', setId: 'set-1' })).rejects.toBeInstanceOf(
      PreviewError,
    );
  });
});

describe('MediaPreviewer для видео', () => {
  it.skipIf(!HAS_FFMPEG)('извлекает кадр через ffmpeg', async () => {
    const source = path.join(workDir, 'clip.mp4');
    const binary = await resolveFfmpegBinary();
    const created = await runFfmpeg(binary, [
      '-f', 'lavfi',
      '-i', 'testsrc=duration=3:size=64x64:rate=10',
      '-pix_fmt', 'yuv420p',
      '-y', source,
    ]);
    expect(created).toBe(0);

    const result = await previewer.generate({ path: source, fileName: 'clip.mp4', setId: 'set-1' });

    expect(result.key).toBe('set-1/thumb/clip.jpg');
    expect(result.body.subarray(0, JPEG_MAGIC.length)).toEqual(JPEG_MAGIC);
  });

  it.skipIf(!HAS_FFMPEG)('достаёт кадр видео короче точки seek (fallback на 0)', async () => {
    const source = path.join(workDir, 'short.mp4');
    const created = await runFfmpeg(await resolveFfmpegBinary(), [
      '-f', 'lavfi',
      '-i', 'color=c=blue:s=64x48:d=1',
      '-pix_fmt', 'yuv420p',
      '-y', source,
    ]);
    expect(created).toBe(0);

    const result = await previewer.generate({ path: source, fileName: 'short.mp4', setId: 'set-1' });

    expect(result.key).toBe('set-1/thumb/short.jpg');
    expect(result.body.subarray(0, JPEG_MAGIC.length)).toEqual(JPEG_MAGIC);
  });

  it.skipIf(!HAS_FFMPEG)('бросает PreviewError, если кадр извлечь не удалось', async () => {
    const source = path.join(workDir, 'broken.mp4');
    await writeFile(source, 'not a video');

    await expect(previewer.generate({ path: source, fileName: 'broken.mp4', setId: 'set-1' })).rejects.toThrowError(
      PreviewError,
    );
  });
});

describe('runFfmpeg', () => {
  it.skipIf(!HAS_FFMPEG)('возвращает ненулевой код при ошибке входных данных', async () => {
    expect(await runFfmpeg(await resolveFfmpegBinary(), ['-i', path.join(workDir, 'missing.mp4')])).not.toBe(0);
  });

  it('отклоняет промис, если бинарник не запускается', async () => {
    await expect(runFfmpeg(path.join(workDir, 'no-such-ffmpeg'), ['-version'])).rejects.toThrowError();
  });
});
