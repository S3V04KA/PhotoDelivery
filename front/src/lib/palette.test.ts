import { describe, expect, it } from 'vitest';

import {
  MIN_TEXT_CONTRAST,
  TOKEN_ORDER,
  applyGrayPalette,
  applyPalette,
  buildPalette,
  buildPaletteFromRgb,
  contrastRatio,
  ensureContrast,
  extractSeed,
  grayPalette,
  hexToRgb,
  huesFromSeed,
  lchToRgb,
  relativeLuminance,
  renderPaletteCss,
  rgbToHex,
  rgbToLch,
  type GeneratedPalette,
  type PaletteToken,
  type Rgb,
} from './palette';

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

function hex(value: string): Rgb {
  const parsed = hexToRgb(value);

  if (parsed === null) {
    throw new Error(`эталонный цвет разобран как пустое значение: ${value}`);
  }

  return parsed;
}

/** `on-x` is only meaningful as the foreground of `x`; the pairs are the contract. */
const ON_PAIRS: readonly (readonly [PaletteToken, PaletteToken])[] = [
  ['on-primary', 'primary'],
  ['on-primary-container', 'primary-container'],
  ['on-secondary', 'secondary'],
  ['on-secondary-container', 'secondary-container'],
  ['on-tertiary', 'tertiary'],
  ['on-tertiary-container', 'tertiary-container'],
  ['on-surface', 'surface'],
  ['on-surface-variant', 'surface-variant'],
  ['inverse-on-surface', 'inverse-surface'],
];

/** Photos a viewer will actually meet: every hue, plus the awkward extremes. */
const SEED_COLORS: readonly (readonly [number, number, number])[] = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
  [255, 140, 0],
  [20, 90, 160],
  [128, 64, 32],
  [128, 128, 128],
  [250, 250, 250],
  [18, 18, 18],
  [0, 0, 0],
  [255, 255, 255],
];

function rgba(pixels: readonly (readonly [number, number, number])[], alpha = 255): Uint8ClampedArray {
  const buffer = new Uint8ClampedArray(pixels.length * 4);

  pixels.forEach(([r, g, b], index) => {
    buffer[index * 4] = r;
    buffer[index * 4 + 1] = g;
    buffer[index * 4 + 2] = b;
    buffer[index * 4 + 3] = alpha;
  });

  return buffer;
}

function repeat(pixel: readonly [number, number, number], count: number): (readonly [number, number, number])[] {
  return Array.from({ length: count }, () => pixel);
}

function hueOf(color: Rgb): number {
  return rgbToLch(color.r, color.g, color.b).h;
}

