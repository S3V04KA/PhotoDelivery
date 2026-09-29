import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loginCookie, makeHarness } from '../testing/harness';

describe('GET /api/admin/sets', () => {
  it('агрегирует только медиа прямых потомков и сортирует по дате', async () => {
    const { app, store } = makeHarness();
    store.seed('alpha/one.jpg', 'a'.repeat(100), new Date('2026-01-01T10:00:00.000Z'), 'image/jpeg');
    store.seed('alpha/two.mp4', 'b'.repeat(200), new Date('2026-01-02T10:00:00.000Z'), 'video/mp4');
    store.seed('alpha/thumb/one.jpg', 't'.repeat(10), new Date('2026-01-05T10:00:00.000Z'));
    store.seed('alpha/', '', new Date('2026-01-05T10:00:00.000Z'));
    store.seed('alpha/notes.txt', 'n'.repeat(50), new Date('2026-01-05T10:00:00.000Z'));
    store.seed('beta/photo.png', 'c'.repeat(70), new Date('2026-01-03T10:00:00.000Z'), 'image/png');
    store.seed('loose-key', 'z', new Date('2026-01-06T10:00:00.000Z'));
    const cookie = await loginCookie(app);

    const response = await request(app).get('/api/admin/sets').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      sets: [
        { id: 'beta', files: 1, size: 70, lastModified: '2026-01-03T10:00:00.000Z' },
        { id: 'alpha', files: 2, size: 300, lastModified: '2026-01-02T10:00:00.000Z' },
      ],
    });
  });
});

describe('GET /api/admin/sets/:id/files', () => {
  it('возвращает прямых потомков с типом и не отдаёт thumb/', async () => {
    const { app, store } = makeHarness();
    store.seed('alpha/one.jpg', 'a'.repeat(100), new Date('2026-01-01T10:00:00.000Z'), 'image/jpeg');
    store.seed('alpha/two.mp4', 'b'.repeat(200), new Date('2026-01-02T10:00:00.000Z'), 'video/mp4');
    store.seed('alpha/notes.txt', 'n'.repeat(50), new Date('2026-01-03T10:00:00.000Z'));
    store.seed('alpha/thumb/one.jpg', 't'.repeat(10), new Date('2026-01-04T10:00:00.000Z'));
    store.seed('alpha/', '', new Date('2026-01-04T10:00:00.000Z'));
    const cookie = await loginCookie(app);

    const response = await request(app).get('/api/admin/sets/alpha/files').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      files: [
        { name: 'notes.txt', size: 50, lastModified: '2026-01-03T10:00:00.000Z', kind: 'other' },
        { name: 'one.jpg', size: 100, lastModified: '2026-01-01T10:00:00.000Z', kind: 'image' },
        { name: 'two.mp4', size: 200, lastModified: '2026-01-02T10:00:00.000Z', kind: 'video' },
      ],
    });
  });

  it('отвечает 400 на некорректный идентификатор сета', async () => {
    const { app } = makeHarness();
    const cookie = await loginCookie(app);

    const response = await request(app).get('/api/admin/sets/bad%2Fid/files').set('Cookie', cookie);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Некорректный идентификатор сета' });
  });
});
