import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { Writable } from 'node:stream';
import request from 'supertest';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveFfmpegBinary } from '../services/video-frame';
import { makeHarness } from '../testing/harness';
import { BAD_QUALITY, FILE_NOT_FOUND, SET_EMPTY } from './sets-archive';
import { ZipWriter } from '../util/zip';

const ZIP_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const SEEDED_AT = new Date('2026-02-03T10:20:30.000Z');

interface ZipEntry {
  readonly name: string;
  readonly size: number;
  readonly crc: number;
  readonly flags: number;
  readonly offset: number;
  readonly dosDate: number;
  readonly dosTime: number;
}

function binary(response: request.Response): Buffer {
  const { body } = response;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'latin1');
  throw new Error('ответ не бинарный');
}

function directoryOf(bytes: Buffer): readonly ZipEntry[] {
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThan(-1);
  expect(bytes.readUInt32LE(eocd)).toBe(EOCD_SIGNATURE);
  const total = bytes.readUInt16LE(eocd + 10);
  let cursor = bytes.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < total; index += 1) {
    expect(bytes.readUInt32LE(cursor)).toBe(CENTRAL_SIGNATURE);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    entries.push({
      name: bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'),
      size: bytes.readUInt32LE(cursor + 24),
      crc: bytes.readUInt32LE(cursor + 16),
      flags: bytes.readUInt16LE(cursor + 8),
      offset: bytes.readUInt32LE(cursor + 42),
      dosDate: bytes.readUInt16LE(cursor + 14),
      dosTime: bytes.readUInt16LE(cursor + 12),
    });
    cursor += 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
  }
  expect(cursor - bytes.readUInt32LE(eocd + 16)).toBe(bytes.readUInt32LE(eocd + 12));
  return entries;
}

function bodyOf(bytes: Buffer, entry: ZipEntry): Buffer {
  expect(bytes.readUInt32LE(entry.offset)).toBe(ZIP_SIGNATURE);
  const start = entry.offset + 30 + bytes.readUInt16LE(entry.offset + 26) + bytes.readUInt16LE(entry.offset + 28);
  return bytes.subarray(start, start + entry.size);
}

function names(bytes: Buffer): readonly string[] {
  return directoryOf(bytes).map((entry) => entry.name);
}

function entryNamed(bytes: Buffer, name: string): ZipEntry {
  const found = directoryOf(bytes).find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`нет записи ${name}`);
  return found;
}

function dosStamp(entry: ZipEntry): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const day = `${1980 + (entry.dosDate >> 9)}-${pad((entry.dosDate >> 5) & 0x0f)}-${pad(entry.dosDate & 0x1f)}`;
  return `${day} ${pad(entry.dosTime >> 11)}:${pad((entry.dosTime >> 5) & 0x3f)}`;
}

