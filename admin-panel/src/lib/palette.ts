/**
 * Photo-derived theming, Material You style: "цвета из фото".
 *
 * A photo of the currently opened set is downsampled on a canvas, reduced to a
 * single seed colour, and turned into a full tonal palette for BOTH schemes.
 * The palette is injected as a `<style id="admin-dynamic-palette">` that
 * redefines exactly the colour roles of src/styles/tokens.css, so the static
 * stylesheet stays the source of truth and the runtime sheet is a pure
 * override — deleting the element restores the static theme.
 *
 * The contract the public site mirrors: `applyGrayPalette()` plus a
 * status-driven hook. Wherever no photo is visible — login, boot, an empty
 * set, a failed load — the neutral gray palette is applied instead of a stale
 * photo palette.
 *
 * The colour math is dependency-free and lives in pure functions above the DOM
 * layer, so the WCAG invariants are unit-tested without a canvas.
 */

import { useEffect } from 'react';

import { publicUrl, thumbUrl } from './urls';
import type { MediaKind } from './validate';

const STYLE_ID = 'admin-dynamic-palette';

/** Side of the square the photo is downsampled to before it is read back. */
const SAMPLE_SIZE = 32;

/** A photo that never loads (dead host, blocked request) must not hang the UI. */
const SAMPLE_TIMEOUT_MS = 6000;

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/** Body copy keeps a margin above AA; 5.5:1 is the highest ratio every surface
 *  of the dark scheme can still reach, so the margin never breaks a scheme. */
const AA_BODY = 5.5;

/**
 * Every colour role of tokens.css that exists in BOTH scheme blocks, i.e. every
 * role the dynamic palette has to redefine. `scrim` and `shadow` are light-only
 * and constant (#000000), so they are deliberately absent.
 */
