/*
 * Mosaic rhythm for the set grid.
 *
 * A wall of equal squares reads as a spreadsheet; Google Photos reads as a
 * mosaic because every so often a photo takes four tracks, a couple take two,
 * and the eye picks the breaks up as rhythm. Turning that into a layout needs a
 * decision — which cell spans which tracks — and it has to be a pure one: the
 * grid knows nothing about image sizes (`MediaItem` carries no dimensions) and
 * must not wait for pixels it will never get, so the geometry is decided from
 * the item count and the column count alone.
 *
 * The rhythm itself is drawn, not tabulated. Fixed beats cycled through a table
 * read as a cycle: the eye named the period within three rows and the mosaic
 * looked generated rather than photographed. So the gaps are random — but drawn
 * from a *seeded* generator, because a mosaic that reshuffles on every render
 * would move the photos out from under the user's finger. One set, one pattern:
 * the seed comes from the set id, so two sets never look alike and one set
 * always looks the same, at any width.
 *
 * The grid is filled the way a browser fills it — sparse, in reading order,
 * never `dense`, because dense backfills holes out of order and the viewer
 * navigates `items[index]`. Two consequences of that model shape everything:
 *
 *   - a wide (2x1) tile may start on any column that still has two tracks left;
 *   - a hero (2x2) may only start on column 0 of a fresh row, because the two
 *     tracks above its second row would otherwise stay empty. A hole reads as
 *     a bug, never as breathing room.
 *
 * So the spans are scheduled rather than demanded: a hero becomes *due* after a
 * drawn gap and is placed at the first column 0 that follows, a wide becomes due
 * on a longer drawn beat and lands on the first pair of tracks that fits, and a
 * hero near the end of the set is skipped unless enough items remain to fill
 * both of the rows it spans. Nothing that would not fit is ever asked for, so
 * downgrades fall out of the geometry instead of being special-cased — the
 * randomness only picks the beat, never the position.
 */

/** How much of the grid one cell takes; the CSS owns the matching rules. */
export type CellSpanKind = 'sm' | 'wide' | 'hero';

interface Footprint {
  /** Tracks the cell spans. */
  readonly columns: number;
  /** Rows the cell spans. */
  readonly rows: number;
}

const FOOTPRINTS: Readonly<Record<CellSpanKind, Footprint>> = {
  sm: { columns: 1, rows: 1 },
  wide: { columns: 2, rows: 1 },
  hero: { columns: 2, rows: 2 },
};

/** A span needs two tracks to span into; below that the grid stays a plain wall. */
const MIN_SPAN_COLUMNS = 2;

/**
 * On two tracks a wide tile is the whole row, and a full-width banner every
 * few photos reads as a broken carousel. Heroes stay — they are the point of
 * the mosaic, and on a phone they are what breaks the square wall.
 */
const MIN_WIDE_COLUMNS = 3;

/**
 * Items between two heroes, drawn from this range. Both ends are deliberate:
 * the floor is generous because a hero cannot repeat sooner than
 * `2 * columns - 3` items anyway, so a short draw is spent waiting for the next
 * column 0 rather than crowding the mosaic; the ceiling reaches past several
 * column 0s on purpose, because a range that only ever spans one step still
 * reads as a period once the geometry has quantised the steps. The long quiet
 * stretches are what make the next big photo land like an event.
 */
const HERO_GAP: readonly [number, number] = [5, 24];

/**
 * Items between wide tiles, on a longer beat than the heroes so a wide stays an
 * accent instead of becoming a second rhythm competing with them.
 */
const WIDE_GAP: readonly [number, number] = [6, 19];

/**
 * The opening hero already sets the tone, so the first wide waits out a beat of
 * its own instead of landing right beside it.
 */
const WIDE_OPENING_GAP: readonly [number, number] = [2, 6];

/**
 * Items a wide must leave alone around the last one. A drawn beat can come up
 * short, and two wide tiles back to back read as one bar, not as a mosaic.
 */
const WIDE_HOLDOFF = 2;

/** The seed for a caller with nothing better to offer. */
const DEFAULT_SEED = 0x9e3779b9;

