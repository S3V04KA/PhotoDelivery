import { describe, expect, it } from 'vitest';

import { s3Config } from './config';
import {
  gridImageCandidates,
  isDisplayableImage,
  thumbBasenameJpg,
  viewerImageCandidates,
} from './media';
import type { MediaItem } from './types';

const ORIGIN = `${s3Config.endpoint}/${s3Config.bucket}`;

const JPG_IMAGE: MediaItem = {
  key: 'set/a.jpg',
  name: 'a.jpg',
  url: `${ORIGIN}/set/a.jpg`,
  thumbUrl: `${ORIGIN}/set/thumb/a.jpg`,
  kind: 'image',
};

const PNG_IMAGE: MediaItem = {
  key: 'set/a.png',
  name: 'a.png',
  url: `${ORIGIN}/set/a.png`,
  thumbUrl: `${ORIGIN}/set/thumb/a.png`,
  kind: 'image',
};

const HEIC_IMAGE: MediaItem = {
  key: 'set/a.heic',
  name: 'a.heic',
  url: `${ORIGIN}/set/a.heic`,
  thumbUrl: `${ORIGIN}/set/thumb/a.heic`,
  kind: 'image',
};

const MOV_VIDEO: MediaItem = {
  key: 'set/clip.mov',
  name: 'clip.mov',
  url: `${ORIGIN}/set/clip.mov`,
  thumbUrl: `${ORIGIN}/set/thumb/clip.jpg`,
  kind: 'video',
};

describe('thumbBasenameJpg', () => {
  it('строит thumb/{basename}.jpg для фото, которое не удалось закодировать', () => {
    // Given
    const item = HEIC_IMAGE;

    // When
    const url = thumbBasenameJpg(item);

    // Then
    expect(url).toBe(`${ORIGIN}/set/thumb/a.jpg`);
  });

  it('совпадает с thumbUrl у jpg, поэтому повтор в цепочке не нужен', () => {
    // Given
    const item = JPG_IMAGE;

    // When
    const url = thumbBasenameJpg(item);

    // Then
    expect(url).toBe(`${ORIGIN}/set/thumb/a.jpg`);
    expect(url).toBe(item.thumbUrl);
  });

  it('кодирует каждый сегмент ключа так же, как s3.ts', () => {
    // Given
    const item: MediaItem = {
      key: 'Отпуск 2024/фото 1.heic',
      name: 'фото 1.heic',
      url: `${ORIGIN}/%D0%9E%D1%82%D0%BF%D1%83%D1%81%D0%BA%202024/%D1%84%D0%BE%D1%82%D0%BE%201.heic`,
      thumbUrl: `${ORIGIN}/%D0%9E%D1%82%D0%BF%D1%83%D1%81%D0%BA%202024/thumb/%D1%84%D0%BE%D1%82%D0%BE%201.heic`,
      kind: 'image',
    };

    // When
    const url = thumbBasenameJpg(item);

    // Then
    expect(url).toBe(`${ORIGIN}/%D0%9E%D1%82%D0%BF%D1%83%D1%81%D0%BA%202024/thumb/%D1%84%D0%BE%D1%82%D0%BE%201.jpg`);
  });

  it('экранирует плюс в имени видео и отбрасывает расширение оригинала', () => {
    // Given
    const item: MediaItem = {
      key: 'set/клип+.mp4',
      name: 'клип+.mp4',
      url: `${ORIGIN}/set/%D0%BA%D0%BB%D0%B8%D0%BF%2B.mp4`,
      thumbUrl: `${ORIGIN}/set/thumb/%D0%BA%D0%BB%D0%B8%D0%BF%2B.jpg`,
      kind: 'video',
    };

    // When
    const url = thumbBasenameJpg(item);

    // Then
    expect(url).toBe(`${ORIGIN}/set/thumb/%D0%BA%D0%BB%D0%B8%D0%BF%2B.jpg`);
  });

  it('отбрасывает хвостовую точку: имя без расширения даёт basename целиком', () => {
    // Given
    const item: MediaItem = {
      key: 'set/a.',
      name: 'a.',
      url: `${ORIGIN}/set/a.`,
      thumbUrl: `${ORIGIN}/set/thumb/a.`,
      kind: 'image',
    };

    // When
    const url = thumbBasenameJpg(item);

    // Then
    expect(url).toBe(`${ORIGIN}/set/thumb/a.jpg`);
  });

  it('не срезает имя, если точка стоит в начале (скрытый файл)', () => {
    // Given
    const item: MediaItem = {
      key: 'set/.photo',
      name: '.photo',
      url: `${ORIGIN}/set/.photo`,
      thumbUrl: `${ORIGIN}/set/thumb/.photo`,
      kind: 'image',
    };

    // When
    const url = thumbBasenameJpg(item);

    // Then
    expect(url).toBe(`${ORIGIN}/set/thumb/.photo.jpg`);
  });
});

