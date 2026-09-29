import type { MediaItem } from '../lib/types';

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

/** «12 фото», «1 видео», «7 элементов» for mixed sets. */
export function formatMediaCount(items: readonly MediaItem[]): string {
  const total = items.length;
  const videos = items.reduce((sum, item) => sum + (item.kind === 'video' ? 1 : 0), 0);

  if (videos === 0) {
    return `${total} ${plural(total, 'фото', 'фото', 'фото')}`;
  }

  if (videos === total) {
    return `${total} ${plural(total, 'видео', 'видео', 'видео')}`;
  }

  return `${total} ${plural(total, 'элемент', 'элемента', 'элементов')}`;
}

/** Keeps both ends of a long set id readable; CSS ellipsis is the final guard. */
export function truncateMiddle(value: string, maxLength = 26): string {
  if (value.length <= maxLength) {
    return value;
  }

  const head = Math.ceil((maxLength - 1) / 2);
  const tail = maxLength - 1 - head;

  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}
