import { describe, expect, it } from 'vitest';
import {
  baseNameOf,
  extensionOf,
  FALLBACK_MIME,
  kindOf,
  mimeFor,
  objectKey,
  thumbPrefix,
  validateObjectName,
  validateSetId,
} from './media';

describe('validateSetId', () => {
  it('принимает имя с окружающими пробелами и обрезает их', () => {
    const parsed = validateSetId('  my-set  ');
    expect(parsed).toEqual({ ok: true, value: 'my-set' });
  });

  it('отклоняет пустое значение и строку из пробелов', () => {
    expect(validateSetId('')).toEqual({ ok: false, error: 'Идентификатор сета не указан' });
    expect(validateSetId('   ').ok).toBe(false);
  });

  it('отклоняет не-строку', () => {
    expect(validateSetId(undefined).ok).toBe(false);
    expect(validateSetId(42).ok).toBe(false);
  });

  it('отклоняет длину больше 128 и принимает ровно 128', () => {
    expect(validateSetId('x'.repeat(128)).ok).toBe(true);
    expect(validateSetId('x'.repeat(129)).ok).toBe(false);
  });

  it('отклоняет разделители пути и управляющие символы', () => {
    expect(validateSetId('a/b').ok).toBe(false);
    expect(validateSetId('a\\b').ok).toBe(false);
    expect(validateSetId('a\u0000b').ok).toBe(false);
    expect(validateSetId('a\nb').ok).toBe(false);
  });

  it('отклоняет служебные сегменты . и ..', () => {
    expect(validateSetId('.').ok).toBe(false);
    expect(validateSetId('..').ok).toBe(false);
  });
});

describe('validateObjectName', () => {
  it('принимает имя файла с расширением', () => {
    expect(validateObjectName('photo.jpg')).toEqual({ ok: true, value: 'photo.jpg' });
  });

  it('отклоняет пустое имя, разделители и служебные сегменты', () => {
    expect(validateObjectName('').ok).toBe(false);
    expect(validateObjectName('dir/photo.jpg').ok).toBe(false);
    expect(validateObjectName('..').ok).toBe(false);
  });
});

describe('kindOf', () => {
  it('определяет изображения из списка фронта', () => {
    for (const name of ['a.jpg', 'b.JPEG', 'c.png', 'd.gif', 'e.webp', 'f.avif', 'g.bmp', 'h.tif', 'i.tiff', 'j.heic', 'k.heif']) {
      expect(kindOf(name)).toBe('image');
    }
  });

  it('определяет видео из списка фронта', () => {
    for (const name of ['a.mp4', 'b.webm', 'c.mov', 'd.m4v', 'e.ogv', 'f.mkv', 'g.avi']) {
      expect(kindOf(name)).toBe('video');
    }
  });

  it('возвращает other для всего остального', () => {
    expect(kindOf('notes.txt')).toBe('other');
    expect(kindOf('noextension')).toBe('other');
    expect(kindOf('.gitignore')).toBe('other');
  });
});

describe('mimeFor', () => {
  it('отдаёт тип по расширению', () => {
    expect(mimeFor('photo.JPG')).toBe('image/jpeg');
    expect(mimeFor('clip.mp4')).toBe('video/mp4');
    expect(mimeFor('clip.mov')).toBe('video/quicktime');
  });

  it('откатывается на application/octet-stream для неизвестного расширения', () => {
    expect(mimeFor('notes.txt')).toBe(FALLBACK_MIME);
    expect(mimeFor('photo.bmp')).toBe('image/bmp');
  });
});

describe('разбор имён', () => {
  it('выделяет расширение в нижнем регистре и имя без него', () => {
    expect(extensionOf('Photo.JPEG')).toBe('jpeg');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('noextension')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
    expect(baseNameOf('clip.mp4')).toBe('clip');
    expect(baseNameOf('a.b.mp4')).toBe('a.b');
    expect(baseNameOf('noextension')).toBe('noextension');
  });

  it('собирает ключи объектов и превью', () => {
    expect(objectKey('set-1', 'photo.jpg')).toBe('set-1/photo.jpg');
    expect(thumbPrefix('set-1')).toBe('set-1/thumb/');
  });
});