async function ffmpegAvailable(): Promise<boolean> {
  try {
    execFileSync(await resolveFfmpegBinary(), ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function unzipAvailable(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_FFMPEG = await ffmpegAvailable();
const HAS_UNZIP = unzipAvailable();

let workDir = '';

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'pd-archive-test-'));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function noisyJpeg(width: number, height: number, quality: number): Promise<Buffer> {
  const noise = Buffer.alloc(width * height * 3);
  for (let index = 0; index < noise.length; index += 1) {
    noise[index] = (index * 2654435761) % 256;
  }
  return sharp(noise, { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer();
}

describe('ZipWriter', () => {
  it('пишет запись больше highWaterMark, уважая backpressure', async () => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      highWaterMark: 16,
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    const payload = Buffer.alloc(100_000, 7);
    const zip = new ZipWriter(sink);

    await zip.addEntry('big.bin', payload, { mtime: SEEDED_AT });
    await zip.finish();

    const bytes = Buffer.concat(chunks);
    const entry = entryNamed(bytes, 'big.bin');
    expect(entry.size).toBe(payload.length);
    expect(bodyOf(bytes, entry).equals(payload)).toBe(true);
  });

  it('отказывается от небезопасного имени записи', async () => {
    const zip = new ZipWriter(new Writable({ write: (_chunk, _encoding, callback) => callback() }));

    await expect(zip.addEntry('../escape.jpg', Buffer.from('x'))).rejects.toThrowError('Некорректное имя файла');
  });
});

describe('GET /api/sets/:id/archive', () => {
  it('отдаёт валидный zip с исходными байтами и без thumb/', async () => {
    const { app: harness, store } = makeHarness();
    store.seed('alpha/a.jpg', 'a'.repeat(300), SEEDED_AT, 'image/jpeg');
    store.seed('alpha/b.mp4', 'b'.repeat(500), SEEDED_AT, 'video/mp4');
    store.seed('alpha/notes.txt', 'n'.repeat(10), SEEDED_AT);
    store.seed('alpha/thumb/a.jpg', 't'.repeat(10), SEEDED_AT);

    const response = await request(harness).get('/api/sets/alpha/archive?quality=original').responseType('blob');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toBe('attachment; filename="alpha.zip"');
    const bytes = binary(response);
    expect(names(bytes)).toEqual(['a.jpg', 'b.mp4']);
    const first = entryNamed(bytes, 'a.jpg');
    expect(first.flags & UTF8_FLAG).toBe(UTF8_FLAG);
    expect(first.flags & DATA_DESCRIPTOR_FLAG).toBe(DATA_DESCRIPTOR_FLAG);
    expect(first.crc).toBe(crc32(Buffer.from('a'.repeat(300))));
    expect(bodyOf(bytes, first).toString()).toBe('a'.repeat(300));
    expect(bodyOf(bytes, entryNamed(bytes, 'b.mp4')).toString()).toBe('b'.repeat(500));
    expect(dosStamp(first)).toBe('2026-02-03 10:20');
  });

  it('читается системным unzip -t', async () => {
    const { app: harness, store } = makeHarness();
    store.seed('alpha/one.jpg', 'x'.repeat(64), SEEDED_AT, 'image/jpeg');
    store.seed('alpha/two.mp4', 'y'.repeat(64), SEEDED_AT, 'video/mp4');
    const bytes = binary(await request(harness).get('/api/sets/alpha/archive').responseType('blob'));
    const target = path.join(workDir, 'unzip-check.zip');
    await writeFile(target, bytes);

    if (HAS_UNZIP) {
      const listing = execFileSync('unzip', ['-l', target], { encoding: 'utf8' });
      expect(listing).toContain('one.jpg');
      expect(listing).toContain('two.mp4');
      expect(execFileSync('unzip', ['-t', target], { encoding: 'utf8' })).toContain('No errors');
    }
    expect(names(bytes)).toEqual(['one.jpg', 'two.mp4']);
  });

  it('оставляет в архиве только файлы из names', async () => {
    const { app: harness, store } = makeHarness();
    store.seed('alpha/a.jpg', 'a'.repeat(10), SEEDED_AT, 'image/jpeg');
    store.seed('alpha/b.mp4', 'b'.repeat(10), SEEDED_AT, 'video/mp4');

    const response = await request(harness)
      .get('/api/sets/alpha/archive?quality=original&names=a.jpg,b.mp4')
      .responseType('blob');

    expect(response.status).toBe(200);
    expect(names(binary(response))).toEqual(['a.jpg', 'b.mp4']);
  });

  it('отдаёт 404 с «Файл не найден», если names ничего не совпали', async () => {
    const { app: harness, store } = makeHarness();
    store.seed('alpha/a.jpg', 'a'.repeat(10), SEEDED_AT, 'image/jpeg');

    const response = await request(harness).get('/api/sets/alpha/archive?names=zzz.jpg');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: FILE_NOT_FOUND });
  });

  it('пережимает фото в архиве, сохраняя имена и размеры', async () => {
    const { app: harness, store } = makeHarness();
    const source = await noisyJpeg(160, 120, 100);
    store.seed('alpha/photo.jpg', source, SEEDED_AT, 'image/jpeg');

    const response = await request(harness).get('/api/sets/alpha/archive?quality=compressed').responseType('blob');

    expect(response.status).toBe(200);
    const bytes = binary(response);
    expect(names(bytes)).toEqual(['photo.jpg']);
    const body = bodyOf(bytes, entryNamed(bytes, 'photo.jpg'));
    expect(body.subarray(0, JPEG_MAGIC.length)).toEqual(JPEG_MAGIC);
    expect(body.length).toBeLessThanOrEqual(source.length);
    const meta = await sharp(body).metadata();
    expect([meta.width, meta.height]).toEqual([160, 120]);
  });

  it('отдаёт 400 на неизвестное качество и на traversal в names', async () => {
    const { app: harness, store } = makeHarness();
    store.seed('alpha/a.jpg', 'a'.repeat(10), SEEDED_AT, 'image/jpeg');

    const quality = await request(harness).get('/api/sets/alpha/archive?quality=lossless');
    const encoded = await request(harness).get('/api/sets/alpha/archive?names=..%2Fsecret.jpg');
    const plain = await request(harness).get('/api/sets/alpha/archive?names=../secret.jpg');

    expect(quality.status).toBe(400);
    expect(quality.body).toEqual({ error: BAD_QUALITY });
    expect(encoded.status).toBe(400);
    expect(encoded.body).toEqual({ error: 'Некорректное имя файла' });
    expect(plain.status).toBe(400);
    expect(plain.body).toEqual({ error: 'Некорректное имя файла' });
  });

  it('отдаёт 404 на неизвестный сет и 400 на некорректный идентификатор', async () => {
    const { app: harness } = makeHarness();

    const missing = await request(harness).get('/api/sets/ghost/archive');
    const invalid = await request(harness).get('/api/sets/bad%2Fid/archive');

    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: SET_EMPTY });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: 'Некорректный идентификатор сета' });
  });
});

