import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { gridImageCandidates } from '../lib/media';
import type { MediaItem } from '../lib/types';
import { BrokenImageIcon, CheckIcon, PlayIcon } from './icons';

/**
 * The first screenful is fetched at high priority; everything after it is
 * lazy so a set with thousands of items costs almost nothing up front.
 */
const EAGER_TILE_COUNT = 6;

/** How far outside the viewport a cell fills itself in, in CSS pixels. */
const MOUNT_MARGIN_PX = 600;

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

/**
 * Nothing to defer against without IntersectionObserver (tests, exotic
 * embeds), so those environments keep the eager grid they always had.
 */
const CAN_OBSERVE = typeof IntersectionObserver !== 'undefined';

/* --------------------------------------------------------------------------
   Deferred mounting

   A tile is a component with a handful of hooks and half a dozen nodes, so a
   set of a thousand items used to mount a thousand of them on first paint. The
   cell stays in the DOM from the start — same tag, same class, same order, so
   reading order, the nth-child arrival stagger and the grid geometry are
   untouched — and only the tile inside it is deferred until the cell nears the
   viewport.

   One observer serves the whole grid: a cell's effect runs before the grid's,
   so the observer cannot live in a useRef up here, and one instance per cell
   would cost more than the deferral saves.
   -------------------------------------------------------------------------- */

let gridObserver: IntersectionObserver | null = null;
const pendingCells = new Map<Element, () => void>();
let gridHolders = 0;

function handleNear(entries: readonly IntersectionObserverEntry[], source: IntersectionObserver): void {
  for (const entry of entries) {
    if (!entry.isIntersecting) {
      continue;
    }

    const onNear = pendingCells.get(entry.target);

    if (onNear === undefined) {
      continue;
    }

    /* Entries arrive as one batch, so a screenful of cells flips together in a
       single render; and once a cell has its tile, the effect below does not
       run again, so this unobserve is what ends its watch. */
    pendingCells.delete(entry.target);
    source.unobserve(entry.target);
    onNear();
  }
}

function createGridObserver(): IntersectionObserver {
  const created = new IntersectionObserver(handleNear, {
    rootMargin: `${MOUNT_MARGIN_PX}px 0px`,
  });

  gridObserver = created;

  return created;
}

/**
 * Reference counted, so StrictMode's double effect run is a no-op: the second
 * pass re-acquires what the first released, and an unmounted grid leaves no
 * observer, no observation and no callback behind.
 */
function releaseGrid(): void {
  gridHolders -= 1;

  if (gridHolders > 0) {
    return;
  }

  pendingCells.clear();
  gridObserver?.disconnect();
  gridObserver = null;
}

function watchCell(cell: HTMLElement, onNear: () => void): () => void {
  const observer = gridObserver ?? createGridObserver();

  pendingCells.set(cell, onNear);
  observer.observe(cell);

  return () => {
    pendingCells.delete(cell);
    observer.unobserve(cell);
  };
}

interface MediaTileProps {
  readonly item: MediaItem;
  readonly index: number;
  readonly onOpen: (index: number) => void;
  readonly selectMode: boolean;
  readonly selected: boolean;
  readonly onToggle: (item: MediaItem) => void;
  readonly onLongPress: (item: MediaItem) => void;
}