const COLOR_ROLES = [
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
  'error',
  'on-error',
  'error-container',
  'on-error-container',
  'success-container',
  'on-success-container',
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

export type ColorRole = (typeof COLOR_ROLES)[number];
export type ColorScheme = Readonly<Record<ColorRole, string>>;
export type SchemeMode = 'light' | 'dark';

export interface Rgb {
  /** 0..255 */
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Oklch {
  /** 0..1 */
  readonly l: number;
  readonly c: number;
  /** 0..360 */
  readonly h: number;
}

/**
 * Canvas RGBA read-back, four channels per pixel. Indexed access only, so both
 * a plain number array (tests) and a `Uint8ClampedArray` (real canvas) fit.
 */
export type PixelBuffer = { readonly length: number; readonly [index: number]: number };

/** The subset of SetFile the theming needs: preview URLs are derived, not stored. */
export interface PaletteFile {
  readonly name: string;
  readonly kind: MediaKind;
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/* =============================================================================
   Colour space: sRGB <-> linear <-> OKLab/OKLCH (Björn Ottosson)
   ============================================================================= */

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }

  return value > 1 ? 1 : value;
}

function toLinear(channel: number): number {
  const value = clamp01(channel / 255);

  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function fromLinear(channel: number): number {
  const encoded = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;

  return Math.round(clamp01(encoded) * 255);
}

function linearToOklab(r: number, g: number, b: number): Oklch {
  const long = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const medium = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const short = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const l = 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short;
  const a = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short;
  const c = 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short;

  return { l, c: Math.hypot(a, c), h: ((Math.atan2(c, a) * 180) / Math.PI + 360) % 360 };
}

function oklabToLinear(color: Oklch): readonly [number, number, number] {
  const h = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(h);
  const b = color.c * Math.sin(h);

  const long = (color.l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (color.l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (color.l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];
}

function inGamut([r, g, b]: readonly [number, number, number]): boolean {
  return r >= -0.0001 && r <= 1.0001 && g >= -0.0001 && g <= 1.0001 && b >= -0.0001 && b <= 1.0001;
}

export function srgbToOklch(color: Rgb): Oklch {
  return linearToOklab(toLinear(color.r), toLinear(color.g), toLinear(color.b));
}

/**
 * OKLCH -> sRGB. Some tones simply do not exist in sRGB (a saturated yellow has
 * no dark tones), so chroma is bisected down until the colour fits the gamut —
 * the same fallback Material's own HCT solver applies.
 */
export function oklchToSrgb(color: Oklch): Rgb {
  const l = clamp01(color.l);
  const chroma = Math.max(0, color.c);
  const direct = oklabToLinear({ l, c: chroma, h: color.h });

  if (inGamut(direct)) {
    return linearToRgb(direct);
  }

  let low = 0;
  let high = chroma;

  for (let step = 0; step < 12; step += 1) {
    const middle = (low + high) / 2;

    if (inGamut(oklabToLinear({ l, c: middle, h: color.h }))) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return linearToRgb(oklabToLinear({ l, c: low, h: color.h }));
}

function linearToRgb([r, g, b]: readonly [number, number, number]): Rgb {
  return { r: fromLinear(r), g: fromLinear(g), b: fromLinear(b) };
}

export function toHex(color: Rgb): string {
  const part = (channel: number): string =>
    Math.round(clamp01(channel / 255) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

export function fromHex(hex: string): Rgb {
  const value = hex.replace('#', '');
  const read = (offset: number): number => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16);

    return Number.isFinite(channel) ? channel : 0;
  };

  return { r: read(0), g: read(2), b: read(4) };
}

/* =============================================================================
   WCAG contrast
   ============================================================================= */

export function relativeLuminance(color: Rgb): number {
  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);
}

export function contrastRatio(first: Rgb, second: Rgb): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const CONTRAST_STEP = 0.01;
const CONTRAST_STEPS = 101;

/**
 * Walks the tone of `color` away from `background` until the WCAG ratio reaches
 * `target`. Tone, not chroma, is what carries legibility, so the hue stays
 * exactly as the photo produced it and only lightness gives.
 *
 * Backgrounds of a tonal palette sit at the light or dark end of the ramp, and
 * there a pure black or white always clears AA. The final branch only covers a
 * hypothetical mid-tone background, where it returns the better of the two
 * rather than a colour that fails the target silently.
 */
export function ensureContrast(color: Rgb, background: Rgb, target: number = AA_TEXT): Rgb {
  if (contrastRatio(color, background) >= target) {
    return color;
  }

  const direction = relativeLuminance(background) > relativeLuminance(color) ? -1 : 1;
  let tone = srgbToOklch(color);

  for (let step = 0; step < CONTRAST_STEPS; step += 1) {
    const next = tone.l + direction * CONTRAST_STEP;

    if (next < 0 || next > 1) {
      break;
    }

    tone = { ...tone, l: next };
    const candidate = oklchToSrgb(tone);

    if (contrastRatio(candidate, background) >= target) {
      return candidate;
    }
  }

  return contrastRatio(WHITE, background) >= contrastRatio(BLACK, background) ? WHITE : BLACK;
}

/* =============================================================================
   Photo sampling
   ============================================================================= */

/** Pixels this transparent are padding (letterboxing, a PNG's alpha edge). */
const OPAQUE = 128;

function pixelAt(pixels: PixelBuffer, index: number): Rgb | null {
  const r = pixels[index];
  const g = pixels[index + 1];
  const b = pixels[index + 2];
  const a = pixels[index + 3];

  if (r === undefined || g === undefined || b === undefined || a === undefined || a < OPAQUE) {
    return null;
  }

  return { r, g, b };
}

export function averageColor(pixels: PixelBuffer): Rgb | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const pixel = pixelAt(pixels, index);

    if (pixel !== null) {
      r += pixel.r;
      g += pixel.g;
      b += pixel.b;
      count += 1;
    }
  }

  if (count === 0) {
    return null;
  }

  return { r: r / count, g: g / count, b: b / count };
}

interface Bucket {
  readonly key: number;
  /** Share of the opaque sample this bucket covers, 0..1. */
  readonly share: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Share of the sample a bucket has to cover to count as the photo's subject. */
const SUBJECT_SHARE = 0.03;

/** Below this chroma a bucket is scenery (sky, wall), not a colour worth theming. */
const SUBJECT_CHROMA = 0.05;

const FALLBACK_CHROMA = 0.02;

/**
 * Buckets the sample into 12-bit cells (16 levels per channel) and ranks them by
 * how much of the photo they cover; ties break on the cell key so the result is
 * stable for identical input.
 */
function collectBuckets(pixels: PixelBuffer): readonly Bucket[] {
  const cells = new Map<number, { count: number; r: number; g: number; b: number }>();
  let opaque = 0;

  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const pixel = pixelAt(pixels, index);

    if (pixel === null) {
      continue;
    }

    opaque += 1;
    const key = ((pixel.r >> 4) << 8) | ((pixel.g >> 4) << 4) | (pixel.b >> 4);
    const cell = cells.get(key);

    if (cell === undefined) {
      cells.set(key, { count: 1, r: pixel.r, g: pixel.g, b: pixel.b });
    } else {
      cell.count += 1;
      cell.r += pixel.r;
      cell.g += pixel.g;
      cell.b += pixel.b;
    }
  }

  const total = Math.max(1, opaque);

  return [...cells.entries()]
    .map(([key, cell]) => ({
      key,
      share: cell.count / total,
      r: cell.r / cell.count,
      g: cell.g / cell.count,
      b: cell.b / cell.count,
    }))
    .sort((left, right) =>
      right.share === left.share ? left.key - right.key : right.share - left.share,
    );
}

/**
 * The photo's own colour: the most populous bucket that actually carries
 * colour, so a big flat sky does not become the theme. A shot with no such
 * bucket (greyscale) falls back to its most populous one, and an image with no
 * opaque pixel at all to the plain average.
 */
export function dominantColor(pixels: PixelBuffer): Rgb | null {
  const buckets = collectBuckets(pixels);
  const top = buckets[0];

  if (top === undefined) {
    return null;
  }

  const subject = buckets.find(
    (bucket) => bucket.share >= SUBJECT_SHARE && srgbToOklch(bucket).c >= SUBJECT_CHROMA,
  );

  if (subject !== undefined) {
    return subject;
  }

  if (srgbToOklch(top).c >= FALLBACK_CHROMA) {
    return top;
  }

  return averageColor(pixels);
}

/* =============================================================================
   Tonal palette generation
   ============================================================================= */

/** OKLCH hue of the M3 red and green ramps. */
const ERROR_HUE = 27;
const SUCCESS_HUE = 150;

const MAX_CHROMA = 0.2;

/** Neutrals keeps only a whisper of the photo's hue, like the M3 baseline. */
const NEUTRAL_CHROMA = 0.012;

interface Ramp {
  /** Tone + chroma at the photo's own hue. */
  readonly at: (l: number, chroma: number, hue?: number) => Rgb;
  /** Chroma the neutral surface ramp is allowed to keep. */
  readonly neutral: number;
  readonly seed: Oklch;
}

function ramp(seed: Oklch): Ramp {
  return {
    at: (l, chroma, hue = seed.h) => oklchToSrgb({ l, c: Math.min(chroma, MAX_CHROMA), h: hue }),
    neutral: Math.min(seed.c, NEUTRAL_CHROMA),
    seed,
  };
}

function buildLight(seed: Oklch): ColorScheme {
  const { at, neutral } = ramp(seed);
  const tertiaryHue = (seed.h + 60) % 360;
  const bodyTone = 0.28;
  const captionTone = 0.5;

  const lowest = at(1, neutral * 0.6);
  const surface = at(0.985, neutral);
  const low = at(0.975, neutral);
  const container = at(0.955, neutral);
  const high = at(0.935, neutral);
  const highest = at(0.915, neutral * 1.1);
  // Тёмный текст читается тем хуже, чем темнее фон, поэтому эталон контраста —
  // самый тёмный светлый фон схемы, а не самый светлый.
  const quietest = at(0.9, neutral * 1.4);

  const primary = ensureContrast(at(0.47, seed.c * 1.15), quietest, AA_TEXT);
  const primaryContainer = at(0.9, seed.c * 0.55);
  const secondary = ensureContrast(at(0.47, seed.c * 0.45), quietest, AA_TEXT);
  const secondaryContainer = at(0.92, seed.c * 0.4);
  const tertiary = ensureContrast(at(0.5, seed.c * 0.7), quietest, AA_TEXT);
  const tertiaryContainer = at(0.9, seed.c * 0.5, tertiaryHue);
  // Error and success keep the M3 ramps instead of following the photo: a red
  // that drifts into the photo's hue stops reading as an error.
  const error = ensureContrast(at(0.45, 0.17, ERROR_HUE), quietest, AA_TEXT);
  const errorContainer = at(0.92, 0.16, ERROR_HUE);
  const successContainer = at(0.9, 0.15, SUCCESS_HUE);
  const inverseSurface = at(0.28, seed.c * 0.35);

  return {
    primary: toHex(primary),
    'on-primary': toHex(ensureContrast(at(0.98, seed.c * 0.2), primary, AA_TEXT)),
    'primary-container': toHex(primaryContainer),
    'on-primary-container': toHex(ensureContrast(at(0.3, seed.c * 0.8), primaryContainer, AA_TEXT)),
    secondary: toHex(secondary),
    'on-secondary': toHex(ensureContrast(at(0.98, seed.c * 0.1), secondary, AA_TEXT)),
    'secondary-container': toHex(secondaryContainer),
    'on-secondary-container': toHex(
      ensureContrast(at(0.32, seed.c * 0.6), secondaryContainer, AA_TEXT),
    ),
    tertiary: toHex(tertiary),
    'on-tertiary': toHex(ensureContrast(at(0.98, seed.c * 0.2), tertiary, AA_TEXT)),
    'tertiary-container': toHex(tertiaryContainer),
    'on-tertiary-container': toHex(
      ensureContrast(at(0.32, seed.c * 0.7), tertiaryContainer, AA_TEXT),
    ),
    error: toHex(error),
    'on-error': toHex(ensureContrast(at(0.98, 0.05), error, AA_TEXT)),
    'error-container': toHex(errorContainer),
    'on-error-container': toHex(
      ensureContrast(at(0.32, 0.16, ERROR_HUE), errorContainer, AA_TEXT),
    ),
    'success-container': toHex(successContainer),
    'on-success-container': toHex(
      ensureContrast(at(0.3, 0.15, SUCCESS_HUE), successContainer, AA_TEXT),
    ),
    surface: toHex(surface),
    'on-surface': toHex(ensureContrast(at(bodyTone, seed.c * 0.4), quietest, AA_BODY)),
    'surface-variant': toHex(quietest),
    'on-surface-variant': toHex(ensureContrast(at(captionTone, seed.c * 0.5), quietest, AA_TEXT)),
    'surface-dim': toHex(at(0.92, neutral * 1.2)),
    'surface-bright': toHex(at(0.995, neutral)),
    'surface-container-lowest': toHex(lowest),
    'surface-container-low': toHex(low),
    'surface-container': toHex(container),
    'surface-container-high': toHex(high),
    'surface-container-highest': toHex(highest),
    'inverse-surface': toHex(inverseSurface),
    'inverse-on-surface': toHex(ensureContrast(at(0.95, seed.c * 0.2), inverseSurface, AA_TEXT)),
    'inverse-primary': toHex(at(0.75, seed.c * 0.9)),
    outline: toHex(ensureContrast(at(0.62, seed.c * 0.3), surface, AA_NON_TEXT)),
    'outline-variant': toHex(at(0.85, neutral * 1.6)),
  };
}

function buildDark(seed: Oklch): ColorScheme {
  const { at, neutral } = ramp(seed);
  const tertiaryHue = (seed.h + 60) % 360;
  const bodyTone = 0.93;
  const captionTone = 0.78;

  const surface = at(0.18, neutral);
  const lowest = at(0.12, neutral * 0.6);
  const low = at(0.21, neutral);
  const container = at(0.25, neutral);
  const high = at(0.3, neutral);
  const highest = at(0.35, neutral * 1.1);
  // Светлый текст читается тем хуже, чем светлее фон, поэтому эталон контраста —
  // самый светлый тёмный фон схемы.
  const loudest = at(0.4, neutral * 1.1);

  const primary = ensureContrast(at(0.8, seed.c * 1.1), loudest, AA_TEXT);
  const primaryContainer = at(0.38, seed.c * 0.55);
  const secondary = ensureContrast(at(0.8, seed.c * 0.45), loudest, AA_TEXT);
  const secondaryContainer = at(0.32, seed.c * 0.4);
  const tertiary = ensureContrast(at(0.82, seed.c * 0.7), loudest, AA_TEXT);
  const tertiaryContainer = at(0.38, seed.c * 0.5, tertiaryHue);
  const error = ensureContrast(at(0.8, 0.12, ERROR_HUE), loudest, AA_TEXT);
  const errorContainer = at(0.38, 0.13, ERROR_HUE);
  const successContainer = at(0.36, 0.12, SUCCESS_HUE);
  const inverseSurface = at(0.9, seed.c * 0.3);

  return {
    primary: toHex(primary),
    'on-primary': toHex(ensureContrast(at(0.22, seed.c * 0.3), primary, AA_TEXT)),
    'primary-container': toHex(primaryContainer),
    'on-primary-container': toHex(
      ensureContrast(at(0.95, seed.c * 0.5), primaryContainer, AA_TEXT),
    ),
    secondary: toHex(secondary),
    'on-secondary': toHex(ensureContrast(at(0.22, seed.c * 0.2), secondary, AA_TEXT)),
    'secondary-container': toHex(secondaryContainer),
    'on-secondary-container': toHex(
      ensureContrast(at(0.95, seed.c * 0.4), secondaryContainer, AA_TEXT),
    ),
    tertiary: toHex(tertiary),
    'on-tertiary': toHex(ensureContrast(at(0.22, seed.c * 0.3), tertiary, AA_TEXT)),
    'tertiary-container': toHex(tertiaryContainer),
    'on-tertiary-container': toHex(
      ensureContrast(at(0.95, seed.c * 0.4), tertiaryContainer, AA_TEXT),
    ),
    error: toHex(error),
    'on-error': toHex(ensureContrast(at(0.22, 0.05), error, AA_TEXT)),
    'error-container': toHex(errorContainer),
    'on-error-container': toHex(
      ensureContrast(at(0.95, 0.13, ERROR_HUE), errorContainer, AA_TEXT),
    ),
    'success-container': toHex(successContainer),
    'on-success-container': toHex(
      ensureContrast(at(0.95, 0.12, SUCCESS_HUE), successContainer, AA_TEXT),
    ),
    surface: toHex(surface),
    'on-surface': toHex(ensureContrast(at(bodyTone, seed.c * 0.3), loudest, AA_BODY)),
    'surface-variant': toHex(at(0.38, neutral * 1.4)),
    'on-surface-variant': toHex(ensureContrast(at(captionTone, seed.c * 0.4), loudest, AA_TEXT)),
    'surface-dim': toHex(at(0.18, neutral)),
    'surface-bright': toHex(loudest),
    'surface-container-lowest': toHex(lowest),
    'surface-container-low': toHex(low),
    'surface-container': toHex(container),
    'surface-container-high': toHex(high),
    'surface-container-highest': toHex(highest),
    'inverse-surface': toHex(inverseSurface),
    'inverse-on-surface': toHex(ensureContrast(at(0.28, seed.c * 0.4), inverseSurface, AA_TEXT)),
    'inverse-primary': toHex(at(0.45, seed.c)),
    outline: toHex(ensureContrast(at(0.72, seed.c * 0.3), surface, AA_NON_TEXT)),
    'outline-variant': toHex(at(0.32, neutral * 1.6)),
  };
}

/** Full M3 colour scheme for one scheme mode, derived from a seed colour. */
export function buildScheme(seed: Rgb, mode: SchemeMode): ColorScheme {
  const tone = srgbToOklch(seed);

  return mode === 'dark' ? buildDark(tone) : buildLight(tone);
}

function declarations(scheme: ColorScheme): string {
  return COLOR_ROLES.map((role) => `--md-sys-color-${role}:${scheme[role]};`).join('');
}

/** The runtime stylesheet: the same two scheme blocks tokens.css declares. */
export function paletteCss(seed: Rgb): string {
  return [
    `:root{color-scheme:light;${declarations(buildScheme(seed, 'light'))}}`,
    `@media (prefers-color-scheme: dark){:root{color-scheme:dark;${declarations(buildScheme(seed, 'dark'))}}}`,
  ].join('\n');
}

/**
 * The neutral gray palette. It is a palette like any other — the seed is simply
 * achromatic — so login and boot look deliberate and share every token with the
 * themed workspace. Error and success keep their semantic ramps, or a red error
 * message would be gray.
 */
export function grayPaletteCss(): string {
  return paletteCss({ r: 128, g: 128, b: 128 });
}

/* =============================================================================
   DOM layer
   ============================================================================= */

let requestCounter = 0;

function beginRequest(): number {
  requestCounter += 1;

  return requestCounter;
}

function isCurrent(token: number): boolean {
  return token === requestCounter;
}

function createStyleElement(): HTMLStyleElement {
  const style = document.createElement('style');
  style.id = STYLE_ID;

  return style;
}

function inject(css: string): void {
  const existing = document.getElementById(STYLE_ID);
  const style = existing instanceof HTMLStyleElement ? existing : createStyleElement();

  // textContent, not innerHTML: the sheet is built from colours we generated.
  if (style.textContent !== css) {
    style.textContent = css;
  }

  if (style.parentNode === null) {
    document.head.append(style);
  }
}

/** Neutral gray palette for login, boot and every state without a visible photo. */
export function applyGrayPalette(): void {
  if (typeof document === 'undefined') {
    return;
  }

  beginRequest();
  inject(grayPaletteCss());
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    // Required for a readable canvas: without it the pixels stay tainted and
    // getImageData throws, which is the bucket-without-CORS failure path.
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';

    const timer = setTimeout(() => {
      settle();
      reject(new Error('Таймаут загрузки превью'));
    }, SAMPLE_TIMEOUT_MS);

    const settle = (): void => {
      clearTimeout(timer);
      image.removeEventListener('load', onLoad);
      image.removeEventListener('error', onError);
    };

    const onLoad = (): void => {
      settle();
      resolve(image);
    };

    const onError = (): void => {
      settle();
      reject(new Error('Превью недоступно'));
    };

    image.addEventListener('load', onLoad);
    image.addEventListener('error', onError);
    image.src = url;
  });
}

