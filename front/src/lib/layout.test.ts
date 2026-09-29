import { describe, expect, it } from 'vitest';

import { computeCellSpans, type CellSpanKind } from './layout';

/*
 * Placement oracle.
 *
 * The mosaic is only worth anything if the cells it asks for are the cells CSS
 * grid would hand out: sparse auto-placement, row-major, first free slot at or
 * after the cursor — never `dense`, which backfills holes out of order and
 * would desync the viewer from what the eye reads. So the oracle below
 * re-implements that walk from the placement rules instead of reusing the
 * module's cursor: when the two agree, the grid really fills the way the layout
 * says it does, and a hole would have to be agreed upon twice to slip through.
 */

interface Footprint {
  readonly columns: number;
  readonly rows: number;
}

const FOOTPRINTS: Readonly<Record<CellSpanKind, Footprint>> = {
  sm: { columns: 1, rows: 1 },
  wide: { columns: 2, rows: 1 },
  hero: { columns: 2, rows: 2 },
};

interface Placement {
  readonly row: number;
  readonly column: number;
  readonly columns: number;
  readonly rows: number;
}

/** Cursor budget before the walk is declared stuck; the tests then fail loudly. */
const STEP_LIMIT = 512;

function place(kinds: readonly CellSpanKind[], columns: number): readonly Placement[] {
  const taken = new Set<string>();
  const placements: Placement[] = [];
  let row = 0;
  let column = 0;

  for (const kind of kinds) {
    const footprint = FOOTPRINTS[kind];
    let steps = 0;

    for (; steps < STEP_LIMIT; steps += 1) {
      let free = column + footprint.columns <= columns;

      for (let r = 0; free && r < footprint.rows; r += 1) {
        for (let c = 0; free && c < footprint.columns; c += 1) {
          free = !taken.has(`${row + r}:${column + c}`);
        }
      }

      if (free) {
        break;
      }

      column += 1;

      if (column >= columns) {
        column = 0;
        row += 1;
      }
    }

    if (steps === STEP_LIMIT) {
      return placements;
    }

    for (let r = 0; r < footprint.rows; r += 1) {
      for (let c = 0; c < footprint.columns; c += 1) {
        taken.add(`${row + r}:${column + c}`);
      }
    }

    placements.push({ row, column, columns: footprint.columns, rows: footprint.rows });

    column += footprint.columns;

    if (column >= columns) {
      column = 0;
      row += 1;
    }
  }

  return placements;
}

/** Every row the mosaic touches, with the columns its cells cover. */
function occupiedRows(placements: readonly Placement[]): Map<number, Set<number>> {
  const rows = new Map<number, Set<number>>();

  for (const placement of placements) {
    for (let r = 0; r < placement.rows; r += 1) {
      const row = placement.row + r;
      const cells = rows.get(row) ?? new Set<number>();

      for (let c = 0; c < placement.columns; c += 1) {
        cells.add(placement.column + c);
      }

      rows.set(row, cells);
    }
  }

  return rows;
}

/** Everything wrong with this mosaic, so a failure names the exact cell. */
function defects(
  count: number,
  columns: number,
  kinds: readonly CellSpanKind[],
): readonly string[] {
  const problems: string[] = [];

  if (kinds.length !== count) {
    return [`${count} элементов, а спанов ${kinds.length}`];
  }

  const placements = place(kinds, columns);

  if (placements.length !== count) {
    return [`размещение застряло на ${placements.length} из ${count}`];
  }

  placements.forEach((placement, index) => {
    if (placement.column + placement.columns > columns) {
      problems.push(`ячейка ${index} (${kinds[index]}) шириной ${placement.columns} с колонки ${placement.column}`);
    }
  });

  const rows = occupiedRows(placements);
  const lastRow = Math.max(0, ...rows.keys());

  for (const [row, cells] of rows) {
    /* The very last row may end short — a grid of n items is only ever full when
       n is a multiple of the columns. Any other row is not allowed the excuse:
       a gap there is a hole in the middle of the mosaic. */
    if (row === lastRow) {
      continue;
    }

    for (let column = 0; column < columns; column += 1) {
      if (!cells.has(column)) {
        problems.push(`ряд ${row}: пусто в колонке ${column}`);
      }
    }
  }

  return problems;
}

const GRID_COLUMNS: readonly number[] = [2, 3, 4, 5, 6];
const GRID_COUNTS: readonly number[] = Array.from({ length: 61 }, (_, count) => count);