/**
 * mulberry32: a seeded 32-bit generator in ten lines, no dependencies. The whole
 * promise of this module is that a set looks the same on every render, so the
 * generator is seeded by the caller and `Math.random` never reaches this file.
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let bits = state;
    bits = Math.imul(bits ^ (bits >>> 15), bits | 1);
    bits ^= bits + Math.imul(bits ^ (bits >>> 7), bits | 61);

    return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number from an inclusive range, drawn from the seeded generator. */
function drawInt(random: () => number, range: readonly [number, number]): number {
  const [min, max] = range;

  return min + Math.floor(random() * (max - min + 1));
}

/**
 * FNV-1a over a string, so a set id becomes a seed. Hashing the id rather than
 * the file list is what keeps the skeleton and the loaded grid on one pattern:
 * the skeleton has no items to hash, and both states know the id.
 */
export function hashSeed(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/**
 * Items a hero spans that sit outside it: two tracks at its column 0, in each of
 * the two rows it covers. Without this many items behind it the mosaic would end
 * on a hero floating over an empty strip.
 */
export function heroTailNeed(columns: number): number {
  return (columns - FOOTPRINTS.hero.columns) * FOOTPRINTS.hero.rows;
}

/**
 * Span per cell for a mosaic of `count` cells laid out in `columns` tracks.
 *
 * Order is the array's: cell `i` is item `i`, so what the viewer walks and what
 * the eye reads are the same sequence. One seed always draws the same rhythm, so
 * a set keeps its face across re-renders, remounts and resizes. A non-positive
 * count gives no cells, and fewer than two tracks (or a count the DOM could not
 * measure) gives the plain square wall.
 */
export function computeCellSpans(
  count: number,
  columns: number,
  seed: number = DEFAULT_SEED,
): CellSpanKind[] {
  const spans: CellSpanKind[] = [];
  const tracks = Number.isFinite(columns) ? Math.floor(columns) : 1;

  if (count <= 0 || tracks < MIN_SPAN_COLUMNS) {
    for (let index = 0; index < count; index += 1) {
      spans.push('sm');
    }

    return spans;
  }

  const random = createRandom(seed);
  const tail = heroTailNeed(tracks);
  /* Cursor over the tracks of the current row, and how many of them the row
     below already starts with — a hero speaks for the same two columns in both
     of the rows it spans, so the row under it starts past them. */
  let col = 0;
  let carried = 0;
  /* Countdown to the next span being due: zero means it wants this cell. A due
     span that does not fit stays due and waits for the next cell that can take
     it, which is how the rhythm absorbs the geometry instead of fighting it. */
  let heroDueIn = 0;
  let wideDueIn = drawInt(random, WIDE_OPENING_GAP);
  let sinceWide = WIDE_HOLDOFF;

  for (let index = 0; index < count; index += 1) {
    /* Fill the current row before touching the next: a hero that filled the
       row it started in pushes the cursor into the row below, whose leading
       tracks are already spoken for. */
    while (col >= tracks) {
      col = carried;
      carried = 0;
    }

    let kind: CellSpanKind = 'sm';

    if (heroDueIn === 0 && col === 0 && count - 1 - index >= tail) {
      kind = 'hero';
      heroDueIn = drawInt(random, HERO_GAP);
    } else if (
      wideDueIn === 0 &&
      sinceWide >= WIDE_HOLDOFF &&
      tracks >= MIN_WIDE_COLUMNS &&
      col + FOOTPRINTS.wide.columns <= tracks
    ) {
      kind = 'wide';
      wideDueIn = drawInt(random, WIDE_GAP);
    }

    spans.push(kind);

    const footprint = FOOTPRINTS[kind];
    col += footprint.columns;

    if (footprint.rows > 1) {
      /* Only a hero spans rows, and only from column 0 — the rule that keeps the
         row below it full — so its width is where the next row starts. */
      carried = footprint.columns;
    }

    if (kind !== 'hero') {
      heroDueIn = Math.max(heroDueIn - 1, 0);
    }

    if (kind === 'wide') {
      wideDueIn = drawInt(random, WIDE_GAP);
      sinceWide = 0;
    } else {
      wideDueIn = Math.max(wideDueIn - 1, 0);
      sinceWide += 1;
    }
  }

  return spans;
}
