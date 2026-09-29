import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  deleteFile,
  deleteSet,
  errorMessage,
  isUnauthorized,
  listFiles,
  listSets,
  login,
  logout,
  me,
} from './api';

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
}

let calls: Call[] = [];

function reply(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : null,
      });

      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
      } as Response);
    },
  );
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('пути запросов', () => {
  it('собирает адреса из контракта, а не из догадок', async () => {
    // Given
    reply(200, { ok: true });

    // When
    await me();
    await login('admin', 'secret');
    await logout();
    await listSets();
    await listFiles('my set');
    await deleteFile('my set', 'a b.jpg');
    await deleteSet('my set');

    // Then
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/admin/me',
      'POST /api/admin/login',
      'POST /api/admin/logout',
      'GET /api/admin/sets',
      'GET /api/admin/sets/my%20set/files',
      'DELETE /api/admin/sets/my%20set/files?name=a%20b.jpg',
      'DELETE /api/admin/sets/my%20set',
    ]);
  });

  it('отправляет логин и пароль JSON-полями login и password', async () => {
    // Given
    reply(200, { ok: true });

    // When
    await login('admin', 'secret');

    // Then
    expect(calls[0].body).toBe('{"login":"admin","password":"secret"}');
  });
});

describe('разбор ответов', () => {
  it('читает списки и отбрасывает битые записи', async () => {
    // Given
    reply(200, {
      sets: [
        { id: 'a', files: 2, size: 1024, lastModified: '2026-01-01T00:00:00Z' },
        { files: 99 },
        null,
      ],
    });

    // When
    const sets = await listSets();

    // Then
    expect(sets).toEqual([
      { id: 'a', files: 2, size: 1024, lastModified: '2026-01-01T00:00:00Z' },
    ]);
  });

  it('понимает kind и не верит мусорным значениям', async () => {
    // Given
    reply(200, {
      files: [
        { name: 'a.jpg', size: 1, lastModified: '2026-01-01T00:00:00Z', kind: 'image' },
        { name: 'a.mp4', size: 2, lastModified: '2026-01-01T00:00:00Z', kind: 'video' },
        { name: 'a.txt', size: 3, lastModified: '2026-01-01T00:00:00Z', kind: 'видео' },
        { size: 4 },
      ],
    });

    // When
    const files = await listFiles('a');

    // Then
    expect(files.map((file) => file.kind)).toEqual(['image', 'video', 'other']);
    expect(files).toHaveLength(3);
  });

  it('не падает на не-JSON теле ответа', async () => {
    // Given
    reply(200, '<html>прокси сломался</html>');

    // Then
    await expect(me()).rejects.toThrow(ApiError);
  });
});

describe('ошибки', () => {
  it('берёт текст из поля error', async () => {
    // Given
    reply(401, { error: 'Не авторизован' });

    // When
    const failure = await me().catch((error: unknown) => error);

    // Then
    expect(failure).toBeInstanceOf(ApiError);
    expect(isUnauthorized(failure)).toBe(true);
    expect(errorMessage(failure)).toBe('Не авторизован');
  });

  it('не путает 401 с другими статусами и подставляет текст по умолчанию', async () => {
    // Given
    reply(429, { error: 'Слишком много попыток. Попробуйте позже.' });

    // When
    const rateLimited = await login('a', 'b').catch((error: unknown) => error);
    reply(500, '');
    const broken = await listSets().catch((error: unknown) => error);

    // Then
    expect(isUnauthorized(rateLimited)).toBe(false);
    expect(errorMessage(rateLimited)).toBe('Слишком много попыток. Попробуйте позже.');
    expect(errorMessage(broken)).toBe('Ошибка сервера (500)');
  });

  it('превращает обрыв сети в ApiError без статуса', async () => {
    // Given
    vi.stubGlobal('fetch', (): Promise<Response> => Promise.reject(new TypeError('offline')));

    // When
    const failure = await listSets().catch((error: unknown) => error);

    // Then
    expect(failure).toBeInstanceOf(ApiError);
    expect(isUnauthorized(failure)).toBe(false);
    expect(errorMessage(failure)).toBe('Нет связи с сервером');
  });
});