describe('computeCellSpans', () => {
  it('возвращает ровно один спан на элемент', () => {
    for (const columns of [0, 1, 2, 3, 4, 5, 6, 12]) {
      for (const count of GRID_COUNTS) {
        expect(computeCellSpans(count, columns)).toHaveLength(count);
      }
    }
  });

  it('не оставляет дырок: каждая строка, кроме последней, забита целиком', () => {
    for (const columns of GRID_COLUMNS) {
      for (const count of GRID_COUNTS) {
        const problems = defects(count, columns, computeCellSpans(count, columns));

        expect(problems, `${count} элементов в ${columns} колонки`).toEqual([]);
      }
    }
  });

  it('никогда не просит спан шире строки', () => {
    // The oracle places what it is given, so a wide tile that could never fit
    // shows up as a cell the walk had to nudge past a row end.
    for (const columns of GRID_COLUMNS) {
      for (const count of GRID_COUNTS) {
        const spans = computeCellSpans(count, columns);
        const placements = place(spans, columns);

        expect(placements).toHaveLength(count);
        expect(placements.every((one) => one.column + one.columns <= columns)).toBe(true);
      }
    }
  });

  it('одинаковый вход даёт одинаковый выход', () => {
    for (const columns of GRID_COLUMNS) {
      for (const count of [0, 1, 5, 12, 13, 29, 60]) {
        expect(computeCellSpans(count, columns)).toEqual(computeCellSpans(count, columns));
      }
    }
  });

  it('на одной колонке (и на нулевой) оставляет только квадраты', () => {
    for (const columns of [-3, 0, 0.5, 1, 1.9]) {
      const spans = computeCellSpans(40, columns);

      expect(spans).toHaveLength(40);
      expect(spans.every((span) => span === 'sm')).toBe(true);
    }
  });

  it('открывает сетку героем — ритм должен читаться с первой плитки', () => {
    // Сеты короче хвоста героя остаются квадратами — ему не хватило бы соседей.
    for (const columns of GRID_COLUMNS) {
      for (const count of [12, 29, 60]) {
        expect(computeCellSpans(count, columns)[0], `${count} в ${columns}`).toBe('hero');
      }
    }
  });

  it('не ставит героя впритык к следующему', () => {
    for (const columns of GRID_COLUMNS) {
      const spans = computeCellSpans(60, columns);
      let sinceHero = 0;

      spans.forEach((span, index) => {
        if (index > 0) {
          expect(
            span === 'hero' && sinceHero < 4,
            `герой на ${index}, прошлый был ${sinceHero} назад (${columns} колонок)`,
          ).toBe(false);

          sinceHero = span === 'hero' ? 0 : sinceHero + 1;
        }
      });
    }
  });

  it('не превращает телефонную сетку в ленту баннеров', () => {
    for (const count of GRID_COUNTS) {
      expect(computeCellSpans(count, 1).includes('wide')).toBe(false);
      expect(computeCellSpans(count, 2).includes('wide')).toBe(false);
    }
  });

  it('не ставит две широкие плитки подряд', () => {
    for (const columns of [3, 4, 5, 6]) {
      const spans = computeCellSpans(120, columns);

      spans.forEach((span, index) => {
        if (span !== 'wide') {
          return;
        }

        expect(spans[index - 1], `две широкие подряд на ${index}`).not.toBe('wide');
        expect(spans[index + 1], `две широкие подряд на ${index}`).not.toBe('wide');
      });
    }
  });

  it('держит мозаику воздушной: герои и широкие — меньше трети плиток', () => {
    for (const columns of GRID_COLUMNS) {
      const spans = computeCellSpans(120, columns);
      const large = spans.filter((span) => span !== 'sm').length;

      expect(large, `${columns} колонок`).toBeGreaterThan(6);
      expect(large / spans.length, `${columns} колонок`).toBeLessThan(1 / 3);
    }
  });

  it('заканчивает сетку без висящего героя над пустой полосой', () => {
    for (const columns of GRID_COLUMNS) {
      for (const count of GRID_COUNTS) {
        const spans = computeCellSpans(count, columns);
        const tail = (columns - FOOTPRINTS.hero.columns) * FOOTPRINTS.hero.rows;
        const lastHero = spans.lastIndexOf('hero');

        if (lastHero >= 0) {
          expect(count - 1 - lastHero, `герой на ${lastHero} из ${count} в ${columns}`).toBeGreaterThanOrEqual(tail);
        }
      }
    }
  });
});
