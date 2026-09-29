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
 * The grid is filled the way a browser fills it — sparse, in reading order,
 * never `dense`, because dense backfills holes out of order and the viewer
 * navigates `items[index]`. Two consequences of that model shape everything:
 *
 *   - a wide (2x1) tile may start on any column that still has two tracks left;
 *   - a hero (2x2) may only start on column 0 of a fresh row, because the two
 *     tracks above its second row would otherwise stay empty. A hole reads as
 *     a bug, never as breathing room.
 *
 * So the spans are scheduled rather than demanded: a hero becomes *due* every
 * few items and is placed at the first column 0 that follows, a wide becomes
 * due on a longer beat and lands on the first pair of tracks that fits, and a
 * hero near the end of the set is skipped unless enough items remain to fill
 * both of the rows it spans. Nothing that would not fit is ever asked for, so
 * downgrades fall out of the geometry instead of being special-cased.
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
 * Items between heroes, cycled so the beat never repeats exactly and the eye
 * cannot count it. After a hero spans two rows its own pair of tracks pushes the
 * next column 0 out by roughly `2 * columns - 3` items, so these beats land
 * inside what the geometry allows at every column count the grid uses.
 */
const HERO_BEATS: readonly number[] = [6, 8, 7, 9];

/**
 * Items between wide tiles — a longer beat than the heroes, so roughly one wide
 * per hero and never two in a row. The spread keeps short column counts from
 * starving on heroes or drowning on banners.
 */
const WIDE_BEATS: readonly number[] = [11, 9, 13, 8];

/** The opening hero already sets the tone; the first wide waits for its beat. */
const WIDE_OPENING_BEAT = 4;

/**
 * Items a hero spans that sit outside it: two tracks at its column 0, in each of
 * the two rows it covers. Without this many items behind it the mosaic would
 * end on a hero floating over an empty strip.
 */
function heroTailNeed(columns: number): number {
  return (columns - FOOTPRINTS.hero.columns) * FOOTPRINTS.hero.rows;
}

function nextBeat(beats: readonly number[], turn: number): number {
  return beats[turn % beats.length];
}

/**
 * Span per cell for a mosaic of `count` cells laid out in `columns` tracks.
 *
 * Order is the array's: cell `i` is item `i`, so what the viewer walks and what
 * the eye reads are the same sequence. A non-positive count gives no cells, and
 * fewer than two tracks (or a count the DOM could not measure) gives the plain
 * square wall.
 */
export function computeCellSpans(count: number, columns: number): CellSpanKind[] {
  const spans: CellSpanKind[] = [];
  const tracks = Number.isFinite(columns) ? Math.floor(columns) : 1;

  if (count <= 0 || tracks < MIN_SPAN_COLUMNS) {
    for (let index = 0; index < count; index += 1) {
      spans.push('sm');
    }

    return spans;
  }

  /* Cursor over the tracks of the current row, and how many of them the row
     below already starts with — a hero speaks for the same two columns in both
     of the rows it spans, so the row under it starts past them. */
  let col = 0;
  let carried = 0;
  /* Countdown to the next span being due: zero means it wants this cell. A due
     span that does not fit stays due and waits for the next cell that can take
     it, which is how the rhythm absorbs the geometry instead of fighting it. */
  let heroDueIn = 0;
  let wideDueIn = WIDE_OPENING_BEAT;
  let heroTurn = 0;
  let wideTurn = 0;

  for (let index = 0; index < count; index += 1) {
    /* Fill the current row before touching the next: a hero that filled the
       row it started in pushes the cursor into the row below, whose leading
       tracks are already spoken for. */
    while (col >= tracks) {
      col = carried;
      carried = 0;
    }

    let kind: CellSpanKind = 'sm';

    if (heroDueIn === 0 && col === 0 && count - 1 - index >= heroTailNeed(tracks)) {
      kind = 'hero';
      heroTurn += 1;
      heroDueIn = nextBeat(HERO_BEATS, heroTurn - 1);
    } else if (
      wideDueIn === 0 &&
      tracks >= MIN_WIDE_COLUMNS &&
      col + FOOTPRINTS.wide.columns <= tracks
    ) {
      kind = 'wide';
      wideTurn += 1;
      wideDueIn = nextBeat(WIDE_BEATS, wideTurn - 1);
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

    if (kind !== 'wide') {
      wideDueIn = Math.max(wideDueIn - 1, 0);
    }
  }

  return spans;
}
