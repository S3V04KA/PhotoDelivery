import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loginCookie, makeHarness, TEST_ENV } from '../testing/harness';

type Call = () => Promise<{ status: number; body: unknown }>;

describe('POST /api/admin/login', () => {
  it('выдаёт сессионную cookie с HttpOnly, SameSite=Strict и Path=/', async () => {
    const { app } = makeHarness();

    const response = await request(app)
      .post('/api/admin/login')
      .send({ login: 'admin', password: 'secret-pass' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    const header = response.headers['set-cookie'];
    const first = Array.isArray(header) ? header[0] : header;
    expect(first).toBeDefined();
    expect(first).toContain('pd_session=');
    expect(first).toContain('HttpOnly');
    expect(first).toContain('SameSite=Strict');
    expect(first).toContain('Path=/');
    expect(first).not.toContain('Secure');
  });

  it('ставит Secure, когда COOKIE_SECURE=true', async () => {
    const { app } = makeHarness({ ...TEST_ENV, COOKIE_SECURE: 'true' });

    const response = await request(app)
      .post('/api/admin/login')
      .send({ login: 'admin', password: 'secret-pass' });

    const header = response.headers['set-cookie'];
    const first = Array.isArray(header) ? header[0] : header;
    expect(first).toContain('Secure');
  });

  it('отвечает 401 на неверный логин и на неверный пароль', async () => {
    const { app } = makeHarness();

    const wrongLogin = await request(app).post('/api/admin/login').send({ login: 'root', password: 'secret-pass' });
    expect(wrongLogin.status).toBe(401);
    expect(wrongLogin.body).toEqual({ error: 'Неверный логин или пароль' });

    const wrongPassword = await request(app).post('/api/admin/login').send({ login: 'admin', password: 'nope' });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.body).toEqual({ error: 'Неверный логин или пароль' });
  });

  it('не пускает без JSON-тела', async () => {
    const { app } = makeHarness();
    const response = await request(app).post('/api/admin/login').send({});
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Неверный логин или пароль' });
  });

  it('блокирует шестую попытку после пяти неудачных', async () => {
    const { app } = makeHarness();
    const attempt = (password: string) => request(app).post('/api/admin/login').send({ login: 'admin', password });

    for (let index = 0; index < 5; index += 1) {
      expect((await attempt('wrong')).status).toBe(401);
    }
    const blocked = await attempt('secret-pass');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Слишком много попыток. Попробуйте позже.' });
  });

  it('сбрасывает счётчик неудач после успешного входа', async () => {
    const { app } = makeHarness();
    const wrong = () => request(app).post('/api/admin/login').send({ login: 'admin', password: 'wrong' });
    const right = () => request(app).post('/api/admin/login').send({ login: 'admin', password: 'secret-pass' });

    for (let index = 0; index < 3; index += 1) {
      expect((await wrong()).status).toBe(401);
    }
    expect((await right()).status).toBe(200);
    for (let index = 0; index < 3; index += 1) {
      expect((await wrong()).status).toBe(401);
    }
    expect((await right()).status).toBe(200);
  });
});

describe('аутентификация admin-маршрутов', () => {
  it('отвечает 401 без cookie на каждом маршруте, кроме логина', async () => {
    const { app } = makeHarness();
    const cases: readonly (readonly [string, Call])[] = [
      ['POST /api/admin/logout', () => request(app).post('/api/admin/logout')],
      ['GET /api/admin/me', () => request(app).get('/api/admin/me')],
      ['GET /api/admin/sets', () => request(app).get('/api/admin/sets')],
      ['GET /api/admin/sets/:id/files', () => request(app).get('/api/admin/sets/my-set/files')],
      ['POST /api/admin/uploads', () => request(app).post('/api/admin/uploads').field('setId', 'my-set')],
      ['DELETE /api/admin/sets/:id', () => request(app).delete('/api/admin/sets/my-set')],
      ['DELETE /api/admin/sets/:id/files', () => request(app).delete('/api/admin/sets/my-set/files').query({ name: 'a.jpg' })],
    ];

    for (const [label, call] of cases) {
      const response = await call();
      expect(`${label} -> ${response.status}`).toBe(`${label} -> 401`);
      expect(response.body).toEqual({ error: 'Не авторизован' });
    }
  });

  it('отвечает 401 на подделанную cookie', async () => {
    const { app } = makeHarness();
    const response = await request(app).get('/api/admin/me').set('Cookie', 'pd_session=v1.9999999999.deadbeef');
    expect(response.status).toBe(401);
  });

  it('пропускает с валидной cookie', async () => {
    const { app } = makeHarness();
    const cookie = await loginCookie(app);

    expect((await request(app).get('/api/admin/me').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).get('/api/admin/sets').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).get('/api/admin/sets/my-set/files').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).delete('/api/admin/sets/my-set').set('Cookie', cookie)).status).toBe(200);
    expect((await request(app).delete('/api/admin/sets/my-set/files').query({ name: 'a.jpg' }).set('Cookie', cookie)).status).toBe(200);
  });
});

describe('GET /api/admin/me и POST /api/admin/logout', () => {
  it('me отвечает ok', async () => {
    const { app } = makeHarness();
    const cookie = await loginCookie(app);

    const response = await request(app).get('/api/admin/me').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('logout чистит cookie', async () => {
    const { app } = makeHarness();
    const cookie = await loginCookie(app);

    const response = await request(app).post('/api/admin/logout').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    const header = response.headers['set-cookie'];
    const first = Array.isArray(header) ? header[0] : header;
    expect(first).toContain('pd_session=;');
    expect(first).toContain('Expires=Thu, 01 Jan 1970');
  });
});