describe('GET /api/sets/:id/file/:name', () => {
  it('отдаёт файл с типом и вложением', async () => {
    const { app: harness, store } = makeHarness();
    store.seed('alpha/a.jpg', 'a'.repeat(120), SEEDED_AT, 'image/jpeg');

    const response = await request(harness).get('/api/sets/alpha/file/a.jpg?quality=original');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['content-disposition']).toBe('attachment; filename="a.jpg"');
    expect(binary(response).toString()).toBe('a'.repeat(120));
  });

  it('кодирует кириллическое имя по RFC 5987', async () => {
    const { app: harness, store } = makeHarness();
    store.seed('alpha/фото.jpg', 'a'.repeat(12), SEEDED_AT, 'image/jpeg');

    const response = await request(harness).get(`/api/sets/alpha/file/${encodeURIComponent('фото.jpg')}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toBe(
      "attachment; filename=\"____.jpg\"; filename*=UTF-8''%D1%84%D0%BE%D1%82%D0%BE.jpg",
    );
  });

  it('отдаёт 400 на traversal и 404 на неизвестный файл', async () => {
    const { app: harness, store } = makeHarness();
    store.seed('alpha/a.jpg', 'a'.repeat(10), SEEDED_AT, 'image/jpeg');

    const traversal = await request(harness).get('/api/sets/alpha/file/..%2F..%2Fetc%2Fpasswd');
    const plain = await request(harness).get('/api/sets/alpha/file/..%2Fsecret.jpg');
    const missing = await request(harness).get('/api/sets/alpha/file/nope.jpg');

    expect(traversal.status).toBe(400);
    expect(traversal.body).toEqual({ error: 'Некорректное имя файла' });
    expect(plain.status).toBe(400);
    expect(plain.body).toEqual({ error: 'Некорректное имя файла' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: FILE_NOT_FOUND });
  });

  it('отдаёт 400 на неизвестное качество', async () => {
    const { app: harness, store } = makeHarness();
    store.seed('alpha/a.jpg', 'a'.repeat(10), SEEDED_AT, 'image/jpeg');

    const response = await request(harness).get('/api/sets/alpha/file/a.jpg?quality=raw');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: BAD_QUALITY });
  });

  it('пережимает фото на лету, не увеличивая размер', async () => {
    const { app: harness, store } = makeHarness();
    const source = await noisyJpeg(200, 150, 100);
    store.seed('alpha/photo.jpg', source, SEEDED_AT, 'image/jpeg');

    const response = await request(harness).get('/api/sets/alpha/file/photo.jpg?quality=compressed').responseType('blob');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['content-disposition']).toBe('attachment; filename="photo.jpg"');
    const body = binary(response);
    expect(body.subarray(0, JPEG_MAGIC.length)).toEqual(JPEG_MAGIC);
    expect(body.length).toBeLessThan(source.length);
    const meta = await sharp(body).metadata();
    expect([meta.width, meta.height]).toEqual([200, 150]);
  });

  it.skipIf(!HAS_FFMPEG)('пережимает видео в 720p h264 и переименовывает его', async () => {
    const { app: harness, store } = makeHarness();
    const source = path.join(workDir, 'clip.mp4');
    execFileSync(await resolveFfmpegBinary(), [
      '-f', 'lavfi',
      '-i', 'testsrc=duration=1:size=1280x720:rate=10',
      '-pix_fmt', 'yuv420p',
      '-y', source,
    ], { stdio: 'ignore' });
    store.seed('alpha/clip.mp4', await readFile(source), SEEDED_AT, 'video/mp4');

    const response = await request(harness)
      .get('/api/sets/alpha/file/clip.mp4?quality=compressed')
      .responseType('blob');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('video/mp4');
    expect(response.headers['content-disposition']).toBe('attachment; filename="clip-720p.mp4"');
    const body = binary(response);
    expect(body.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expect(body.length).toBeLessThan(store.bodyOf('alpha/clip.mp4')?.length ?? 0);
  });

  it.skipIf(!HAS_FFMPEG)('кладёт в архив пережатое видео под именем -720p.mp4', async () => {
    const { app: harness, store } = makeHarness();
    const source = path.join(workDir, 'holiday.mp4');
    execFileSync(await resolveFfmpegBinary(), [
      '-f', 'lavfi',
      '-i', 'testsrc=duration=1:size=640x480:rate=10',
      '-pix_fmt', 'yuv420p',
      '-y', source,
    ], { stdio: 'ignore' });
    store.seed('alpha/holiday.mp4', await readFile(source), SEEDED_AT, 'video/mp4');

    const response = await request(harness).get('/api/sets/alpha/archive?quality=compressed').responseType('blob');

    expect(response.status).toBe(200);
    const bytes = binary(response);
    expect(names(bytes)).toEqual(['holiday-720p.mp4']);
    expect(bodyOf(bytes, entryNamed(bytes, 'holiday-720p.mp4')).length).toBeGreaterThan(0);
  });
});