describe('gridImageCandidates', () => {
  it('для jpg идёт от превью сразу к оригиналу, без дубликата basename', () => {
    // Given
    const item = JPG_IMAGE;

    // When
    const candidates = gridImageCandidates(item);

    // Then
    expect(candidates).toEqual([`${ORIGIN}/set/thumb/a.jpg`, `${ORIGIN}/set/a.jpg`]);
  });

  it('для png пробует превью с тем же именем, потом basename.jpg, потом оригинал', () => {
    // Given
    const item = PNG_IMAGE;

    // When
    const candidates = gridImageCandidates(item);

    // Then
    expect(candidates).toEqual([
      `${ORIGIN}/set/thumb/a.png`,
      `${ORIGIN}/set/thumb/a.jpg`,
      `${ORIGIN}/set/a.png`,
    ]);
  });

  it('для heic не отдаёт превью heic на первом месте — только как первый шаг', () => {
    // Given
    const item = HEIC_IMAGE;

    // When
    const candidates = gridImageCandidates(item);

    // Then
    expect(candidates).toEqual([
      `${ORIGIN}/set/thumb/a.heic`,
      `${ORIGIN}/set/thumb/a.jpg`,
      `${ORIGIN}/set/a.heic`,
    ]);
  });

  it('для tiff в верхнем регистре сохраняет имя basename.jpg в нижнем регистре', () => {
    // Given
    const item: MediaItem = {
      key: 'set/Photo.TIFF',
      name: 'Photo.TIFF',
      url: `${ORIGIN}/set/Photo.TIFF`,
      thumbUrl: `${ORIGIN}/set/thumb/Photo.TIFF`,
      kind: 'image',
    };

    // When
    const candidates = gridImageCandidates(item);

    // Then
    expect(candidates).toEqual([
      `${ORIGIN}/set/thumb/Photo.TIFF`,
      `${ORIGIN}/set/thumb/Photo.jpg`,
      `${ORIGIN}/set/Photo.TIFF`,
    ]);
  });

  it('для видео не подставляет оригинал: видеофайл нельзя показать в img', () => {
    // Given
    const item = MOV_VIDEO;

    // When
    const candidates = gridImageCandidates(item);

    // Then
    expect(candidates).toEqual([`${ORIGIN}/set/thumb/clip.jpg`]);
    expect(candidates).not.toContain(`${ORIGIN}/set/clip.mov`);
  });

  it('для видео с превью под исходным именем оставляет оба шага', () => {
    // Given
    const item: MediaItem = {
      key: 'set/clip.mov',
      name: 'clip.mov',
      url: `${ORIGIN}/set/clip.mov`,
      thumbUrl: `${ORIGIN}/set/thumb/clip.mov`,
      kind: 'video',
    };

    // When
    const candidates = gridImageCandidates(item);

    // Then
    expect(candidates).toEqual([`${ORIGIN}/set/thumb/clip.mov`, `${ORIGIN}/set/thumb/clip.jpg`]);
    expect(candidates).not.toContain(`${ORIGIN}/set/clip.mov`);
  });

  it('не повторяет кандидата, если превью уже ведёт на basename.jpg', () => {
    // Given
    const item: MediaItem = {
      key: 'set/a.heic',
      name: 'a.heic',
      url: `${ORIGIN}/set/a.heic`,
      thumbUrl: `${ORIGIN}/set/thumb/a.jpg`,
      kind: 'image',
    };

    // When
    const candidates = gridImageCandidates(item);

    // Then
    expect(candidates).toEqual([`${ORIGIN}/set/thumb/a.jpg`, `${ORIGIN}/set/a.heic`]);
  });
});

describe('viewerImageCandidates', () => {
  it('для отображаемого jpg показывает оригинал первым', () => {
    // Given
    const item = JPG_IMAGE;

    // When
    const candidates = viewerImageCandidates(item);

    // Then
    expect(candidates).toEqual([`${ORIGIN}/set/a.jpg`, `${ORIGIN}/set/thumb/a.jpg`]);
  });

  it('для png оставляет оригинал первым, превью и basename.jpg — запасными', () => {
    // Given
    const item = PNG_IMAGE;

    // When
    const candidates = viewerImageCandidates(item);

    // Then
    expect(candidates).toEqual([
      `${ORIGIN}/set/a.png`,
      `${ORIGIN}/set/thumb/a.png`,
      `${ORIGIN}/set/thumb/a.jpg`,
    ]);
  });

  it('для heic ставит jpeg-превью первым, оригинал — последним запасным для Safari', () => {
    // Given
    const item = HEIC_IMAGE;

    // When
    const candidates = viewerImageCandidates(item);

    // Then
    expect(candidates).toEqual([
      `${ORIGIN}/set/thumb/a.heic`,
      `${ORIGIN}/set/thumb/a.jpg`,
      `${ORIGIN}/set/a.heic`,
    ]);
  });

  it('для видео не строит кандидатов-картинок', () => {
    // Given
    const item = MOV_VIDEO;

    // When
    const candidates = viewerImageCandidates(item);

    // Then
    expect(candidates).toEqual([]);
  });
});

describe('isDisplayableImage', () => {
  const DISPLAYABLE: readonly string[] = [
    'a.jpg',
    'a.JPG',
    'Photo.jpeg',
    'a.png',
    'a.gif',
    'a.webp',
    'a.avif',
    'a.bmp',
    'a.jfif',
    'my.holiday.photo.png',
  ];

  it.each(DISPLAYABLE)('считает отображаемым %s', (name) => {
    expect(isDisplayableImage(name)).toBe(true);
  });

  const NOT_DISPLAYABLE: readonly string[] = [
    'a.tif',
    'a.tiff',
    'a.HEIC',
    'a.heif',
    'photo.jpg.heic',
    'holiday',
    '.env',
    'a.',
  ];

  it.each(NOT_DISPLAYABLE)('не считает отображаемым %s', (name) => {
    expect(isDisplayableImage(name)).toBe(false);
  });
});
