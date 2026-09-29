import { useEffect, useRef } from 'react';

import type { MediaItem } from './types';

/*
 * Material You dynamic colour from one photo of the set.
 *
 * The seed is the average hue/chroma of a single preview, sampled through a
 * down-scaled canvas. Everything after that is the same model the Material
 * Theme Builder uses: a hue plus a chroma request, expanded into a *tonal*
 * palette, and the roles are read off the tone axis. Tone here is CIE L*, which
 * is exactly what HCT's tone is — so one ramp serves both schemes, and tone 40
 * (light primary) is the perceptual mirror of tone 80 (dark primary). Hue is
 * taken from Lab rather than CAM16 (HCT's own source) because Lab gives the
 * same hue ordering for a fraction of the code, and chroma is gamut-mapped by
 * bisection instead of the Material CAM16 solver — the visible difference is a
 * fraction of a JND, while the guarantee we actually need, "the role colours
 * stay inside sRGB and their on-* partners clear AA", is preserved.
 *
 * Nothing here mutates tokens.css: the static token file stays the source of
 * truth, and this module only ever injects one <style> that re-declares the
 * very same custom properties. Removing the element restores the static theme.
 */

export type PaletteStatus = 'loading' | 'ready' | 'error';

/** WCAG AA for body text — the floor every generated on-* role must clear. */
export const MIN_TEXT_CONTRAST = 4.5;

const STYLE_ID = 'dynamic-palette';
const STYLE_SELECTOR = 'style#dynamic-palette';

/**
 * Colour roles this module themes, in the order tokens.css declares them. Error
 * roles are deliberately absent: M3 does not derive them from the seed, and the
 * media canvas roles are deliberately absent for the same reason tokens.css
 * pins them (`--md-canvas-*` is dark in both schemes by design).
 */
export const TOKEN_ORDER = [
  'primary',
  'on-primary',
  'primary-container',
  'on-primary-container',
  'secondary',
  'on-secondary',
  'secondary-container',
  'on-secondary-container',
  'tertiary',
  'on-tertiary',
  'tertiary-container',
  'on-tertiary-container',
  'surface',
  'on-surface',
  'surface-variant',
  'on-surface-variant',
  'surface-dim',
  'surface-bright',
  'surface-container-lowest',
  'surface-container-low',
  'surface-container',
  'surface-container-high',
  'surface-container-highest',
  'inverse-surface',
  'inverse-on-surface',
  'inverse-primary',
  'outline',
  'outline-variant',
] as const;

export type PaletteToken = (typeof TOKEN_ORDER)[number];

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Lch {
  /** CIE L*, 0..100 — the tone axis, identical to HCT tone. */
  readonly l: number;
  readonly c: number;
  /** Degrees, 0..360. */
  readonly h: number;
}

/** A photo reduced to what a tonal palette can be built from. */
export interface ColorSeed {
  readonly hue: number;
  readonly chroma: number;
}

export type PaletteScheme = 'light' | 'dark';

export type GeneratedPalette = Readonly<Record<PaletteScheme, Readonly<Record<PaletteToken, Rgb>>>>;

/* -------------------------------------------------------------------------- */
/* Colour space                                                                */
/* -------------------------------------------------------------------------- */

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** D65 white point, the sRGB reference the design tokens are authored against. */
const D65_X = 0.9504559270516716;
const D65_Y = 1;
const D65_Z = 1.0890577507598784;

const LAB_EPSILON = 216 / 24389;
const LAB_KAPPA = 24389 / 27;

/**
 * The two published sRGB matrices are each other's inverse only to ~1e-4, so a
 * pixel of true grey comes out of the round trip with a chroma of a few
 * thousandths. Below this threshold the colour is neutral for every purpose
 * that matters (a chroma step of 0.1 is two orders under the JND), and reporting
 * a real hue would be reporting float noise.
 */
const ACHROMATIC_CHROMA = 0.1;

const TONE_SCAN_STEP = 2;
const TONE_SCAN_MAX = 100;
const GAMUT_BISECTIONS = 12;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeHue(hue: number): number {
  if (!Number.isFinite(hue)) return 0;
  return ((hue % 360) + 360) % 360;
}

function srgbToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const linear = Math.max(0, value);
  const encoded = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return clamp(Math.round(encoded * 255), 0, 255);
}

function labForward(value: number): number {
  return value > LAB_EPSILON ? Math.cbrt(value) : (LAB_KAPPA * value + 16) / 116;
}

function labInverse(value: number): number {
  const cubed = value * value * value;
  return cubed > LAB_EPSILON ? cubed : (116 * value - 16) / LAB_KAPPA;
}

type LinearRgb = readonly [number, number, number];

function lchToLinearRgb(lch: Lch): LinearRgb {
  const radians = (normalizeHue(lch.h) * Math.PI) / 180;
  const a = lch.c * Math.cos(radians);
  const b = lch.c * Math.sin(radians);

  const fy = (lch.l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const x = labInverse(fx) * D65_X;
  const y = labInverse(fy) * D65_Y;
  const z = labInverse(fz) * D65_Z;

  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

function isInGamut([r, g, b]: LinearRgb): boolean {
  const limit = 1 / 512;
  return r >= -limit && r <= 1 + limit && g >= -limit && g <= 1 + limit && b >= -limit && b <= 1 + limit;
}

function toRgb([r, g, b]: LinearRgb): Rgb {
  return { r: linearToSrgb(r), g: linearToSrgb(g), b: linearToSrgb(b) };
}

/**
 * Lab → sRGB with chroma bisection. Holding L* and hue and only lowering
 * chroma is what makes a tonal ramp look like one family instead of a rainbow:
 * out-of-gamut roles slide towards neutral along a single axis, they never
 * change their lightness or their hue.
 */
export function lchToRgb(lch: Lch): Rgb {
  const tone = clamp(lch.l, 0, 100);
  const chroma = Math.max(0, lch.c);
  const requested: Lch = { l: tone, c: chroma, h: lch.h };

  if (isInGamut(lchToLinearRgb(requested))) {
    return toRgb(lchToLinearRgb(requested));
  }

  let low = 0;
  let high = chroma;

  for (let step = 0; step < GAMUT_BISECTIONS; step += 1) {
    const mid = (low + high) / 2;
    const candidate: Lch = { l: tone, c: mid, h: lch.h };

    if (isInGamut(lchToLinearRgb(candidate))) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return toRgb(lchToLinearRgb({ l: tone, c: low, h: lch.h }));
}

export function rgbToLch(r: number, g: number, b: number): Lch {
  const red = srgbToLinear(clamp(r, 0, 255));
  const green = srgbToLinear(clamp(g, 0, 255));
  const blue = srgbToLinear(clamp(b, 0, 255));

  const x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / D65_X;
  const y = (0.2126729 * red + 0.7151522 * green + 0.072175 * blue) / D65_Y;
  const z = (0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / D65_Z;

  const fx = labForward(x);
  const fy = labForward(y);
  const fz = labForward(z);

  const labA = 500 * (fx - fy);
  const labB = 200 * (fy - fz);
  const measured = Math.hypot(labA, labB);
  const chroma = measured < ACHROMATIC_CHROMA ? 0 : measured;

  return {
    l: 116 * fy - 16,
    c: chroma,
    // An achromatic colour has no meaningful angle; 0 keeps it out of the ramp.
    h: chroma === 0 ? 0 : normalizeHue((Math.atan2(labB, labA) * 180) / Math.PI),
  };
}

export function relativeLuminance(color: Rgb): number {
  return (
    0.2126 * srgbToLinear(color.r) + 0.7152 * srgbToLinear(color.g) + 0.0722 * srgbToLinear(color.b)
  );
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * Nudges a foreground along its own tone axis until it clears `minimum` against
 * `background`. The scan is linear over the tone range rather than a binary
 * search because luminance is not strictly monotonic once chroma bisection
 * kicks in, and both ends of the axis (black, white) are inside the scan, so it
 * always terminates.
 *
 * Both directions are tried, not just the natural one: against a mid-tone
 * background the darker end may have nothing to offer — no sRGB colour reaches
 * 4.5:1 on a tone-49 grey — and a scan that only ever walked one way would fall
 * through to a colour that still misses the target.
 */
export function ensureContrast(
  color: Rgb,
  background: Rgb,
  minimum: number = MIN_TEXT_CONTRAST,
): Rgb {
  if (contrastRatio(color, background) >= minimum) {
    return color;
  }

  const seed = rgbToLch(color.r, color.g, color.b);
  const darken = relativeLuminance(background) > relativeLuminance(color);
  const steps = TONE_SCAN_MAX / TONE_SCAN_STEP;

  for (const lighten of darken ? [false, true] : [true, false]) {
    for (let step = 1; step <= steps; step += 1) {
      const tone = lighten ? step * TONE_SCAN_STEP : TONE_SCAN_MAX - step * TONE_SCAN_STEP;
      const candidate = lchToRgb({ l: tone, c: seed.c, h: seed.h });

      if (contrastRatio(candidate, background) >= minimum) {
        return candidate;
      }
    }
  }

  return contrastRatio(BLACK, background) >= contrastRatio(WHITE, background) ? BLACK : WHITE;
}

export function rgbToHex(color: Rgb): string {
  const channel = (value: number): string =>
    clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([\da-f]{6})$/i.exec(hex.trim());
  const digits = match?.[1];

  if (digits === undefined) {
    return null;
  }

  const value = Number.parseInt(digits, 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

/* -------------------------------------------------------------------------- */
/* Seed extraction                                                             */
/* -------------------------------------------------------------------------- */

/** Near-white and near-black carry no hue; averaging them in only dilutes it. */
const HUE_FLOOR_TONE = 4;
const HUE_CEILING_TONE = 96;
const OPAQUE_ALPHA = 128;

/**
 * Chroma-weighted mean of a downscaled RGBA buffer. Weighting by chroma is the
 * cheap half of Material's "score" idea: a photo that is mostly grey with a
 * saturated subject must yield the subject's hue, and a plain average would
 * answer grey. Returns null when the buffer holds no opaque pixel at all.
 */
export function extractSeed(pixels: Uint8ClampedArray | readonly number[]): ColorSeed | null {
  let opaque = 0;
  let weightSum = 0;
  let red = 0;
  let green = 0;
  let blue = 0;

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if ((pixels[index + 3] ?? 0) < OPAQUE_ALPHA) {
      continue;
    }

    const r = pixels[index] ?? 0;
    const g = pixels[index + 1] ?? 0;
    const b = pixels[index + 2] ?? 0;
    opaque += 1;

    const pixel = rgbToLch(r, g, b);

    if (pixel.l <= HUE_FLOOR_TONE || pixel.l >= HUE_CEILING_TONE) {
      continue;
    }

    const weight = 4 + pixel.c;
    weightSum += weight;
    red += r * weight;
    green += g * weight;
    blue += b * weight;
  }

  if (opaque === 0) {
    return null;
  }

  // Everything was near-black or near-white: the photo really has no hue.
  if (weightSum === 0) {
    return { hue: 0, chroma: 0 };
  }

  const mean = rgbToLch(red / weightSum, green / weightSum, blue / weightSum);
  return { hue: mean.h, chroma: mean.c };
}

/* -------------------------------------------------------------------------- */
/* Tonal palette                                                               */
/* -------------------------------------------------------------------------- */

/** Below this a photo reads as greyscale, and greyscale means the gray palette. */
const MIN_SEED_CHROMA = 6;
const CHROMA_BOOST = 1.8;
const MIN_PRIMARY_CHROMA = 36;
const MAX_PRIMARY_CHROMA = 96;
const SECONDARY_CHROMA_RATIO = 1 / 3;
const TERTIARY_CHROMA_RATIO = 1 / 2;
const TERTIARY_HUE_SHIFT = 60;
/** M3's neutral palettes: the seed hue at a chroma you only notice in bulk. */
const NEUTRAL_CHROMA = 4;
const NEUTRAL_VARIANT_CHROMA = 8;

type HueName = 'primary' | 'secondary' | 'tertiary' | 'neutral' | 'neutralVariant';

type Hues = Readonly<Record<HueName, ColorSeed>>;

function neutralHues(hue: number): Hues {
  return {
    primary: { hue, chroma: 0 },
    secondary: { hue, chroma: 0 },
    tertiary: { hue, chroma: 0 },
    neutral: { hue, chroma: 0 },
    neutralVariant: { hue, chroma: 0 },
  };
}

/**
 * Expands a seed into the five hue/chroma requests of a scheme: a boosted
 * primary, a desaturated secondary, a complementary tertiary, and the two
 * near-neutral ramps that carry every surface role.
 */
export function huesFromSeed(seed: ColorSeed): Hues {
  if (seed.chroma < MIN_SEED_CHROMA) {
    return neutralHues(seed.hue);
  }

  const chroma = Math.min(
    MAX_PRIMARY_CHROMA,
    Math.max(MIN_PRIMARY_CHROMA, seed.chroma * CHROMA_BOOST),
  );

  return {
    primary: { hue: seed.hue, chroma },
    secondary: { hue: seed.hue, chroma: chroma * SECONDARY_CHROMA_RATIO },
    tertiary: {
      hue: normalizeHue(seed.hue + TERTIARY_HUE_SHIFT),
      chroma: chroma * TERTIARY_CHROMA_RATIO,
    },
    neutral: { hue: seed.hue, chroma: NEUTRAL_CHROMA },
    neutralVariant: { hue: seed.hue, chroma: NEUTRAL_VARIANT_CHROMA },
  };
}

function roleColor(hues: Hues, name: HueName, tone: number): Rgb {
  const hue = hues[name];
  return lchToRgb({ l: tone, c: hue.chroma, h: hue.hue });
}

function onColor(hues: Hues, name: HueName, tone: number, background: Rgb): Rgb {
  return ensureContrast(roleColor(hues, name, tone), background);
}

function buildLightScheme(hues: Hues): Readonly<Record<PaletteToken, Rgb>> {
  const primary = roleColor(hues, 'primary', 40);
  const primaryContainer = roleColor(hues, 'primary', 90);
  const secondary = roleColor(hues, 'secondary', 40);
  const secondaryContainer = roleColor(hues, 'secondary', 90);
  const tertiary = roleColor(hues, 'tertiary', 40);
  const tertiaryContainer = roleColor(hues, 'tertiary', 90);
  const surface = roleColor(hues, 'neutral', 98);
  const surfaceVariant = roleColor(hues, 'neutralVariant', 90);
  const inverseSurface = roleColor(hues, 'neutral', 20);

  return {
    primary,
    'on-primary': onColor(hues, 'primary', 100, primary),
    'primary-container': primaryContainer,
    'on-primary-container': onColor(hues, 'primary', 10, primaryContainer),
    secondary,
    'on-secondary': onColor(hues, 'secondary', 100, secondary),
    'secondary-container': secondaryContainer,
    'on-secondary-container': onColor(hues, 'secondary', 10, secondaryContainer),
    tertiary,
    'on-tertiary': onColor(hues, 'tertiary', 100, tertiary),
    'tertiary-container': tertiaryContainer,
    'on-tertiary-container': onColor(hues, 'tertiary', 10, tertiaryContainer),
    surface,
    'on-surface': onColor(hues, 'neutral', 10, surface),
    'surface-variant': surfaceVariant,
    'on-surface-variant': onColor(hues, 'neutralVariant', 30, surfaceVariant),
    'surface-dim': roleColor(hues, 'neutral', 87),
    'surface-bright': roleColor(hues, 'neutral', 98),
    'surface-container-lowest': roleColor(hues, 'neutral', 100),
    'surface-container-low': roleColor(hues, 'neutral', 96),
    'surface-container': roleColor(hues, 'neutral', 94),
    'surface-container-high': roleColor(hues, 'neutral', 92),
    'surface-container-highest': roleColor(hues, 'neutral', 90),
    'inverse-surface': inverseSurface,
    'inverse-on-surface': onColor(hues, 'neutral', 95, inverseSurface),
    'inverse-primary': roleColor(hues, 'primary', 80),
    outline: roleColor(hues, 'neutralVariant', 50),
    'outline-variant': roleColor(hues, 'neutralVariant', 80),
  };
}

function buildDarkScheme(hues: Hues): Readonly<Record<PaletteToken, Rgb>> {
  const primary = roleColor(hues, 'primary', 80);
  const primaryContainer = roleColor(hues, 'primary', 30);
  const secondary = roleColor(hues, 'secondary', 80);
  const secondaryContainer = roleColor(hues, 'secondary', 30);
  const tertiary = roleColor(hues, 'tertiary', 80);
  const tertiaryContainer = roleColor(hues, 'tertiary', 30);
  const surface = roleColor(hues, 'neutral', 6);
  const surfaceVariant = roleColor(hues, 'neutralVariant', 30);
  const inverseSurface = roleColor(hues, 'neutral', 90);

  return {
    primary,
    'on-primary': onColor(hues, 'primary', 20, primary),
    'primary-container': primaryContainer,
    'on-primary-container': onColor(hues, 'primary', 90, primaryContainer),
    secondary,
    'on-secondary': onColor(hues, 'secondary', 20, secondary),
    'secondary-container': secondaryContainer,
    'on-secondary-container': onColor(hues, 'secondary', 90, secondaryContainer),
    tertiary,
    'on-tertiary': onColor(hues, 'tertiary', 20, tertiary),
    'tertiary-container': tertiaryContainer,
    'on-tertiary-container': onColor(hues, 'tertiary', 90, tertiaryContainer),
    surface,
    'on-surface': onColor(hues, 'neutral', 90, surface),
    'surface-variant': surfaceVariant,
    'on-surface-variant': onColor(hues, 'neutralVariant', 80, surfaceVariant),
    'surface-dim': roleColor(hues, 'neutral', 6),
    'surface-bright': roleColor(hues, 'neutral', 24),
    'surface-container-lowest': roleColor(hues, 'neutral', 4),
    'surface-container-low': roleColor(hues, 'neutral', 10),
    'surface-container': roleColor(hues, 'neutral', 12),
    'surface-container-high': roleColor(hues, 'neutral', 17),
    'surface-container-highest': roleColor(hues, 'neutral', 22),
    'inverse-surface': inverseSurface,
    'inverse-on-surface': onColor(hues, 'neutral', 20, inverseSurface),
    'inverse-primary': roleColor(hues, 'primary', 40),
    outline: roleColor(hues, 'neutralVariant', 60),
    'outline-variant': roleColor(hues, 'neutralVariant', 30),
  };
}

export function buildPalette(seed: ColorSeed): GeneratedPalette {
  const hues = huesFromSeed(seed);
  return { light: buildLightScheme(hues), dark: buildDarkScheme(hues) };
}

export function buildPaletteFromRgb(r: number, g: number, b: number): GeneratedPalette {
  const pixel = rgbToLch(r, g, b);
  return buildPalette({ hue: pixel.h, chroma: pixel.c });
}

/**
 * The neutral Material palette: the same tonal ramps at chroma 0, so the
 * fallback is a real M3 theme rather than a flat grey page. Used on the root
 * and 404 routes, and whenever a set's palette cannot be derived.
 */
export function grayPalette(): GeneratedPalette {
  return buildPalette({ hue: 0, chroma: 0 });
}

/* -------------------------------------------------------------------------- */
/* Injection                                                                   */
/* -------------------------------------------------------------------------- */

function renderScheme(scheme: Readonly<Record<PaletteToken, Rgb>>, indent: string): string {
  const declarations = TOKEN_ORDER.map(
    (token) => `${indent}  --md-sys-color-${token}: ${rgbToHex(scheme[token])};`,
  );
  return [`${indent}:root {`, ...declarations, `${indent}}`].join('\n');
}

/**
 * Both schemes live in one sheet, light first. The order is load-bearing: our
 * plain `:root` block is inserted after tokens.css, so it would otherwise beat
 * tokens.css's own dark block on equal specificity — the dark block that
 * follows it inside this sheet is what wins back the dark scheme.
 */
export function renderPaletteCss(palette: GeneratedPalette): string {
  return [
    '/* Material You palette sampled from one photo; tokens.css remains the fallback. */',
    renderScheme(palette.light, ''),
    '@media (prefers-color-scheme: dark) {',
    renderScheme(palette.dark, '  '),
    '}',
  ].join('\n');
}

function paletteStyleElement(): HTMLStyleElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const existing = document.querySelector<HTMLStyleElement>(STYLE_SELECTOR);

  if (existing !== null) {
    return existing;
  }

  const created = document.createElement('style');
  created.id = STYLE_ID;
  document.head.append(created);
  return created;
}

function writePaletteStyle(css: string): void {
  const element = paletteStyleElement();

  if (element === null || element.textContent === css) {
    return;
  }

  // Every value here is a hex string this module produced, so textContent is
  // both sufficient and safe; no page data ever reaches the stylesheet.
  element.textContent = css;
}

export function applyPalette(palette: GeneratedPalette): void {
  writePaletteStyle(renderPaletteCss(palette));
}

export function applyGrayPalette(): void {
  applyPalette(grayPalette());
}

/* -------------------------------------------------------------------------- */
/* Photo sampling (browser only)                                               */
/* -------------------------------------------------------------------------- */

const SAMPLE_MAX_EDGE = 24;

interface SampleChoice {
  readonly setId: string;
  readonly items: readonly MediaItem[];
  readonly url: string;
}

function isBrowser(): boolean {
  return typeof document !== 'undefined' && typeof Image !== 'undefined';
}

function loadThumb(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Must precede `src`: the S3 bucket answers with CORS headers, and without
    // this the canvas comes back tainted and getImageData throws.
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error('превью недоступно')), {
      once: true,
    });
    image.src = url;
  });
}

/**
 * One preview, downscaled to at most 24px on the long edge, reduced to a seed.
 * Every failure mode — a missing preview, a format the browser cannot decode, a
 * taint error from getImageData, no canvas context at all — answers null, and
 * the caller turns that into the gray palette.
 */
export async function sampleSeedFromUrl(url: string): Promise<ColorSeed | null> {
  if (!isBrowser()) {
    return null;
  }

  const image = await loadThumb(url);
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;

  if (naturalWidth === 0 || naturalHeight === 0) {
    return null;
  }

  const scale = Math.min(1, SAMPLE_MAX_EDGE / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (context === null) {
    return null;
  }

  context.drawImage(image, 0, 0, width, height);

  try {
    return extractSeed(context.getImageData(0, 0, width, height).data);
  } catch {
    return null;
  }
}

/** Photos first; a set of nothing but videos still gets a poster sampled. */
export function pickSampleUrl(items: readonly MediaItem[]): string | null {
  const photos = items.filter((item) => item.kind === 'image');
  const pool = photos.length > 0 ? photos : items;
  const first = pool[0];

  if (first === undefined) {
    return null;
  }

  const chosen = pool[Math.floor(Math.random() * pool.length)];
  return (chosen ?? first).thumbUrl;
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Themed from one photo of the set the page is showing.
 *
 * Policy, one branch per status:
 *   'ready'   → sample a photo and install its palette. The photo is drawn once
 *               per (setId, items) pair and kept in a ref, so re-renders — and
 *               React's StrictMode double-invoke — never re-roll the choice and
 *               the page never repaints itself mid-session.
 *   'loading' → gray. Grey is the honest "no photo yet" state, and painting it
 *               immediately is what keeps the static purple from flashing
 *               through the skeleton grid.
 *   'error'   → gray, same reasoning: the error panel is not themed by a photo.
 *
 * Unmount also lands on gray, so leaving a set can never leave its colours
 * behind on the root or 404 route.
 */
export function usePaletteForSet(
  setId: string,
  items: readonly MediaItem[],
  status: PaletteStatus,
): void {
  const choiceRef = useRef<SampleChoice | null>(null);

  useEffect(() => {
    if (status !== 'ready' || items.length === 0) {
      choiceRef.current = null;
      applyGrayPalette();
      return undefined;
    }

    const cached = choiceRef.current;
    const url =
      cached !== null && cached.setId === setId && cached.items === items
        ? cached.url
        : pickSampleUrl(items);

    if (url === null) {
      applyGrayPalette();
      return undefined;
    }

    choiceRef.current = { setId, items, url };

    let cancelled = false;

    void sampleSeedFromUrl(url).then(
      (seed) => {
        if (!cancelled) {
          applyPalette(seed === null ? grayPalette() : buildPalette(seed));
        }
      },
      () => {
        if (!cancelled) {
          applyGrayPalette();
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [setId, items, status]);

  useEffect(
    () => () => {
      applyGrayPalette();
    },
    [],
  );
}
