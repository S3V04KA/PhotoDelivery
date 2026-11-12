/*
 * Извлечение JPEG-превью, встроенного в камерный RAW (CR2, NEF, ARW…).
 *
 * RAW-файл — это TIFF-контейнер: помимо сенсорных данных в нём лежат одно или
 * несколько готовых JPEG-превью, и для CR2 большое превью имеет полное
 * разрешение кадра. sharp RAW не декодирует, поэтому превью и «полное
 * разрешение JPEG» берутся оттуда: структура JPEG разбирается по маркерам,
 * из всех валидных кадров выбирается самый крупный по пикселям.
 *
 * Разбор идёт по сегментам (длина известна), а не по байтам, поэтому даже
 * случайные вхождения FF D8 FF в сенсорных данных отсеиваются почти сразу:
 * они не складываются в валидную структуру с SOF и EOI.
 */

interface JpegScan {
  /** Позиция байта сразу за EOI — конец кадра в буфере. */
  readonly end: number;
  readonly width: number;
  readonly height: number;
}

const SOI_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const EOI = 0xd9;
const SOS = 0xda;
/** Реальных JPEG в файле единицы; ограничение защищает от патологичных входов. */
const MAX_CANDIDATES = 2048;

/** SOF-маркеры: C4 (DHT), C8 (JPG) и CC (DAC) — не кадры изображения. */
function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** Одиночные маркеры без полезной нагрузки: TEM, RST0–RST7 и stuff0x00. */
function isStandalone(marker: number): boolean {
  return marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

/**
 * Идёт по маркерам JPEG начиная с SOI в `start`. Возвращает размер и конец
 * кадра либо null, если структура рвётся (обрезанный или чужой файл).
 */
function scanJpeg(bytes: Buffer, start: number): JpegScan | null {
  let position = start + 2;
  let width = 0;
  let height = 0;

  for (;;) {
    if (position + 1 >= bytes.length || bytes[position] !== 0xff) return null;
    // Заливка 0xFF 0xFF …: последний 0xFF — начало маркера.
    while (position + 1 < bytes.length && bytes[position + 1] === 0xff) position += 1;
    if (position + 1 >= bytes.length) return null;

    const marker = bytes[position + 1] ?? -1;

    if (isStandalone(marker)) {
      position += 2;
      continue;
    }

    if (marker === EOI) {
      return width > 0 && height > 0 ? { end: position + 2, width, height } : null;
    }

    if (position + 4 > bytes.length) return null;
    const length = bytes.readUInt16BE(position + 2);
    if (length < 2 || position + 2 + length > bytes.length) return null;

    if (isSof(marker)) {
      // Полезная нагрузка SOF: точность (1), высота (2), ширина (2) …
      if (length < 7) return null;
      height = bytes.readUInt16BE(position + 5);
      width = bytes.readUInt16BE(position + 7);
    }

    position += 2 + length;
    if (marker !== SOS) continue;

    // После SOS идёт данные с кодированием: ищем следующий настоящий маркер.
    let cursor = position;
    for (;;) {
      if (cursor >= bytes.length) return null;
      if (bytes[cursor] !== 0xff) {
        cursor += 1;
        continue;
      }
      const next = cursor + 1 < bytes.length ? (bytes[cursor + 1] ?? -1) : -1;
      if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
        cursor += 2;
        continue;
      }
      break;
    }
    position = cursor;
  }
}

/**
 * Самое крупное валидное JPEG-превью внутри файла, либо null. Самое большое по
 * пикселям — а не по байтам: вложенные JPEG (миниатюра в EXIF) всегда меньше
 * основного кадра.
 */
export function extractEmbeddedJpeg(bytes: Buffer): Buffer | null {
  let bestStart = -1;
  let bestEnd = -1;
  let bestArea = 0;
  let from = 0;

  for (let candidates = 0; candidates < MAX_CANDIDATES; candidates += 1) {
    const start = bytes.indexOf(SOI_MAGIC, from);
    if (start === -1) break;

    const scan = scanJpeg(bytes, start);
    if (scan !== null) {
      const area = scan.width * scan.height;
      if (area > bestArea) {
        bestArea = area;
        bestStart = start;
        bestEnd = scan.end;
      }
    }

    from = start + SOI_MAGIC.length;
  }

  return bestStart === -1 ? null : bytes.subarray(bestStart, bestEnd);
}
