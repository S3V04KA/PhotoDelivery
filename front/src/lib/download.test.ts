import { describe, expect, it } from 'vitest';

import { DEFAULT_QUALITY, archiveUrl, fileUrl } from './download';

describe('archiveUrl', () => {
  it('архивирует весь сет, когда выбор не задан', () => {
    // Given / When
    const url = archiveUrl('my-set', undefined, 'raw');

    // Then
    expect(url).toBe('/api/sets/my-set/archive?quality=raw');
  });

  it('архивирует весь сет и при пустом списке имён', () => {
    // Given / When
    const url = archiveUrl('my-set', [], 'social');

    // Then
    expect(url).toBe('/api/sets/my-set/archive?quality=social');
  });

  it('передаёт выбранные имена одним параметром names', () => {
    // Given / When
    const url = archiveUrl('my-set', ['a.jpg', 'b.mp4'], 'social');

    // Then
    expect(url).toBe('/api/sets/my-set/archive?quality=social&names=a.jpg%2Cb.mp4');
  });

  it('кодирует каждый сегмент id сета отдельно', () => {
    // Given / When
    const url = archiveUrl('set #1/photo', undefined, 'jpeg');

    // Then
    expect(url).toBe('/api/sets/set%20%231%2Fphoto/archive?quality=jpeg');
  });
});

describe('fileUrl', () => {
  it('строит URL одного файла с качеством', () => {
    // Given / When
    const url = fileUrl('my-set', 'photo.jpg', 'raw');

    // Then
    expect(url).toBe('/api/sets/my-set/file/photo.jpg?quality=raw');
  });

  it('кодирует пробелы и спецсимволы в имени файла', () => {
    // Given / When
    const url = fileUrl('my-set', 'моё фото #1.jpg', 'social');

    // Then
    expect(url).toBe('/api/sets/my-set/file/%D0%BC%D0%BE%D1%91%20%D1%84%D0%BE%D1%82%D0%BE%20%231.jpg?quality=social');
  });

  it('кодирует имя по сегментам пути, как это делает s3.ts', () => {
    // Given / When
    const url = fileUrl('my-set', 'a/b.jpg', 'jpeg');

    // Then
    expect(url).toBe('/api/sets/my-set/file/a/b.jpg?quality=jpeg');
  });
});

describe('DEFAULT_QUALITY', () => {
  it('по умолчанию отдаёт сжатое для соцсетей', () => {
    // Given / When / Then
    expect(DEFAULT_QUALITY).toBe('social');
  });

  it('архив по умолчанию уходит с quality=social', () => {
    // Given / When
    const url = archiveUrl('my-set', undefined, DEFAULT_QUALITY);

    // Then
    expect(url).toBe('/api/sets/my-set/archive?quality=social');
  });

  it('архив выбранных файлов по умолчанию уходит с quality=social и names', () => {
    // Given / When
    const url = archiveUrl('my-set', ['a.jpg', 'b.mp4'], DEFAULT_QUALITY);

    // Then
    expect(url).toBe('/api/sets/my-set/archive?quality=social&names=a.jpg%2Cb.mp4');
  });

  it('файл по умолчанию уходит с quality=social', () => {
    // Given / When
    const url = fileUrl('my-set', 'photo.jpg', DEFAULT_QUALITY);

    // Then
    expect(url).toBe('/api/sets/my-set/file/photo.jpg?quality=social');
  });
});
