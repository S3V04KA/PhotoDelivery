import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loginCookie, makeHarness } from '../testing/harness';

describe('DELETE /api/admin/sets/:id/files', () => {
  it('удаляет оригинал и оба кандидата превью', async () => {
    const { app, store } = makeHarness();
    store.seed('alpha/photo.jpg', 'a', new Date('2026-01-01T00:00:00.000Z'));
    store.seed('alpha/thumb/photo.jpg', 't', new Date('2026-01-01T00:00:00.000Z'));
    store.seed('alpha/other.png', 'o', new Date('2026-01-01T00:00:00.000Z'));
    const cookie = await loginCookie(app);

    const response = await request(app)
      .delete('/api/admin/sets/alpha/files')
      .query({ name: 'photo.jpg' })
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deleted: 1 });
    expect(store.keys()).toEqual(['alpha/other.png']);
    expect(store.deleteBatches).toEqual([
      ['alpha/photo.jpg', 'alpha/thumb/photo.jpg', 'alpha/thumb/photo.jpg'],
    ]);
  });

  it('возвращает deleted: 0, если оригинала не было', async () => {
    const { app, store } = makeHarness();
    store.seed('alpha/thumb/photo.jpg', 't', new Date('2026-01-01T00:00:00.000Z'));
    const cookie = await loginCookie(app);

    const response = await request(app)
      .delete('/api/admin/sets/alpha/files')
      .query({ name: 'photo.jpg' })
      .set('Cookie', cookie);

    expect(response.body).toEqual({ deleted: 0 });
    expect(store.keys()).toEqual([]);
  });

  it('отвечает 400 на пустое имя файла', async () => {
    const { app } = makeHarness();
    const cookie = await loginCookie(app);

    const response = await request(app).delete('/api/admin/sets/alpha/files').set('Cookie', cookie);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Некорректное имя файла' });
  });
});

describe('DELETE /api/admin/sets/:id', () => {
  it('удаляет все ключи сета, включая thumb/, и считает их', async () => {
    const { app, store } = makeHarness();
    store.seed('alpha/one.jpg', 'a', new Date('2026-01-01T00:00:00.000Z'));
    store.seed('alpha/two.mp4', 'b', new Date('2026-01-01T00:00:00.000Z'));
    store.seed('alpha/thumb/one.jpg', 't', new Date('2026-01-01T00:00:00.000Z'));
    store.seed('alpha/thumb/two.jpg', 't', new Date('2026-01-01T00:00:00.000Z'));
    store.seed('beta/photo.png', 'c', new Date('2026-01-01T00:00:00.000Z'));
    const cookie = await loginCookie(app);

    const response = await request(app).delete('/api/admin/sets/alpha').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deleted: 4 });
    expect(store.keys()).toEqual(['beta/photo.png']);
  });

  it('отвечает deleted: 0 для пустого сета и 400 для плохого идентификатора', async () => {
    const { app } = makeHarness();
    const cookie = await loginCookie(app);

    const empty = await request(app).delete('/api/admin/sets/alpha').set('Cookie', cookie);
    expect(empty.body).toEqual({ deleted: 0 });

    const bad = await request(app).delete('/api/admin/sets/..').set('Cookie', cookie);
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'Некорректный идентификатор сета' });
  });
});
