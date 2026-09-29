import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';

import { fileUrl, triggerDownload, type DownloadQuality } from '../lib/download';
import { viewerImageCandidates } from '../lib/media';
import type { MediaItem } from '../lib/types';
import { DownloadButton } from './DownloadButton';
import { BrokenImageIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './icons';
import '../styles/viewer.css';

/** Horizontal travel, in px, that counts as a swipe. */
const SWIPE_THRESHOLD_PX = 50;
const FOCUSABLE = 'button:not([disabled])';

type SlideState = 'loading' | 'ready' | 'broken';

interface ViewerProps {
  readonly setId: string;
  readonly items: readonly MediaItem[];
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  readonly onClose: () => void;
}

interface ImageSlideProps {
  readonly item: MediaItem;
  readonly onSlideChange: (state: SlideState) => void;
}

/**
 * One image slide, owning its own fallback chain: `key={item.key}` remounts it
 * on every item change, so a slide never starts from a stale candidate. The
 * last failing candidate is final and the overlay reports it.
 */
function ImageSlide({ item, onSlideChange }: ImageSlideProps) {
  const candidates = useMemo(() => viewerImageCandidates(item), [item]);
  const [step, setStep] = useState(0);
  const source = candidates[step];

  const handleError = useCallback(() => {
    if (step + 1 < candidates.length) {
      onSlideChange('loading');
      setStep(step + 1);
      return;
    }

    onSlideChange('broken');
  }, [candidates.length, onSlideChange, step]);

  return (
    <img
      key={source}
      className="viewer__media"
      src={source}
      alt={item.name}
      decoding="async"
      draggable={false}
      onLoad={() => {
        onSlideChange('ready');
      }}
      onError={handleError}
    />
  );
}

/**
 * Fullscreen viewer for one set. Every control stays inside the set: the arrows
 * cycle its items and the close button returns to the grid it came from.
 */
export default function Viewer({ setId, items, index, onIndexChange, onClose }: ViewerProps) {
  const total = items.length;
  const item: MediaItem | undefined = items[index];
  const rootRef = useRef<HTMLDivElement>(null);
  const lastIndexRef = useRef(index);
  const swipeStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const swipedRef = useRef(false);
  const [slide, setSlide] = useState<SlideState>('loading');

  useEffect(() => {
    lastIndexRef.current = index;
  }, [index]);

  useEffect(() => {
    setSlide('loading');
  }, [index, item?.url]);

  const go = useCallback(
    (delta: number) => {
      if (total === 0) {
        return;
      }

      onIndexChange((index + delta + total) % total);
    },
    [index, onIndexChange, total],
  );

  /* Focus lands on the dialog itself, so Enter never fires a stray "close"
     and the arrow keys work immediately. On close, focus goes back to the
     tile the user came from. */
  useLayoutEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const opener = document.activeElement;

    return () => {
      if (opener instanceof HTMLElement && opener !== document.body && document.contains(opener)) {
        opener.focus();
        return;
      }

      document.querySelector<HTMLElement>(`[data-tile-index="${lastIndexRef.current}"]`)?.focus();
    };
  }, []);

  useEffect(() => {
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';

    return () => {
      body.style.overflow = previous;
    };
  }, []);

  const trapFocus = useCallback((event: KeyboardEvent) => {
    const root = rootRef.current;

    if (root === null) {
      return;
    }

    const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable.at(0);
    const last = focusable.at(-1);

    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }

    const active = document.activeElement;
    const inside = root.contains(active);

    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          go(-1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          go(1);
          break;
        case 'Tab':
          trapFocus(event);
          break;
        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [go, onClose, trapFocus]);

  const handleDownload = useCallback(
    (quality: DownloadQuality) => {
      if (item === undefined) {
        return;
      }

      triggerDownload(fileUrl(setId, item.name, quality));
    },
    [item, setId],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // Let the video's own scrubber keep its gestures.
    if (event.target instanceof HTMLMediaElement) {
      return;
    }

    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    swipedRef.current = false;
    swipeStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;

    if (start === null || start.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;

    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }

    swipedRef.current = true;
    go(deltaX < 0 ? 1 : -1);
  };

  const handleStageClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // A swipe also emits a click — ignore that one, so swiping never closes.
    if (swipedRef.current) {
      swipedRef.current = false;
      return;
    }

    // Only the empty area around the media dismisses; the media itself does not.
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (item === undefined) {
    return null;
  }

  const prevItem: MediaItem | undefined = total > 0 ? items[(index - 1 + total) % total] : undefined;
  const nextItem: MediaItem | undefined = total > 0 ? items[(index + 1) % total] : undefined;
  const showNavigation = total > 1;

  return createPortal(
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр фото и видео"
      ref={rootRef}
      tabIndex={-1}
    >
      <div className="viewer__scrim" aria-hidden="true" />

      <div
        className="viewer__stage"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          swipeStartRef.current = null;
        }}
        onDragStart={(event) => {
          event.preventDefault();
        }}
        onClick={handleStageClick}
      >
        {item.kind === 'video' ? (
          <video
            key={item.key}
            className="viewer__media"
            src={item.url}
            poster={item.thumbUrl}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={() => {
              setSlide('ready');
            }}
            onError={() => {
              setSlide('broken');
            }}
          />
        ) : (
          <ImageSlide key={item.key} item={item} onSlideChange={setSlide} />
        )}
      </div>

      {slide !== 'ready' && (
        <div className="viewer__overlay">
          {slide === 'loading' ? (
            <span className="spinner spinner--lg" aria-hidden="true" />
          ) : (
            <p className="viewer__broken" role="status">
              <BrokenImageIcon className="icon icon--lg" />
              Не удалось загрузить файл
              <span className="viewer__broken-name" title={item.name}>
                {item.name}
              </span>
            </p>
          )}
        </div>
      )}

      <div className="viewer__top">
        <button className="icon-btn" type="button" onClick={onClose} aria-label="Закрыть">
          <CloseIcon className="icon" />
        </button>
        <DownloadButton onDownload={handleDownload} ariaLabel="Скачать файл" />
      </div>

      {showNavigation && (
        <>
          <button
            className="icon-btn viewer__nav viewer__nav--start"
            type="button"
            onClick={() => {
              go(-1);
            }}
            aria-label="Предыдущее"
          >
            <ChevronLeftIcon className="icon" />
          </button>
          <button
            className="icon-btn viewer__nav viewer__nav--end"
            type="button"
            onClick={() => {
              go(1);
            }}
            aria-label="Следующее"
          >
            <ChevronRightIcon className="icon" />
          </button>
        </>
      )}

      <div className="viewer__caption">
        <span className="viewer__index" aria-live="polite">
          {index + 1} / {total}
        </span>
        <span className="viewer__name" title={item.name}>
          {item.name}
        </span>
      </div>

      <div className="viewer__preload" aria-hidden="true">
        {prevItem?.kind === 'image' && <img src={prevItem.thumbUrl} alt="" decoding="async" />}
        {nextItem?.kind === 'image' && <img src={nextItem.thumbUrl} alt="" decoding="async" />}
      </div>
    </div>,
    document.body,
  );
}
