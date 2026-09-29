import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { s3Config } from './config';
import { listMedia } from './s3';
import { SetNotFoundError, S3Error } from './types';

const ORIGIN = `${s3Config.endpoint}/${s3Config.bucket}`;

function listing(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${inner}</ListBucketResult>`;
}

function item(key: string): string {
  return `<Contents><Key>${key}</Key><LastModified>2024-01-01T00:00:00.000Z</LastModified><Size>1024</Size></Contents>`;
}

function reply(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/xml' } });
}

function fault(code: string, status: number): Response {
  return reply(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>storage said no</Message></Error>`, status);
}

function stubFetch(...replies: readonly Response[]): Mock {
  const queue = [...replies];
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => {
    const next = queue.shift();
    if (next === undefined) return Promise.reject(new Error('лишний запрос к хранилищу'));
    return Promise.resolve(next);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestedUrl(mock: Mock, call: number): string {
  const args = mock.mock.calls[call];
  if (args === undefined) throw new Error(`запрос #${call} не был выполнен`);
  return String(args[0]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listMedia: запрос и разбор листинга', () => {
  it('строит ключ, имя и URL для файлов с кириллицей и пробелами', async () => {
    // Given
    stubFetch(
      reply(
        listing(
          item('Отпуск 2024/фото 1.jpg') +
            item('Отпуск 2024/клип+.mp4') +
            '<CommonPrefixes><Prefix>Отпуск 2024/thumb/</Prefix></CommonPrefixes>',
        ),
      ),
    );

    // When
    const items = await listMedia('Отпуск 2024');

    // Then
    expect(items).toEqual([
      {
        key: 'Отпуск 2024/клип+.mp4',
        name: 'клип+.mp4',
        url: 'http://localhost:9000/photos/%D0%9E%D1%82%D0%BF%D1%83%D1%81%D0%BA%202024/%D0%BA%D0%BB%D0%B8%D0%BF%2B.mp4',
        thumbUrl: 'http://localhost:9000/photos/%D0%9E%D1%82%D0%BF%D1%83%D1%81%D0%BA%202024/thumb/%D0%BA%D0%BB%D0%B8%D0%BF%2B.jpg',
        kind: 'video',
      },
      {
        key: 'Отпуск 2024/фото 1.jpg',
        name: 'фото 1.jpg',
        url: 'http://localhost:9000/photos/%D0%9E%D1%82%D0%BF%D1%83%D1%81%D0%BA%202024/%D1%84%D0%BE%D1%82%D0%BE%201.jpg',
        thumbUrl: 'http://localhost:9000/photos/%D0%9E%D1%82%D0%BF%D1%83%D1%81%D0%BA%202024/thumb/%D1%84%D0%BE%D1%82%D0%BE%201.jpg',
        kind: 'image',
      },
    ]);
  });

  it('запрашивает list-type=2 с delimiter и префиксом набора', async () => {
    // Given
    const fetchMock = stubFetch(reply(listing(item('set 1/a.jpg'))));

    // When
    await listMedia('set 1');

    // Then
    expect(requestedUrl(fetchMock, 0)).toBe(
      `${ORIGIN}?list-type=2&delimiter=/&prefix=set%201%2F`,
    );
  });

  it('не отправляет заголовков авторизации и запрещает кэш', async () => {
    // Given
    const fetchMock = stubFetch(reply(listing(item('set 1/a.jpg'))));

    // When
    await listMedia('set 1');

    // Then
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.cache).toBe('no-store');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });

  it('обрезает пробелы и слэши вокруг идентификатора набора', async () => {
    // Given
    const fetchMock = stubFetch(reply(listing(item('set 1/a.jpg'))));

    // When
    await listMedia('  /set 1/  ');

    // Then
    expect(requestedUrl(fetchMock, 0)).toBe(
      `${ORIGIN}?list-type=2&delimiter=/&prefix=set%201%2F`,
    );
  });
});

describe('listMedia: фильтрация и сортировка', () => {
  it('исключает файлы из подпапки thumb, даже если они пришли в Contents', async () => {
    // Given
    stubFetch(reply(listing(item('set/a.jpg') + item('set/thumb/a.jpg'))));

    // When
    const items = await listMedia('set');

    // Then
    expect(items.map((entry) => entry.key)).toEqual(['set/a.jpg']);
  });

  it('игнорирует CommonPrefixes вложенных папок', async () => {
    // Given
    stubFetch(
      reply(
        listing(
          item('set/a.jpg') +
            '<CommonPrefixes><Prefix>set/thumb/</Prefix></CommonPrefixes>' +
            '<CommonPrefixes><Prefix>set/sub/</Prefix></CommonPrefixes>',
        ),
      ),
    );

    // When
    const items = await listMedia('set');

    // Then
    expect(items.map((entry) => entry.name)).toEqual(['a.jpg']);
  });

  it('пропускает неподдерживаемые расширения, скрытые файлы и папку набора', async () => {
    // Given
    stubFetch(
      reply(
        listing(
          item('set/a.jpg') +
            item('set/notes.txt') +
            item('set/meta.json') +
            item('set/.DS_Store') +
            item('set/'),
        ),
      ),
    );

    // When
    const items = await listMedia('set');

    // Then
    expect(items.map((entry) => entry.name)).toEqual(['a.jpg']);
  });

  it('сортирует имена натурально: img2 раньше img10', async () => {
    // Given
    stubFetch(reply(listing(item('set/img10.jpg') + item('set/img2.jpg') + item('set/IMG1.jpg'))));

    // When
    const items = await listMedia('set');

    // Then
    expect(items.map((entry) => entry.name)).toEqual(['IMG1.jpg', 'img2.jpg', 'img10.jpg']);
  });

  it('понимает расширения в верхнем регистре', async () => {
    // Given
    stubFetch(reply(listing(item('set/a.HEIC') + item('set/b.MOV'))));

    // When
    const items = await listMedia('set');

    // Then
    expect(items.map((entry) => entry.kind)).toEqual(['image', 'video']);
  });

  it('заменяет расширение видео на .jpg в превью, сохраняя точки в имени', async () => {
    // Given
    stubFetch(reply(listing(item('set/клип 1.mp4') + item('set/clip.mov'))));

    // When
    const items = await listMedia('set');

    // Then
    expect(items.map((entry) => entry.thumbUrl)).toEqual([
      `${ORIGIN}/set/thumb/clip.jpg`,
      `${ORIGIN}/set/thumb/%D0%BA%D0%BB%D0%B8%D0%BF%201.jpg`,
    ]);
  });
});

describe('listMedia: постраничный листинг', () => {
  it('запрашивает следующую страницу с маркером и склеивает результаты', async () => {
    // Given
    const fetchMock = stubFetch(
      reply(listing(item('set/a.jpg') + '<IsTruncated>true</IsTruncated><NextContinuationToken>abc+def==</NextContinuationToken>')),
      reply(listing(item('set/b.jpg') + '<IsTruncated>false</IsTruncated>')),
    );

    // When
    const items = await listMedia('set');

    // Then
    expect(requestedUrl(fetchMock, 1)).toBe(
      `${ORIGIN}?list-type=2&delimiter=/&prefix=set%2F&continuation-token=abc%2Bdef%3D%3D`,
    );
    expect(items.map((entry) => entry.name)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('останавливается после 100 страниц, чтобы не зациклиться', async () => {
    // Given
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        reply(listing(item('set/a.jpg') + '<IsTruncated>true</IsTruncated><NextContinuationToken>next</NextContinuationToken>')),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    // When / Then
    await expect(listMedia('set')).rejects.toBeInstanceOf(S3Error);
    expect(fetchMock).toHaveBeenCalledTimes(100);
  });

  it('считает битым ответ без маркера продолжения ошибкой хранилища', async () => {
    // Given
    stubFetch(reply(listing(item('set/a.jpg') + '<IsTruncated>true</IsTruncated>')));

    // When / Then
    await expect(listMedia('set')).rejects.toBeInstanceOf(S3Error);
  });
});

describe('listMedia: ошибки', () => {
  it('сообщает об отсутствии набора по HTTP 404', async () => {
    // Given
    stubFetch(fault('NoSuchKey', 404));

    // When / Then
    await expect(listMedia('set')).rejects.toBeInstanceOf(SetNotFoundError);
  });

  it('сообщает об отсутствии бакета по коду NoSuchBucket в успешном ответе', async () => {
    // Given
    stubFetch(fault('NoSuchBucket', 200));

    // When / Then
    await expect(listMedia('set')).rejects.toBeInstanceOf(SetNotFoundError);
  });

  it('сообщает об отсутствии набора по пустому листингу', async () => {
    // Given
    stubFetch(reply(listing('<IsTruncated>false</IsTruncated>')));

    // When / Then
    await expect(listMedia('set')).rejects.toBeInstanceOf(SetNotFoundError);
  });

  it('сообщает об отсутствии набора по пустому идентификатору и не ходит в сеть', async () => {
    // Given
    const fetchMock = stubFetch();

    // When / Then
    await expect(listMedia('  /  ')).rejects.toBeInstanceOf(SetNotFoundError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('просит закрыть диалог при отказе в доступе (HTTP 403)', async () => {
    // Given
    stubFetch(fault('AccessDenied', 403));

    // When
    const failure = listMedia('set');

    // Then
    await expect(failure).rejects.toBeInstanceOf(S3Error);
    await expect(failure).rejects.toThrow('Нет доступа к хранилищу');
  });

  it('просит закрыть диалог при коде AccessDenied без 403', async () => {
    // Given
    stubFetch(fault('AccessDenied', 400));

    // When / Then
    await expect(listMedia('set')).rejects.toThrow('Нет доступа к хранилищу');
  });

  it('превращает сетевой сбой в ошибку хранилища', async () => {
    // Given
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));

    // When / Then
    await expect(listMedia('set')).rejects.toBeInstanceOf(S3Error);
  });

  it('превращает ошибку сервера в ошибку хранилища с кодом ответа', async () => {
    // Given
    stubFetch(fault('InternalError', 500));

    // When
    const failure = listMedia('set');

    // Then
    await expect(failure).rejects.toBeInstanceOf(S3Error);
    await expect(failure).rejects.toThrow('500');
  });

  it('превращает обрыв чтения тела ответа в ошибку хранилища', async () => {
    // Given
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, text: () => Promise.reject(new Error('поток оборван')) }),
      ),
    );

    // When / Then
    await expect(listMedia('set')).rejects.toBeInstanceOf(S3Error);
  });

  it('превращает нечитаемый ответ в ошибку хранилища', async () => {
    // Given
    stubFetch(reply('<html><body>502 Bad Gateway</body></html>'));

    // When / Then
    await expect(listMedia('set')).rejects.toBeInstanceOf(S3Error);
  });
});