async function sampleImage(url: string): Promise<PixelBuffer | null> {
  const image = await loadImage(url);
  const { naturalWidth: width, naturalHeight: height } = image;

  if (width <= 0 || height <= 0) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;

  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (context === null) {
    return null;
  }

  context.drawImage(image, 0, 0, width, height, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

  return context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
}

/**
 * Samples `sourceUrl` on a canvas and applies a palette derived from the photo.
 *
 * Resolves false and falls back to the neutral gray palette when the image
 * cannot be loaded or read (missing preview, no CORS on the bucket, tainted
 * canvas), so the UI never keeps a palette that no longer matches what is on
 * screen. `fallbackUrl` is tried under the same request when the preview itself
 * is missing — a set uploaded outside the admin panel still has originals. A
 * request that a newer one superseded resolves false without touching the DOM,
 * so a slow sample cannot repaint over a freshly picked palette.
 */
export async function applyPaletteFromImage(
  sourceUrl: string,
  fallbackUrl: string | null = null,
): Promise<boolean> {
  if (typeof document === 'undefined' || sourceUrl === '') {
    return false;
  }

  const token = beginRequest();
  const sources =
    fallbackUrl === null || fallbackUrl === sourceUrl ? [sourceUrl] : [sourceUrl, fallbackUrl];

  try {
    for (const source of sources) {
      const pixels = await sampleImage(source);
      const seed = pixels === null ? null : dominantColor(pixels);

      if (!isCurrent(token)) {
        return false;
      }

      if (seed !== null) {
        inject(paletteCss(seed));

        return true;
      }
    }

    inject(grayPaletteCss());

    return false;
  } catch {
    if (isCurrent(token)) {
      inject(grayPaletteCss());
    }

    return false;
  }
}

/* =============================================================================
   Photo choice and React wiring
   ============================================================================= */

function hash(text: string): number {
  let value = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }

  return value >>> 0;
}

