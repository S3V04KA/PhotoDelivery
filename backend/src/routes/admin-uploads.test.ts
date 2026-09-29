import { readdirSync } from 'node:fs';
import os from 'node:os';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { UploadResult } from '../services/uploads';
import { loginCookie, makeHarness, TEST_ENV } from '../testing/harness';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
const MP4_BYTES = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 6, 7]);

interface UploadBody {
  readonly results: readonly UploadResult[];
  readonly done: number;
  readonly failed: number;
}

function tmpUploads(extension: string): string[] {
  const pattern = new RegExp(`^[0-9a-f-]{36}\\.${extension}$`);
  return readdirSync(os.tmpdir()).filter((name) => pattern.test(name));
}

describe('POST /api/admin/uploads', () => {
  it('складывает оригиналы байт-в-байт и превью, сохраняя порядок', async () => {
    const { app, store, previewer } = makeHarness();
    const cookie = await loginCookie(app);

    const response = await request(app)
      .post('/api/admin/uploads')
      .set('Cookie', cookie)
      .field('setId', 'my-set')
      .attach('files', PNG_BYTES, 'photo.png')
      .attach('files', MP4_BYTES, 'clip.mp4');

    const body: UploadBody = response.body;
    expect(response.status).toBe(200);
    expect(body.done).toBe(2);
    expect(body.failed).toBe(0);
    expect(body.results).toEqual([
      { name: 'photo.png', ok: true, thumb: 'ok' },
      { name: 'clip.mp4', ok: true, thumb: 'ok' },
    ]);
    expect(store.bodyOf('my-set/photo.png')?.equals(PNG_BYTES)).toBe(true);
    expect(store.bodyOf('my-set/clip.mp4')?.equals(MP4_BYTES)).toBe(true);
    expect(store.exists('my-set/thumb/photo.jpg')).toBe(true);
    expect(store.exists('my-set/thumb/clip.jpg')).toBe(true);
    expect(store.contentTypeOf('my-set/photo.png')).toBe('image/png');
    expect(store.putCalls.filter((call) => call.fromFile).map((call) => call.key)).toEqual([
      'my-set/photo.png',
      'my-set/clip.mp4',
    ]);
    expect(previewer.calls.map((call) => call.fileName)).toEqual(['photo.png', 'clip.mp4']);
  });

  it('помечает неподдерживаемый формат как skipped и не сохраняет его', async () => {
    const { app, store, previewer } = makeHarness();
    const cookie = await loginCookie(app);
    const before = tmpUploads('txt');

    const response = await request(app)
      .post('/api/admin/uploads')
      .set('Cookie', cookie)
      .field('setId', 'my-set')
      .attach('files', Buffer.from('plain text'), 'notes.txt');

    const body: UploadBody = response.body;
    expect(response.status).toBe(200);
    expect(body).toEqual({
      results: [{ name: 'notes.txt', ok: false, thumb: 'skipped', error: 'Неподдерживаемый формат' }],
      done: 0,
      failed: 1,
    });
    expect(store.keys()).toEqual([]);
    expect(previewer.calls).toEqual([]);
    expect(tmpUploads('txt')).toEqual(before);
  });

  it('не роняет загрузку, если превью не построилось', async () => {
    const { app, previewer } = makeHarness();
    previewer.failingNames.add('photo.png');
    const cookie = await loginCookie(app);

    const response = await request(app)
      .post('/api/admin/uploads')
      .set('Cookie', cookie)
      .field('setId', 'my-set')
      .attach('files', PNG_BYTES, 'photo.png');

    const body: UploadBody = response.body;
    expect(response.status).toBe(200);
    expect(body.results).toEqual([
      { name: 'photo.png', ok: true, thumb: 'failed', error: 'превью недоступно' },
    ]);
    expect(body.done).toBe(1);
  });

  it('отвечает 400 на некорректный setId и не оставляет временных файлов', async () => {
    const { app, store } = makeHarness();
    const cookie = await loginCookie(app);
    const before = tmpUploads('png');

    const response = await request(app)
      .post('/api/admin/uploads')
      .set('Cookie', cookie)
      .field('setId', 'bad/id')
      .attach('files', PNG_BYTES, 'photo.png');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Некорректный идентификатор сета' });
    expect(store.keys()).toEqual([]);
    expect(tmpUploads('png')).toEqual(before);
  });

  it('отвечает 400, если файлы не приложены', async () => {
    const { app } = makeHarness();
    const cookie = await loginCookie(app);

    const response = await request(app).post('/api/admin/uploads').set('Cookie', cookie).field('setId', 'my-set');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Не выбрано ни одного файла' });
  });

  it('отвечает 400 на файл больше лимита MAX_UPLOAD_MB', async () => {
    const { app, store } = makeHarness(TEST_ENV, {
      maxUploadMb: 1,
      maxUploadBytes: 1024 * 1024,
    });
    const cookie = await loginCookie(app);

    const response = await request(app)
      .post('/api/admin/uploads')
      .set('Cookie', cookie)
      .field('setId', 'my-set')
      .attach('files', Buffer.alloc(1024 * 1024 + 1, 7), 'big.png');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Файл слишком большой (макс. 1 МБ)' });
    expect(store.keys()).toEqual([]);
  });

  it('отвечает 400 на больше 20 файлов за раз', async () => {
    const { app, store } = makeHarness();
    const cookie = await loginCookie(app);

    let pending = request(app).post('/api/admin/uploads').set('Cookie', cookie).field('setId', 'my-set');
    for (let index = 0; index < 21; index += 1) {
      pending = pending.attach('files', PNG_BYTES, `photo-${index}.png`);
    }
    const response = await pending;

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Слишком много файлов (макс. 20)' });
    expect(store.keys()).toEqual([]);
  });

  it('отвечает 400 на файлы в неожиданном поле', async () => {
    const { app, store } = makeHarness();
    const cookie = await loginCookie(app);

    const response = await request(app)
      .post('/api/admin/uploads')
      .set('Cookie', cookie)
      .field('setId', 'my-set')
      .attach('file', PNG_BYTES, 'photo.png');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Неожиданное поле с файлом, ожидается поле files' });
    expect(store.keys()).toEqual([]);
  });

  it('очищает временный файл успешно загруженного файла', async () => {
    const { app } = makeHarness();
    const cookie = await loginCookie(app);
    const before = tmpUploads('png');

    await request(app)
      .post('/api/admin/uploads')
      .set('Cookie', cookie)
      .field('setId', 'my-set')
      .attach('files', PNG_BYTES, 'photo.png');

    expect(tmpUploads('png')).toEqual(before);
  });
});
