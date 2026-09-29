/** Formatting helpers for the RU locale. All pure, all unit-tested. */

const NUMBER_FORMAT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const TIME_FORMAT = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});

const BYTE_UNITS: readonly string[] = ['Б', 'КБ', 'МБ', 'ГБ'];
const BYTE_STEP = 1024;
const EM_DASH = '—';

/**
 * Russian plural selection. `one` for 1, 21, 31…; `few` for 2–4, 22–24…;
 * `many` for 0, 5–20 and everything else.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(count);
  const mod100 = abs % 100;
  const mod10 = abs % 10;

  if (mod100 >= 11 && mod100 <= 14) {
    return many;
  }

  if (mod10 === 1) {
    return one;
  }

  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }

  return many;
}

/** «1 файл», «2 файла», «5 файлов». */
export function formatFileCount(count: number): string {
  return `${count} ${plural(count, 'файл', 'файла', 'файлов')}`;
}

export function formatSetCount(count: number): string {
  return `${count} ${plural(count, 'сет', 'сета', 'сетов')}`;
}

/** «1 ошибка», «2 ошибки», «5 ошибок». */
export function formatErrorCount(count: number): string {
  return `${count} ${plural(count, 'ошибка', 'ошибки', 'ошибок')}`;
}

/**
 * Human byte size in ru-RU: «0 Б», «1 КБ», «1,5 МБ», «3,4 ГБ».
 * Anything that is not a finite non-negative number renders as an em dash
 * rather than as a lie.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return EM_DASH;
  }

  let value = bytes;
  let unit = 0;

  while (value >= BYTE_STEP && unit < BYTE_UNITS.length - 1) {
    value /= BYTE_STEP;
    unit += 1;
  }

  return `${NUMBER_FORMAT.format(value)} ${BYTE_UNITS[unit]}`;
}

/** «28.09.2026, 01:10» for a valid ISO timestamp, otherwise an em dash. */
export function formatDateTime(iso: string): string {
  const timestamp = Date.parse(iso);

  if (Number.isNaN(timestamp)) {
    return EM_DASH;
  }

  return `${DATE_FORMAT.format(timestamp)}, ${TIME_FORMAT.format(timestamp)}`;
}

/** Keeps both ends of a long name readable; CSS ellipsis is the final guard. */
export function truncateMiddle(value: string, maxLength = 28): string {
  if (value.length <= maxLength) {
    return value;
  }

  const head = Math.ceil((maxLength - 1) / 2);
  const tail = maxLength - 1 - head;

  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}
