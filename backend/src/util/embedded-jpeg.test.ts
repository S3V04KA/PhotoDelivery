import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { extractEmbeddedJpeg } from './embedded-jpeg';

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#4488cc' } }).jpeg().toBuffer();
}

/** Детерминированный шум без вхождений FF D8 FF: байт растёт на 197 mod 256. */
function noise(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (index * 197 + 13) % 256;
  }
  return bytes;
}

describe('extractEmbeddedJpeg', () => {
  it('достаёт единственный встроенный кадр целиком', async () => {
    const embedded = await jpeg(40, 30);
    const file = Buffer.concat([noise(1024), embedded, noise(2048)]);

    const found = extractEmbeddedJpeg(file);

    expect(found).not.toBeNull();
    expect(found?.equals(embedded)).toBe(true);
  });

  it('выбирает самый крупный кадр, когда превью несколько', async () => {
    const small = await jpeg(16, 12);
    const large = await jpeg(120, 90);
    // Миниатюра в EXIF сидит внутри большого кадра — как в настоящих CR2.
    const file = Buffer.concat([noise(512), small, noise(256), large, noise(512)]);

    const found = extractEmbeddedJpeg(file);

    expect(found?.equals(large)).toBe(true);
  });

  it('возвращает null, когда валидного JPEG нет', () => {
    expect(extractEmbeddedJpeg(noise(4096))).toBeNull();
    expect(extractEmbeddedJpeg(Buffer.alloc(0))).toBeNull();
  });

  it('возвращает null на обрезанном JPEG без EOI и SOF', async () => {
    const embedded = await jpeg(40, 30);

    expect(extractEmbeddedJpeg(embedded.subarray(0, embedded.length - 10))).toBeNull();
    expect(extractEmbeddedJpeg(embedded.subarray(0, 4))).toBeNull();
  });
});
