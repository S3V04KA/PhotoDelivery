import { describe, expect, it } from 'vitest';

import {
  MAX_SET_ID_LENGTH,
  extensionOf,
  isSupportedMedia,
  kindLabel,
  mediaKind,
  validateSetId,
} from './validate';

describe('validateSetId', () => {
  it('принимает обычный ID и обрезает пробелы вокруг', () => {
    expect(validateSetId('  otpusk-2024  ')).toEqual({ ok: true, value: 'otpusk-2024' });
    expect(validateSetId('Отпуск 2024')).toEqual({ ok: true, value: 'Отпуск 2024' });
  });

  it('отклоняет пустое значение', () => {
    expect(validateSetId('')).toEqual({ ok: false, error: 'Введите ID сета' });
    expect(validateSetId('    ')).toEqual({ ok: false, error: 'Введите ID сета' });
  });

  it('отклоняет ID длиннее лимита и принимает его ровно на границе', () => {
    const atLimit = 'a'.repeat(MAX_SET_ID_LENGTH);

    expect(validateSetId(atLimit).ok).toBe(true);
    expect(validateSetId(`${atLimit}a`).ok).toBe(false);
  });

  it('отклоняет слэши в любом виде', () => {
    expect(validateSetId('a/b').ok).toBe(false);
    expect(validateSetId('a\\b').ok).toBe(false);
  });

  it('отклоняет относительные пути и управляющие символы', () => {
    expect(validateSetId('.').ok).toBe(false);
    expect(validateSetId('..').ok).toBe(false);
    expect(validateSetId('a\u0000b').ok).toBe(false);
    expect(validateSetId('a\nb').ok).toBe(false);
    expect(validateSetId('a\u007Fb').ok).toBe(false);
  });

  it('не запрещает точку внутри имени', () => {
    expect(validateSetId('my.set.2024')).toEqual({ ok: true, value: 'my.set.2024' });
  });
});

describe('extensionOf', () => {
  it('возвращает расширение в нижнем регистре без точки', () => {
    expect(extensionOf('Photo.JPG')).toBe('jpg');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });

  it('возвращает пустую строку, если расширения нет или оно скрытое', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
  });
});

describe('mediaKind', () => {
  it('узнаёт изображения', () => {
    for (const name of ['a.jpg', 'a.JPEG', 'a.png', 'a.webp', 'a.avif', 'a.heic', 'a.tif']) {
      expect(mediaKind(name)).toBe('image');
    }
  });

  it('узнаёт видео', () => {
    for (const name of ['a.mp4', 'a.MOV', 'a.mkv', 'a.avi', 'a.m4v']) {
      expect(mediaKind(name)).toBe('video');
    }
  });

  it('всё остальное — прочие файлы', () => {
    for (const name of ['a.txt', 'a.zip', 'README', 'a.', '.gitignore']) {
      expect(mediaKind(name)).toBe('other');
    }
  });
});

describe('isSupportedMedia', () => {
  it('пропускает медиа и режет всё прочее', () => {
    expect(isSupportedMedia('photo.png')).toBe(true);
    expect(isSupportedMedia('clip.mp4')).toBe(true);
    expect(isSupportedMedia('notes.pdf')).toBe(false);
  });
});

describe('kindLabel', () => {
  it('даёт русские подписи для чипа', () => {
    expect(kindLabel('image')).toBe('фото');
    expect(kindLabel('video')).toBe('видео');
    expect(kindLabel('other')).toBe('файл');
  });
});
