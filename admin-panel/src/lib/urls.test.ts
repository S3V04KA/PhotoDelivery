import { afterEach, describe, expect, it, vi } from 'vitest';

const DEFAULT_ORIGIN = 'http://localhost:9000/photos';

async function loadUrls(endpoint: string, bucket: string) {
  vi.stubEnv('VITE_S3_ENDPOINT', endpoint);
  vi.stubEnv('VITE_S3_BUCKET', bucket);
  return import('./urls');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('publicUrl', () => {
  it('собирает публичный URL бакета из переменных окружения', async () => {
    const { publicUrl } = await loadUrls('https://photos.example.com', 'archive');

    expect(publicUrl('my-set', 'photo.jpg')).toBe(
      'https://photos.example.com/archive/my-set/photo.jpg',
    );
  });

  it('режет завершающие слэши у endpoint, чтобы не было двойного разделителя', async () => {
    const { publicUrl } = await loadUrls('https://photos.example.com///', 'photos');

    expect(publicUrl('set', 'a.jpg')).toBe('https://photos.example.com/photos/set/a.jpg');
  });

  it('кодирует каждый сегмент пути отдельно', async () => {
    const { publicUrl } = await loadUrls('http://localhost:9000', 'photos');

    // Пробел, кириллица и решётка не должны ломать URL.
    expect(publicUrl('Отпуск 2024', 'Моё фото (1).jpg')).toBe(
      `${DEFAULT_ORIGIN}/${encodeURIComponent('Отпуск 2024')}/${encodeURIComponent('Моё фото (1).jpg')}`,
    );
    expect(publicUrl('set', 'a#b?c.jpg')).toBe(`${DEFAULT_ORIGIN}/set/a%23b%3Fc.jpg`);
  });

  it('не кодирует разделитель между сегментами', async () => {
    const { publicUrl } = await loadUrls('http://localhost:9000', 'photos');

    expect(publicUrl('set', 'thumb', 'a.jpg')).toBe(`${DEFAULT_ORIGIN}/set/thumb/a.jpg`);
  });
});

describe('thumbUrl', () => {
  it('для фото ищет превью с тем же именем', async () => {
    const { thumbUrl } = await loadUrls('http://localhost:9000', 'photos');

    expect(thumbUrl('set', 'Отпуск 1.jpg', 'image')).toBe(
      `${DEFAULT_ORIGIN}/set/thumb/${encodeURIComponent('Отпуск 1.jpg')}`,
    );
  });

  it('для видео берёт первый кадр по базовому имени', async () => {
    const { thumbUrl } = await loadUrls('http://localhost:9000', 'photos');

    expect(thumbUrl('set', 'clip.mp4', 'video')).toBe(`${DEFAULT_ORIGIN}/set/thumb/clip.jpg`);
    expect(thumbUrl('set', 'Отпуск.MOV', 'video')).toBe(
      `${DEFAULT_ORIGIN}/set/thumb/${encodeURIComponent('Отпуск')}.jpg`,
    );
  });

  it('для прочих файлов превью нет', async () => {
    const { thumbUrl } = await loadUrls('http://localhost:9000', 'photos');

    expect(thumbUrl('set', 'notes.txt', 'other')).toBeNull();
  });
});