const MediaTile = memo(function MediaTile({
  item,
  index,
  onOpen,
  selectMode,
  selected,
  onToggle,
  onLongPress,
}: MediaTileProps) {
  const candidates = useMemo(() => gridImageCandidates(item), [item]);
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  /* A held finger still ends in a click, so the long press arms this flag and
     the click that follows it consumes it — otherwise the viewer would open
     behind the selection panel. */
  const suppressClickRef = useRef(false);

  const isVideo = item.kind === 'video';
  const isPriority = index < EAGER_TILE_COUNT;
  const source = candidates[step];

  const cancelLongPress = useCallback(() => {
    originRef.current = null;

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      cancelLongPress();
      originRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        originRef.current = null;
        suppressClickRef.current = true;
        onLongPress(item);
      }, LONG_PRESS_MS);
    },
    [cancelLongPress, item],
  );

  /* A finger that slides is scrolling, not holding. */
  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      const origin = originRef.current;

      if (origin === null) {
        return;
      }

      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > MOVE_TOLERANCE_PX) {
        cancelLongPress();
      }
    },
    [cancelLongPress],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        onLongPress(item);
        return;
      }

      if (selectMode) {
        onToggle(item);
        return;
      }

      onOpen(index);
    },
    [index, item, onLongPress, onOpen, onToggle, selectMode],
  );

  /*
   * Previews are optional on the bucket, so a tile walks a chain instead of
   * trusting one URL: the preview as stored, then the always-written
   * `thumb/{basename}.jpg`, then the original for images. `step` only ever
   * grows and the chain is deduplicated, so an exhausted tile lands on the
   * placeholder rather than cycling.
   */
  const handleError = useCallback(() => {
    if (step + 1 < candidates.length) {
      setLoaded(false);
      setStep(step + 1);
      return;
    }

    setBroken(true);
  }, [candidates.length, step]);

  return (
    <button
      type="button"
      className="tile"
      data-tile-index={index}
      data-loaded={loaded}
      data-selected={selected}
      aria-pressed={selectMode ? selected : undefined}
      aria-label={selectMode ? `Выбрать: ${item.name}` : `Открыть: ${item.name}`}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onContextMenu={(event) => {
        // Without this, a hold on touch opens the OS context menu.
        event.preventDefault();
      }}
    >
      {/* The sheen is an infinite animation, so a node left behind a loaded
          image would keep the compositor busy for the rest of the session (and
          drag the app bar's backdrop blur along with it). The image fades in
          over the tile background, which is what the skeleton sat on. */}
      {loaded === false && <span className="tile__skeleton" aria-hidden="true" />}

      {broken === false && (
        <img
          key={source}
          className="tile__img"
          src={source}
          alt={item.name}
          width={512}
          height={512}
          loading={isPriority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={isPriority ? 'high' : 'auto'}
          draggable={false}
          onLoad={() => {
            setLoaded(true);
          }}
          onError={handleError}
        />
      )}

      {isVideo && broken === false && (
        <span className="tile__badge" aria-hidden="true">
          <PlayIcon className="icon" />
        </span>
      )}

      {broken && (
        <span
          className={`tile__fallback ${isVideo ? 'tile__fallback--video' : 'tile__fallback--image'}`}
          aria-hidden="true"
        >
          {isVideo ? <PlayIcon className="icon icon--xl" /> : <BrokenImageIcon className="icon icon--lg" />}
        </span>
      )}

      {selectMode && (
        <span className="tile__check" aria-hidden="true">
          {selected && <CheckIcon className="icon icon--sm" />}
        </span>
      )}
    </button>
  );
});

const MediaCell = memo(function MediaCell(props: MediaTileProps) {
  const cellRef = useRef<HTMLLIElement | null>(null);
  const [near, setNear] = useState(CAN_OBSERVE === false || props.index < EAGER_TILE_COUNT);

  useEffect(() => {
    const cell = cellRef.current;

    if (near || cell === null) {
      return;
    }

    return watchCell(cell, () => {
      setNear(true);
    });
  }, [near]);

  /* The cell is the unit of layout, the arrival stagger and the viewer's index
     lookup, so it is a real `.grid__cell` from the first paint. Until the tile
     arrives it holds the same box the tile will occupy — same `.tile` sizing,
     `pointer-events: none` so it cannot eat a click meant for the cell. */
  return (
    <li className="grid__cell" ref={cellRef}>
      {near ? <MediaTile {...props} /> : <div className="tile tile--placeholder" aria-hidden="true" />}
    </li>
  );
});

interface MediaGridProps {
  readonly items: readonly MediaItem[];
  readonly onOpen: (index: number) => void;
  readonly selectMode: boolean;
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (item: MediaItem) => void;
  readonly onLongPress: (item: MediaItem) => void;
}

export function MediaGrid({ items, onOpen, selectMode, selected, onToggle, onLongPress }: MediaGridProps) {
  useEffect(() => {
    gridHolders += 1;

    return releaseGrid;
  }, []);

  return (
    <ul className="grid" data-select-mode={selectMode}>
      {items.map((item, index) => (
        <MediaCell
          key={item.key}
          item={item}
          index={index}
          onOpen={onOpen}
          selectMode={selectMode}
          selected={selected.has(item.key)}
          onToggle={onToggle}
          onLongPress={onLongPress}
        />
      ))}
    </ul>
  );
}

export function SkeletonGrid({ tiles = 12 }: { readonly tiles?: number }) {
  return (
    <>
      <p className="sr-only" role="status">
        Загрузка фотосета…
      </p>
      <ul className="grid" aria-hidden="true">
        {Array.from({ length: tiles }, (_, index) => (
          <li className="grid__cell" key={index}>
            <div className="tile tile--placeholder">
              <span className="tile__skeleton" />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