export interface PaletteSource {
  readonly file: PaletteFile;
  readonly thumb: string;
}

/**
 * One photo of the set, chosen by a hash of the set id and its file names: a
 * different set gets a different photo, and the same set keeps the same one
 * across re-renders and reloads instead of flickering to a new palette. Files
 * the admin panel never previews (kind "other") are not candidates.
 */
export function pickPreview(setId: string, files: readonly PaletteFile[]): PaletteSource | null {
  const candidates: PaletteFile[] = [];

  for (const file of files) {
    if (thumbUrl(setId, file.name, file.kind) !== null) {
      candidates.push(file);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const key = `${setId} ${candidates.map((file) => file.name).join(' ')}`;
  const chosen = candidates[hash(key) % candidates.length];

  if (chosen === undefined) {
    return null;
  }

  const thumb = thumbUrl(setId, chosen.name, chosen.kind);

  return thumb === null ? null : { file: chosen, thumb };
}

function signatureOf(files: readonly PaletteFile[] | null): string {
  return files === null ? '' : files.map((file) => `${file.name} ${file.kind}`).join(' ');
}

/**
 * Recolours the workspace from a photo of the set whose files are on screen, and
 * keeps the neutral gray palette everywhere else: no set selected, the list is
 * still loading or failed, an empty set, or a set with nothing previewable.
 *
 * A file list is enough — preview URLs are derived from the set id and the media
 * kind, exactly as the file list itself derives them.
 */
export function usePaletteForFiles(files: readonly PaletteFile[] | null, setId: string | null): void {
  const signature = signatureOf(files);

  useEffect(() => {
    if (setId === null || setId === '' || files === null || files.length === 0) {
      applyGrayPalette();
      return;
    }

    const source = pickPreview(setId, files);

    if (source === null) {
      applyGrayPalette();
      return;
    }

    void applyPaletteFromImage(
      source.thumb,
      source.file.kind === 'image' ? publicUrl(setId, source.file.name) : null,
    );
  }, [setId, signature]);

  useEffect(
    () => () => {
      // Leaving the file browser means no photo is on screen any more.
      applyGrayPalette();
    },
    [],
  );
}
