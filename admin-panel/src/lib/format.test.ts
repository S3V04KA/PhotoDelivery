import { describe, expect, it } from 'vitest';

import {
  formatBytes,
  formatDateTime,
  formatErrorCount,
  formatFileCount,
  formatSetCount,
  plural,
  truncateMiddle,
} from './format';

/** ru-RU разделяет разряды неразрывным пробелом, а не обычным. */
const NBSP = ' ';

describe('plural', () => {
  it('выбирает форму по последним цифрам числа', () => {
    // Given / When / Then
    expect(plural(1, 'файл', 'файла', 'файлов')).toBe('файл');
    expect(plural(2, 'файл', 'файла', 'файлов')).toBe('файла');
    expect(plural(4, 'файл', 'файла', 'файлов')).toBe('файла');
    expect(plural(5, 'файл', 'файла', 'файлов')).toBe('файлов');
    expect(plural(0, 'файл', 'файла', 'файлов')).toBe('файлов');
  });

  it('учитывает подростковые окончания 11–14', () => {
    expect(plural(11, 'файл', 'файла', 'файлов')).toBe('файлов');
    expect(plural(14, 'файл', 'файла', 'файлов')).toBe('файлов');
    expect(plural(21, 'файл', 'файла', 'файлов')).toBe('файл');
    expect(plural(112, 'файл', 'файла', 'файлов')).toBe('файлов');
  });

  it('игнорирует знак числа', () => {
    expect(plural(-1, 'сет', 'сета', 'сетов')).toBe('сет');
    expect(plural(-3, 'сет', 'сета', 'сетов')).toBe('сета');
  });
});

describe('formatFileCount', () => {
  it('склеивает число и согласованное слово', () => {
    expect(formatFileCount(1)).toBe('1 файл');
    expect(formatFileCount(3)).toBe('3 файла');
    expect(formatFileCount(7)).toBe('7 файлов');
    expect(formatFileCount(0)).toBe('0 файлов');
  });
});

describe('formatSetCount', () => {
  it('склеивает число и согласованное слово', () => {
    expect(formatSetCount(1)).toBe('1 сет');
    expect(formatSetCount(2)).toBe('2 сета');
    expect(formatSetCount(11)).toBe('11 сетов');
  });
});

describe('formatErrorCount', () => {
  it('склеивает число и согласованное слово', () => {
    expect(formatErrorCount(1)).toBe('1 ошибка');
    expect(formatErrorCount(2)).toBe('2 ошибки');
    expect(formatErrorCount(5)).toBe('5 ошибок');
  });
});

describe('formatBytes', () => {
  it('оставляет байты как есть', () => {
    expect(formatBytes(0)).toBe('0 Б');
    expect(formatBytes(1)).toBe('1 Б');
    expect(formatBytes(1023)).toBe(`1${NBSP}023 Б`);
  });

  it('переходит на КБ, МБ и ГБ по 1024 с одной цифрой после запятой', () => {
    expect(formatBytes(1024)).toBe('1 КБ');
    expect(formatBytes(1536)).toBe('1,5 КБ');
    expect(formatBytes(1024 * 1024)).toBe('1 МБ');
    expect(formatBytes(1024 * 1024 * 3.5)).toBe('3,5 МБ');
    expect(formatBytes(1024 ** 3)).toBe('1 ГБ');
    expect(formatBytes(1024 ** 3 * 2.25)).toBe('2,3 ГБ');
  });

  it('не выходит за пределы гигабайта и не рисует мусор для нечисловых значений', () => {
    expect(formatBytes(1024 ** 4)).toBe(`1${NBSP}024 ГБ`);
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('печатает дату и время в ru-RU по локальному времени пользователя', () => {
    // Given: локальное время, чтобы тест не зависел от TZ машины.
    const local = new Date(2026, 8, 28, 10, 0, 0);

    // Then
    expect(formatDateTime(local.toISOString())).toBe('28.09.2026, 10:00');
  });

  it('возвращает тире для неразбираемой даты', () => {
    expect(formatDateTime('')).toBe('—');
    expect(formatDateTime('не дата')).toBe('—');
  });
});

describe('truncateMiddle', () => {
  it('не трогает короткие строки', () => {
    expect(truncateMiddle('photo.jpg', 20)).toBe('photo.jpg');
  });

  it('оставляет начало и конец длинного имени', () => {
    const truncated = truncateMiddle('a'.repeat(40), 11);

    expect(truncated).toBe(`${'a'.repeat(5)}…${'a'.repeat(5)}`);
    expect(truncated).toHaveLength(11);
  });
});
