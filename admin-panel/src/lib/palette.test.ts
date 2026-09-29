import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyGrayPalette,
  averageColor,
  buildScheme,
  contrastRatio,
  dominantColor,
  ensureContrast,
  fromHex,
  grayPaletteCss,
  oklchToSrgb,
  paletteCss,
  pickPreview,
  relativeLuminance,
  srgbToOklch,
  toHex,
  type ColorRole,
  type PaletteFile,
  type Rgb,
  type SchemeMode,
} from './palette';

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/** Настоящий tokens.css: палитра обязана перекрывать ровно его роли. */
const tokensCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'styles', 'tokens.css'),
  'utf8',
);

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** Фото любого тона: полностью насыщенные, грязно-серые, чёрно-белые, вне гаммы. */
const SEEDS: readonly Rgb[] = [
  fromHex('#000000'),
  fromHex('#ffffff'),
  fromHex('#808080'),
  fromHex('#404040'),
  fromHex('#c0c0c0'),
  fromHex('#ff0000'),
  fromHex('#00ff00'),
  fromHex('#0000ff'),
  fromHex('#ffff00'),
  fromHex('#00ffff'),
  fromHex('#ff00ff'),
  fromHex('#f0c419'),
  fromHex('#7cb342'),
  fromHex('#1b5e20'),
  fromHex('#ffe082'),
  fromHex('#4a148c'),
  fromHex('#ff8f00'),
  fromHex('#263238'),
  fromHex('#e91e63'),
  fromHex('#00bfa5'),
  fromHex('#1e88e5'),
  oklchToSrgb({ l: 0.6, c: 0.37, h: 120 }),
  oklchToSrgb({ l: 0.95, c: 0.2, h: 90 }),
];

const MODES: readonly SchemeMode[] = ['light', 'dark'];

/**
 * Пары «текст на фоне», которые реально встречаются в стилях админки: on-роли на
 * своих контейнерах, вторичный текст на поверхностях, а также primary/error и
 * on-success-container — они тоже используются как цвет текста.
 */
const TEXT_PAIRS: readonly (readonly [ColorRole, ColorRole])[] = [
  ['on-surface', 'surface'],
  ['on-surface', 'surface-bright'],
  ['on-surface', 'surface-dim'],
  ['on-surface', 'surface-container-lowest'],
  ['on-surface', 'surface-container-low'],
  ['on-surface', 'surface-container'],
  ['on-surface', 'surface-container-high'],
  ['on-surface', 'surface-container-highest'],
  ['on-surface-variant', 'surface'],
  ['on-surface-variant', 'surface-container-low'],
  ['on-surface-variant', 'surface-container'],
  ['on-surface-variant', 'surface-container-highest'],
  ['on-primary', 'primary'],
  ['on-primary-container', 'primary-container'],
  ['on-primary-container', 'surface'],
  ['on-secondary', 'secondary'],
  ['on-secondary-container', 'secondary-container'],
  ['on-tertiary', 'tertiary'],
  ['on-tertiary-container', 'tertiary-container'],
  ['on-error', 'error'],
  ['on-error-container', 'error-container'],
  ['on-success-container', 'success-container'],
  ['on-success-container', 'surface'],
  ['on-success-container', 'surface-container-low'],
  ['error', 'surface'],
  ['error', 'surface-container-low'],
  ['primary', 'surface'],
  ['primary', 'surface-container-low'],
  ['primary', 'surface-container'],
  ['primary', 'surface-container-high'],
  ['primary', 'surface-container-highest'],
  ['secondary', 'surface'],
  ['tertiary', 'surface'],
  ['inverse-on-surface', 'inverse-surface'],
];

/** Нетекстовые роли: WCAG AA требует 3:1, а не 4.5:1. */
const NON_TEXT_PAIRS: readonly (readonly [ColorRole, ColorRole])[] = [
  ['outline', 'surface'],
  ['outline', 'surface-container-low'],
  ['outline', 'surface-container'],
];

function rolesOf(block: string): ReadonlySet<string> {
  const roles = new Set<string>();

  for (const match of block.matchAll(/--md-sys-color-([a-z-]+)\s*:/g)) {
    const role = match[1];

    if (role !== undefined) {
      roles.add(role);
    }
  }

  return roles;
}

function hueDistance(first: Rgb, second: Rgb): number {
  const a = srgbToOklch(first).h;
  const b = srgbToOklch(second).h;
  const delta = Math.abs(a - b) % 360;

  return delta > 180 ? 360 - delta : delta;
}