function hueDistance(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

function expectAaOnPairs(palette: GeneratedPalette): void {
  (['light', 'dark'] as const).forEach((scheme) => {
    ON_PAIRS.forEach(([foreground, background]) => {
      const ratio = contrastRatio(palette[scheme][foreground], palette[scheme][background]);
      expect(
        ratio,
        `${scheme} ${foreground} на ${background}: ${rgbToHex(palette[scheme][background])}`,
      ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    });
  });
}

function expectEveryTokenIsHex(palette: GeneratedPalette): void {
  (['light', 'dark'] as const).forEach((scheme) => {
    expect(Object.keys(palette[scheme]).sort()).toEqual([...TOKEN_ORDER].sort());

    TOKEN_ORDER.forEach((token) => {
      const value = palette[scheme][token];
      expect(rgbToHex(value), `${scheme} ${token}`).toMatch(/^#[\da-f]{6}$/);
      expect(hexToRgb(rgbToHex(value)), `${scheme} ${token}`).toEqual(value);
    });
  });
}

describe('контракт токенов', () => {
  it('объявляет все 28 цветовых ролей приложения', () => {
    expect(TOKEN_ORDER).toHaveLength(28);
  });

  it('содержит каждую on-* роль ровно один раз и все они в проверяемых парах', () => {
    const foregrounds = ON_PAIRS.map(([foreground]) => foreground);

    ON_PAIRS.forEach(([foreground, background]) => {
      expect(TOKEN_ORDER).toContain(foreground);
      expect(TOKEN_ORDER).toContain(background);
    });

    expect(TOKEN_ORDER.filter((token) => token.startsWith('on-')).sort()).toEqual(
      foregrounds.filter((token) => token.startsWith('on-')).sort(),
    );
    expect(foregrounds).toContain('inverse-on-surface');
  });

  it('не трогает закреплённые роли: ошибки и медиахолст остаются статичными', () => {
    const themed = TOKEN_ORDER.map((token) => `--md-sys-color-${token}`);

    expect(themed).not.toContain('--md-sys-color-error');
    expect(themed).not.toContain('--md-sys-color-scrim');
    expect(themed).not.toContain('--md-canvas-on-surface');
  });
});

describe('contrastRatio', () => {
  it('даёт 21:1 на чёрном и белом — верхняя граница шкалы', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
  });

  it('даёт 1:1 на одном и том же цвете — нижняя граница', () => {
    expect(contrastRatio(hex('#6750a4'), hex('#6750a4'))).toBeCloseTo(1, 5);
  });

  it('симметричен: фон и текст меняются местами без разницы', () => {
    expect(contrastRatio(hex('#49454f'), hex('#e7e0ec'))).toBeCloseTo(
      contrastRatio(hex('#e7e0ec'), hex('#49454f')),
      10,
    );
  });

  it('воспроизводит канонические значения WCAG для серого текста', () => {
    expect(contrastRatio(hex('#767676'), WHITE)).toBeCloseTo(4.54, 2);
    expect(contrastRatio(hex('#949494'), WHITE)).toBeCloseTo(3.03, 2);
  });
});

describe('ensureContrast', () => {
  it('не трогает цвет, который уже проходит AA', () => {
    const color = hex('#1d1b20');
    const background = hex('#fef7ff');

    expect(ensureContrast(color, background)).toEqual(color);
  });

  it('поднимает светлый текст до AA на светлом фоне', () => {
    const background = hex('#f3edf7');
    const start = hex('#d0c8dd');
    const fixed = ensureContrast(start, background);

    expect(contrastRatio(fixed, background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(relativeLuminance(fixed)).toBeLessThan(relativeLuminance(start));
  });

  it('опускает тёмный текст до AA на тёмном фоне', () => {
    const background = hex('#211f26');
    const start = hex('#3a3542');
    const fixed = ensureContrast(start, background);

    expect(contrastRatio(fixed, background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(relativeLuminance(fixed)).toBeGreaterThan(relativeLuminance(start));
  });

  it('находит AA даже там, где одна сторона шкалы недостижима', () => {
    const background = lchToRgb({ l: 49, c: 0, h: 0 });

    expect(contrastRatio(BLACK, background)).toBeLessThan(MIN_TEXT_CONTRAST);

    const fixed = ensureContrast(hex('#3a3542'), background);
    expect(contrastRatio(fixed, background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(relativeLuminance(fixed)).toBeGreaterThan(0.5);
  });

  it('гарантирует AA на любом фоне, даже на паре «светлое на светлом»', () => {
    for (let tone = 0; tone <= 100; tone += 1) {
      const background = lchToRgb({ l: tone, c: 0, h: 0 });

      for (let step = 0; step <= 100; step += 5) {
        const foreground = lchToRgb({ l: step, c: 12, h: 210 });
        const fixed = ensureContrast(foreground, background);

        expect(contrastRatio(fixed, background), `фон ${tone}, текст ${step}`).toBeGreaterThanOrEqual(
          MIN_TEXT_CONTRAST,
        );
      }
    }
  });
});

describe('rgbToLch', () => {
  it('ставит белый и чёрный на концы шкалы тона', () => {
    expect(rgbToLch(255, 255, 255).l).toBeCloseTo(100, 2);
    expect(rgbToLch(0, 0, 0).l).toBeCloseTo(0, 5);
  });

  it('находит эталонные оттенки первичных цветов в Lab', () => {
    expect(rgbToLch(255, 0, 0).h).toBeCloseTo(40, 0);
    expect(rgbToLch(0, 255, 0).h).toBeCloseTo(136, 0);
    expect(rgbToLch(0, 0, 255).h).toBeCloseTo(306.3, 0);
  });

  it('считает серый ахроматическим: нулевой хрома и никакого оттенка', () => {
    const gray = rgbToLch(128, 128, 128);

    expect(gray.c).toBeLessThan(0.001);
    expect(gray.h).toBe(0);
  });

  it('переживает круговой переход Lab → sRGB → Lab без потери тона', () => {
    [hex('#6750a4'), hex('#b3261e'), hex('#49a08f'), hex('#1d1b20')].forEach((color) => {
      const roundTrip = lchToRgb(rgbToLch(color.r, color.g, color.b));

      expect(roundTrip.r).toBeCloseTo(color.r, 0);
      expect(roundTrip.g).toBeCloseTo(color.g, 0);
      expect(roundTrip.b).toBeCloseTo(color.b, 0);
    });
  });
});

describe('lchToRgb', () => {
  it('понижает хрому, а не тон, когда цвет не помещается в sRGB', () => {
    const impossible = lchToRgb({ l: 50, c: 400, h: 40 });

    expect(relativeLuminance(impossible)).toBeLessThanOrEqual(1);
    expect(rgbToLch(impossible.r, impossible.g, impossible.b).l).toBeCloseTo(50, 0);
    expect(rgbToLch(impossible.r, impossible.g, impossible.b).h).toBeCloseTo(40, 1);
  });

  it('на нулевой хроме даёт ровно нейтральный серый', () => {
    const neutral = lchToRgb({ l: 42, c: 0, h: 137 });

    expect(neutral.r).toBe(neutral.g);
    expect(neutral.g).toBe(neutral.b);
  });

  it('монотонен по тону: светлее тон — светлее цвет', () => {
    for (let tone = 2; tone < 100; tone += 2) {
      const current = lchToRgb({ l: tone, c: 0, h: 0 });
      const next = lchToRgb({ l: tone + 2, c: 0, h: 0 });

      expect(relativeLuminance(current)).toBeLessThan(relativeLuminance(next));
    }
  });
});

describe('hexToRgb', () => {
  it('разбирает решётку, без неё и с мусором', () => {
    expect(hexToRgb('#6750A4')).toEqual({ r: 0x67, g: 0x50, b: 0xa4 });
    expect(hexToRgb('6750a4')).toEqual({ r: 0x67, g: 0x50, b: 0xa4 });
    expect(hexToRgb('#fff')).toBeNull();
    expect(hexToRgb('решифровка')).toBeNull();
  });
});

describe('extractSeed', () => {
  it('не выдумывает цвет у полностью прозрачного буфера', () => {
    expect(extractSeed(new Uint8ClampedArray(16))).toBeNull();
    expect(extractSeed(rgba(repeat([10, 200, 30], 4), 0))).toBeNull();
  });

  it('возвращает нулевую хрому для серого кадра', () => {
    const seed = extractSeed(rgba(repeat([128, 128, 128], 16)));

    expect(seed).not.toBeNull();
    expect(seed?.chroma ?? 0).toBeLessThan(1);
  });

  it('считает кадр из белого и чёрного ахроматическим', () => {
    const seed = extractSeed(rgba([...repeat([255, 255, 255], 8), ...repeat([0, 0, 0], 8)]));

    expect(seed?.chroma ?? 0).toBeLessThan(1);
  });

  it('находит оттенок насыщенного кадра', () => {
    const seed = extractSeed(rgba(repeat([255, 0, 0], 16)));

    expect(seed).not.toBeNull();
    expect(hueDistance(seed?.hue ?? 0, 40)).toBeLessThan(1);
    expect(seed?.chroma ?? 0).toBeGreaterThan(90);
  });

  it('не даёт серому фону заглушить цветной объект', () => {
    // 40 серых пикселей против 4 красных: среднее арифметическое ушло бы в серый.
    const seed = extractSeed(rgba([...repeat([128, 128, 128], 40), ...repeat([255, 0, 0], 4)]));

    expect(seed).not.toBeNull();
    expect(hueDistance(seed?.hue ?? 0, 40)).toBeLessThan(20);
    expect(seed?.chroma ?? 0).toBeGreaterThan(40);
  });
});

describe('huesFromSeed', () => {
  it('превращает серый кадр в полностью нейтральные палитры', () => {
    const hues = huesFromSeed({ hue: 210, chroma: 2 });

    expect(hues.primary.chroma).toBe(0);
    expect(hues.secondary.chroma).toBe(0);
    expect(hues.tertiary.chroma).toBe(0);
    expect(hues.neutral.chroma).toBe(0);
  });

  it('поднимает бледный оттенок до заметной хромы, но не выше потолка', () => {
    expect(huesFromSeed({ hue: 30, chroma: 8 }).primary.chroma).toBeGreaterThanOrEqual(36);
    expect(huesFromSeed({ hue: 30, chroma: 200 }).primary.chroma).toBeLessThanOrEqual(96);
  });

  it('разводит третичный оттенок на 60° и убирает из него хрому', () => {
    const hues = huesFromSeed({ hue: 30, chroma: 60 });

    expect(hues.tertiary.hue).toBe(90);
    expect(hues.tertiary.chroma).toBeLessThan(hues.primary.chroma);
    expect(hues.secondary.chroma).toBeLessThan(hues.tertiary.chroma);
  });
});

describe('buildPaletteFromRgb', () => {
  it.each(SEED_COLORS)('даёт AA во всех on-* парах для %i,%i,%i', (r, g, b) => {
    expectAaOnPairs(buildPaletteFromRgb(r, g, b));
  });

  it.each(SEED_COLORS)('выдаёт валидные цвета во всех токенах для %i,%i,%i', (r, g, b) => {
    expectEveryTokenIsHex(buildPaletteFromRgb(r, g, b));
  });

  it('разводит схемы по полярности: светлая поверхность светлая, тёмная тёмная', () => {
    SEED_COLORS.forEach(([r, g, b]) => {
      const palette = buildPaletteFromRgb(r, g, b);

      expect(relativeLuminance(palette.light.surface), `${r},${g},${b} light`).toBeGreaterThan(0.8);
      expect(relativeLuminance(palette.dark.surface), `${r},${g},${b} dark`).toBeLessThan(0.05);
      expect(relativeLuminance(palette.light['on-surface'])).toBeLessThan(0.1);
      expect(relativeLuminance(palette.dark['on-surface'])).toBeGreaterThan(0.6);
    });
  });

  it('держит лестницу контейнеров монотонной, причём тёмная идёт вверх', () => {
    const palette = buildPaletteFromRgb(20, 90, 160);
    const ramp: readonly PaletteToken[] = [
      'surface-container-lowest',
      'surface-container-low',
      'surface-container',
      'surface-container-high',
      'surface-container-highest',
    ];

    (['light', 'dark'] as const).forEach((scheme) => {
      for (let index = 1; index < ramp.length; index += 1) {
        const earlier = palette[scheme][ramp[index - 1] as PaletteToken];
        const later = palette[scheme][ramp[index] as PaletteToken];
        const label = `${scheme}: ${ramp[index - 1]} против ${ramp[index]}`;

        if (scheme === 'light') {
          expect(relativeLuminance(earlier), label).toBeGreaterThan(relativeLuminance(later));
        } else {
          expect(relativeLuminance(earlier), label).toBeLessThan(relativeLuminance(later));
        }
      }
    });
  });

  it('наследует оттенок фотографии в primary, secondary и tertiary', () => {
    const palette = buildPaletteFromRgb(255, 0, 0);

    expect(hueDistance(hueOf(palette.light.primary), 40)).toBeLessThan(5);
    expect(hueDistance(hueOf(palette.light.secondary), 40)).toBeLessThan(5);
    expect(hueDistance(hueOf(palette.light.tertiary), 100)).toBeLessThan(5);
  });

  it('строит аккорд по хромам: primary насыщеннее tertiary, тот — secondary', () => {
    const palette = buildPaletteFromRgb(255, 0, 0);
    const chroma = (token: PaletteToken): number => {
      const color = palette.light[token];
      return rgbToLch(color.r, color.g, color.b).c;
    };

    expect(chroma('primary')).toBeGreaterThan(chroma('tertiary'));
    expect(chroma('tertiary')).toBeGreaterThan(chroma('secondary'));
    expect(chroma('secondary')).toBeGreaterThan(chroma('surface'));
  });

  it('оставляет поверхности почти нейтральными: цвет виден, но не кричит', () => {
    const palette = buildPaletteFromRgb(255, 0, 0);
    const surfaceChroma = rgbToLch(
      palette.light.surface.r,
      palette.light.surface.g,
      palette.light.surface.b,
    ).c;

    expect(surfaceChroma).toBeLessThan(15);
  });

  it('трактует серое фото как серую палитру', () => {
    const palette = buildPaletteFromRgb(140, 140, 140);

    TOKEN_ORDER.forEach((token) => {
      const color = palette.light[token];
      expect(color.r, `light ${token}`).toBe(color.g);
      expect(color.g, `light ${token}`).toBe(color.b);
    });
  });
});

describe('grayPalette', () => {
  it('это buildPalette с нулевой хромой — тот же код, другой оттенок', () => {
    expect(grayPalette()).toEqual(buildPalette({ hue: 0, chroma: 0 }));
  });

  it('строго нейтрален в обеих схемах', () => {
    const palette = grayPalette();

    (['light', 'dark'] as const).forEach((scheme) => {
      TOKEN_ORDER.forEach((token) => {
        const color = palette[scheme][token];
        expect(color.r, `${scheme} ${token}`).toBe(color.g);
        expect(color.g, `${scheme} ${token}`).toBe(color.b);
      });
    });
  });

  it('проходит AA во всех on-* парах', () => {
    expectAaOnPairs(grayPalette());
  });

  it('остаётся Material-схемой: светлая поверхность светлая, тёмная тёмная', () => {
    const palette = grayPalette();

    expect(relativeLuminance(palette.light.surface)).toBeGreaterThan(0.8);
    expect(relativeLuminance(palette.dark.surface)).toBeLessThan(0.05);
  });
});

describe('renderPaletteCss', () => {
  const css = renderPaletteCss(buildPaletteFromRgb(20, 90, 160));

  it('объявляет обе схемы в одном листе', () => {
    expect(css.match(/:root \{/g)).toHaveLength(2);
    expect(css).toContain('@media (prefers-color-scheme: dark) {');
  });

  it('ставит тёмную схему после светлой — порядок источников и есть механизм переопределения', () => {
    expect(css.indexOf('@media (prefers-color-scheme: dark)')).toBeGreaterThan(
      css.indexOf(':root {'),
    );
  });

  it('переопределяет ровно те переменные, которые объявляет tokens.css', () => {
    expect(css).toContain('  --md-sys-color-primary:');
    expect(css).toContain('    --md-sys-color-primary:');
    expect(css).not.toContain('--md-canvas-');
    expect(css).not.toContain('--md-sys-color-error');
  });

  it('объявляет каждый токен в обеих схемах', () => {
    TOKEN_ORDER.forEach((token) => {
      expect(css.match(new RegExp(`--md-sys-color-${token}:`, 'g'))).toHaveLength(2);
    });
  });

  it('не оставляет одинаковых primary у светлой и тёмной схемы', () => {
    const marker = '@media (prefers-color-scheme: dark)';
    const [light = '', dark = ''] = css.split(marker);
    const readPrimary = (block: string): string | undefined =>
      /--md-sys-color-primary: (#[\da-f]{6});/.exec(block)?.[1];

    expect(readPrimary(light)).toBeDefined();
    expect(readPrimary(dark)).toBeDefined();
    expect(readPrimary(light)).not.toBe(readPrimary(dark));
  });
});

describe('applyGrayPalette', () => {
  it('создаёт один стиль и переиспользует его при повторном вызове', () => {
    document.getElementById('dynamic-palette')?.remove();

    applyGrayPalette();
    const first = document.querySelector('style#dynamic-palette');

    expect(first).not.toBeNull();
    expect(first?.textContent).toBe(renderPaletteCss(grayPalette()));

    applyGrayPalette();

    expect(document.querySelectorAll('style#dynamic-palette')).toHaveLength(1);
    expect(document.querySelector('style#dynamic-palette')).toBe(first);
  });

  it('переписывает содержимое того же элемента под новую палитру', () => {
    document.getElementById('dynamic-palette')?.remove();
    applyGrayPalette();

    const element = document.querySelector('style#dynamic-palette');
    const photo = buildPaletteFromRgb(255, 0, 0);
    applyPalette(photo);

    expect(document.querySelectorAll('style#dynamic-palette')).toHaveLength(1);
    expect(element?.textContent).toBe(renderPaletteCss(photo));
  });

  it('пересоздаёт стиль, если его вынесли из head', () => {
    document.getElementById('dynamic-palette')?.remove();
    applyGrayPalette();

    const element = document.querySelector('style#dynamic-palette');
    element?.remove();
    applyGrayPalette();

    expect(document.querySelectorAll('style#dynamic-palette')).toHaveLength(1);
    expect(document.querySelector('style#dynamic-palette')).not.toBe(element);
  });
});
