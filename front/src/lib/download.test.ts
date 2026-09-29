import { describe, expect, it } from 'vitest';

import { DEFAULT_QUALITY, archiveUrl, fileUrl } from './download';

describe('archiveUrl', () => {
  it('архивирует весь сет, когда выбор не задан', () => {
    // Given / When
    const url = archiveUrl('my-set', undefined, 'original');

    // Then
    expect(url).toBe('/api/sets/my-set/archive?quality=original');
  });

  it('архивирует весь сет и при пустом списке имён', () => {
    // Given / When
    const url = archiveUrl('my-set', [], 'compressed');

    // Then
    expect(url).toBe('/api/sets/my-set/archive?quality=compressed');
  });

  it('передаёт выбранные имена одним параметром names', () => {
    // Given / When
    const url = archiveUrl('my-set', ['a.jpg', 'b.mp4'], 'compressed');

    // Then
    expect(url).toBe('/api/sets/my-set/archive?quality=compressed&names=a.jpg%2Cb.mp4');
  });

  it('кодирует каждый сегмент id сета отдельно', () => {
    // Given / When
    const url = archiveUrl('set #1/photo', undefined, 'original');

    // Then
    expect(url).toBe('/api/sets/set%20%231%2Fphoto/archive?quality=original');
  });
});

describe('fileUrl', () => {
  it('строит URL одного файла с качеством', () => {
    // Given / When
    const url = fileUrl('my-set', 'photo.jpg', 'original');

    // Then
    expect(url).toBe('/api/sets/my-set/file/photo.jpg?quality=original');
  });

  it('кодирует пробелы и спецсимволы в имени файла', () => {
    // Given / When
    const url = fileUrl('my-set', 'моё фото #1.jpg', 'compressed');

    // Then
    expect(url).toBe('/api/sets/my-set/file/%D0%BC%D0%BE%D1%91%20%D1%84%D0%BE%D1%82%D0%BE%20%231.jpg?quality=compressed');
  });

  it('кодирует имя по сегментам пути, как это делает s3.ts', () => {
    // Given / When
    const url = fileUrl('my-set', 'a/b.jpg', 'original');

    // Then
    expect(url).toBe('/api/sets/my-set/file/a/b.jpg?quality=original');
  });
});

describe('DEFAULT_QUALITY', () => {
  it('по умолчанию отдаёт сжатое, а не оригинал', () => {
    // Given / When / Then
    expect(DEFAULT_QUALITY).toBe('compressed');
  });

  it('архив по умолчанию уходит с quality=compressed', () => {
    // Given / When
    const url = archiveUrl('my-set', undefined, DEFAULT_QUALITY);

    // Then
    expect(url).toBe('/api/sets/my-set/archive?quality=compressed');
  });

  it('архив выбранных файлов по умолчанию уходит с quality=compressed и names', () => {
    // Given / When
    const url = archiveUrl('my-set', ['a.jpg', 'b.mp4'], DEFAULT_QUALITY);

    // Then
    expect(url).toBe('/api/sets/my-set/archive?quality=compressed&names=a.jpg%2Cb.mp4');
  });

  it('файл по умолчанию уходит с quality=compressed', () => {
    // Given / When
    const url = fileUrl('my-set', 'photo.jpg', DEFAULT_QUALITY);

    // Then
    expect(url).toBe('/api/sets/my-set/file/photo.jpg?quality=compressed');
  });
});