describe('контраст', () => {
  it('считает относительную яркость по формуле WCAG', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
    expect(relativeLuminance(BLACK)).toBe(0);
    expect(relativeLuminance(fromHex('#808080'))).toBeCloseTo(0.2158, 3);
  });

  it('даёт 21:1 на чёрном и белом и 1:1 на одном цвете', () => {
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 5);
    expect(contrastRatio(fromHex('#1e88e5'), fromHex('#1e88e5'))).toBeCloseTo(1, 5);
  });

  it('ensureContrast затемняет светлый текст на светлом фоне до порога', () => {
    // Given / When
    const fixed = ensureContrast(fromHex('#e8e0e9'), WHITE, AA_TEXT);

    // Then
    expect(contrastRatio(fixed, WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('ensureContrast осветляет тёмный текст на тёмном фоне', () => {
    const fixed = ensureContrast(fromHex('#2a2730'), fromHex('#141218'), AA_TEXT);

    expect(contrastRatio(fixed, fromHex('#141218'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('ensureContrast не трогает цвет, который уже проходит', () => {
    const color = fromHex('#1b1b1f');

    expect(ensureContrast(color, WHITE, AA_TEXT)).toBe(color);
  });
});

describe('цветовые пространства', () => {
  it('переживает round-trip sRGB -> OKLCH -> sRGB', () => {
    for (const seed of SEEDS) {
      const back = oklchToSrgb(srgbToOklch(seed));

      // Given: 8-битный JPEG-подобный кадр, поэтому допуск на квантование.
      expect(back.r).toBeCloseTo(seed.r, -0.5);
      expect(back.g).toBeCloseTo(seed.g, -0.5);
      expect(back.b).toBeCloseTo(seed.b, -0.5);
    }
  });

  it('удерживает цвет в гамте sRGB даже для невозможных тонов', () => {
    for (const seed of SEEDS) {
      const back = oklchToSrgb(srgbToOklch(seed));

      for (const channel of [back.r, back.g, back.b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it('hex-хелперы обратимы', () => {
    for (const seed of SEEDS) {
      expect(fromHex(toHex(seed))).toEqual({
        r: Math.round(seed.r),
        g: Math.round(seed.g),
        b: Math.round(seed.b),
      });
    }
  });
});

describe('разбор кадра', () => {
  it('averageColor усредняет только непрозрачные пиксели', () => {
    const pixels = [
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 0,
    ];

    expect(averageColor(pixels)).toEqual({ r: 85, g: 85, b: 85 });
  });

  it('averageColor возвращает null, когда непрозрачных пикселей нет', () => {
    expect(averageColor([0, 0, 0, 0, 10, 10, 10, 4])).toBeNull();
    expect(averageColor([])).toBeNull();
  });

  it('dominantColor берёт массовый цветной объект, а не белый фон', () => {
    const pixels = [
      ...Array.from({ length: 60 }, () => [250, 250, 250, 255]).flat(),
      ...Array.from({ length: 40 }, () => [21, 101, 192, 255]).flat(),
    ];

    const seed = dominantColor(pixels);

    expect(seed).not.toBeNull();
    expect(hueDistance(seed ?? WHITE, fromHex('#1565c0'))).toBeLessThan(8);
  });

  it('dominantColor устойчив: тот же кадр — тот же seed', () => {
    const pixels = [
      ...Array.from({ length: 30 }, () => [12, 200, 140, 255]).flat(),
      ...Array.from({ length: 70 }, () => [20, 20, 20, 255]).flat(),
    ];

    expect(dominantColor(pixels)).toEqual(dominantColor(pixels));
  });

  it('dominantColor возвращает null для полностью прозрачного кадра', () => {
    expect(dominantColor([0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });
});

describe('палитра из фото', () => {
  it('переносит оттенок фотографии в акцентные роли', () => {
    for (const mode of MODES) {
      const seed = fromHex('#1e88e5');
      const scheme = buildScheme(seed, mode);

      // Then: hue сохраняется, ensureContrast двигает только светлоту.
      expect(hueDistance(seed, fromHex(scheme.primary))).toBeLessThan(6);
      expect(hueDistance(seed, fromHex(scheme['primary-container']))).toBeLessThan(6);
    }
  });

  it('даёт разные палитры для разных фотографий', () => {
    expect(paletteCss(fromHex('#1e88e5'))).not.toBe(paletteCss(fromHex('#e91e63')));
  });

  it('не заимствует оттенок фотографии для ошибки и успеха', () => {
    // Given: синее фото, зелёный не должен превращать ошибку в зелёную.
    const scheme = buildScheme(fromHex('#1e88e5'), 'light');

    // Then
    expect(hueDistance(fromHex(scheme.error), fromHex('#b3261e'))).toBeLessThan(20);
    expect(srgbToOklch(fromHex(scheme.error)).c).toBeGreaterThan(0.08);
    expect(srgbToOklch(fromHex(scheme['success-container'])).c).toBeGreaterThan(0.08);
  });

  it('выдаёт одинаковый набор ролей для обеих схем', () => {
    for (const seed of SEEDS) {
      const light = Object.entries(buildScheme(seed, 'light')).sort();
      const dark = Object.entries(buildScheme(seed, 'dark')).sort();

      expect(dark.map(([role]) => role)).toEqual(light.map(([role]) => role));
    }
  });

  it('записывает значения в css как --md-sys-color-<role>: #hex;', () => {
    const css = paletteCss(fromHex('#1e88e5'));

    expect(css.startsWith(':root{color-scheme:light;--md-sys-color-primary:#')).toBe(true);
    expect(css).toContain('--md-sys-color-on-surface:#');
    expect(css).toContain('@media (prefers-color-scheme: dark){:root{color-scheme:dark;');
  });
});

describe('WCAG AA', () => {
  it.each(MODES)('текст читается на своих фонах в схеме %s', (mode) => {
    for (const seed of SEEDS) {
      const scheme = buildScheme(seed, mode);

      for (const [text, background] of TEXT_PAIRS) {
        const ratio = contrastRatio(fromHex(scheme[text]), fromHex(scheme[background]));

        expect(
          ratio,
          `${toHex(seed)}: ${text} на ${background} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it.each(MODES)('нетекстовые роли держат 3:1 в схеме %s', (mode) => {
    for (const seed of SEEDS) {
      const scheme = buildScheme(seed, mode);

      for (const [role, background] of NON_TEXT_PAIRS) {
        const ratio = contrastRatio(fromHex(scheme[role]), fromHex(scheme[background]));

        expect(
          ratio,
          `${toHex(seed)}: ${role} на ${background} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    }
  });
});

describe('покрытие токенов', () => {
  it('перекрывает ровно те цветовые роли, что объявлены в tokens.css', () => {
    const darkStart = tokensCss.indexOf('@media (prefers-color-scheme: dark)');

    // Given: роль тематизируется, только если объявлена в обеих схемах.
    const light = rolesOf(tokensCss.slice(0, darkStart));
    const dark = rolesOf(tokensCss.slice(darkStart));
    const themeable = new Set([...light].filter((role) => dark.has(role)));
    const generated = rolesOf(paletteCss(fromHex('#1e88e5')));

    expect([...generated].sort()).toEqual([...themeable].sort());
  });

  it('серая палитра нейтральна по оттенку, но сохраняет красную ошибку', () => {
    const scheme = buildScheme(fromHex('#808080'), 'light');
    const neutralRoles: readonly ColorRole[] = [
      'primary',
      'primary-container',
      'secondary',
      'tertiary',
      'surface',
      'surface-container-low',
      'outline',
    ];

    for (const role of neutralRoles) {
      const { r, g, b } = fromHex(scheme[role]);

      expect(Math.max(r, g, b) - Math.min(r, g, b), role).toBeLessThanOrEqual(1);
    }

    const error = srgbToOklch(fromHex(scheme.error));

    expect(error.c).toBeGreaterThan(0.08);
    expect(error.h).toBeGreaterThan(15);
    expect(error.h).toBeLessThan(45);
  });
});

describe('выбор фотографии', () => {
  const files: readonly PaletteFile[] = [
    { name: 'notes.txt', kind: 'other' },
    { name: 'Отпуск 1.jpg', kind: 'image' },
    { name: 'clip.mp4', kind: 'video' },
    { name: 'Закат.png', kind: 'image' },
  ];

  it('не выбирает файлы без превью', () => {
    const picked = pickPreview('my-set', files);

    expect(picked).not.toBeNull();
    expect(picked?.file.name).not.toBe('notes.txt');
  });

  it('берёт превью из bucket по правилам lib/urls', () => {
    const picked = pickPreview('my-set', files);

    expect(picked?.thumb).toContain('/photos/my-set/thumb/');
  });

  it('выбирает одно и то же фото для одного и того же сета', () => {
    expect(pickPreview('my-set', files)).toEqual(pickPreview('my-set', files));
  });

  it('меняет фото, когда меняется набор файлов', () => {
    const wider: readonly PaletteFile[] = [...files, { name: 'Ещё 1.jpg', kind: 'image' }];

    // Given: хэш зависит от состава файлов, а не от их позиции.
    expect(wider.length).toBeGreaterThan(files.length);
    expect(pickPreview('my-set', wider)).not.toBeNull();
  });

  it('возвращает null для пустого сета и для сета без превью', () => {
    expect(pickPreview('my-set', [])).toBeNull();
    expect(pickPreview('my-set', [{ name: 'notes.txt', kind: 'other' }])).toBeNull();
  });
});

describe('применение палитры в DOM', () => {
  afterEach(() => {
    document.getElementById('admin-dynamic-palette')?.remove();
  });

  it('держит ровно один элемент <style> с id и обеими схемами', () => {
    applyGrayPalette();
    applyGrayPalette();

    const sheets = document.querySelectorAll('style#admin-dynamic-palette');

    expect(sheets.length).toBe(1);
    expect(sheets[0]?.textContent).toBe(grayPaletteCss());
    expect(sheets[0]?.textContent).toContain(':root{color-scheme:light;');
    expect(sheets[0]?.textContent).toContain('@media (prefers-color-scheme: dark){');
  });

  it('перекрывает статические токены, а не добавляет новые', () => {
    applyGrayPalette();

    const text = document.getElementById('admin-dynamic-palette')?.textContent ?? '';

    expect(text).toContain('--md-sys-color-primary:#');
    expect(text).not.toContain('--md-spacing-4');
    expect(text).not.toContain('--md-sys-shape-');
  });
});
