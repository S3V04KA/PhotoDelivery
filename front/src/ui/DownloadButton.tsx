import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { DEFAULT_QUALITY, type DownloadQuality } from '../lib/download';
import { CheckIcon, ChevronDownIcon, DownloadIcon } from './icons';

interface QualityChoice {
  readonly quality: DownloadQuality;
  readonly label: string;
}

/** Reading order of the menu; «Сжатое» is the default and carries the check. */
const QUALITY_CHOICES: readonly QualityChoice[] = [
  { quality: 'original', label: 'Оригинал' },
  { quality: 'compressed', label: 'Сжатое' },
];

/** Where focus lands on open: the very option the main button downloads. */
function defaultChoiceIndex(): number {
  const index = QUALITY_CHOICES.findIndex((choice) => choice.quality === DEFAULT_QUALITY);

  return index === -1 ? 0 : index;
}

const DEFAULT_CHOICE_INDEX = defaultChoiceIndex();

interface DownloadButtonProps {
  readonly onDownload: (quality: DownloadQuality) => void;
  /** The host's own layout slot, e.g. `appbar__action`. */
  readonly className?: string;
  readonly disabled?: boolean;
  /** Name of the whole control, e.g. «Скачать альбом целиком». */
  readonly ariaLabel?: string;
}

/**
 * One control with two gestures. The long half downloads straight away at
 * `DEFAULT_QUALITY`; the chevron half opens a menu for the other one. Choosing
 * an option downloads too, so the menu is a shortcut, never a confirmation
 * step in front of a single archive.
 */
export function DownloadButton({
  onDownload,
  className,
  disabled = false,
  ariaLabel,
}: DownloadButtonProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusOption = (index: number) => {
    const total = QUALITY_CHOICES.length;
    itemRefs.current[(((index % total) + total) % total)]?.focus();
  };

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);

    if (returnFocus) {
      toggleRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (open) {
      focusOption(DEFAULT_CHOICE_INDEX);
    }
  }, [open]);

  useEffect(() => {
    const root = rootRef.current;

    if (root === null) {
      return;
    }

    /*
     * A native listener, not a React one, because Escape has to die here: the
     * viewer closes itself on a document-level Escape, and only a listener
     * below `document` can stop that from firing behind the menu.
     */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Closed, the menu has no say: Esc belongs to the page again.
        if (!open) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }

      if (!open || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const active = itemRefs.current.findIndex((node) => node === document.activeElement);
      focusOption(active + (event.key === 'ArrowDown' ? 1 : -1));
    };

    root.addEventListener('keydown', handleKeyDown);

    return () => {
      root.removeEventListener('keydown', handleKeyDown);
    };
  }, [close, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        close(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [close, open]);

  return (
    <div
      className={className === undefined ? 'dl-split' : `dl-split ${className}`}
      ref={rootRef}
      data-disabled={disabled}
    >
      <button
        className="dl-split__btn dl-split__main"
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => {
          // No focus restore: the main button keeps the focus it already had.
          if (open) {
            close(false);
          }

          onDownload(DEFAULT_QUALITY);
        }}
      >
        <DownloadIcon className="icon" />
        <span>Скачать</span>
      </button>

      <button
        className="dl-split__btn dl-split__toggle"
        type="button"
        ref={toggleRef}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={open ? 'Скрыть варианты качества' : 'Выбрать качество загрузки'}
        onClick={() => {
          setOpen((isOpen) => !isOpen);
        }}
      >
        <ChevronDownIcon className="icon" />
      </button>

      {open && (
        <div className="dl-split__menu" id={menuId} role="menu" aria-label="Качество загрузки">
          {QUALITY_CHOICES.map((choice, index) => {
            const checked = choice.quality === DEFAULT_QUALITY;

            return (
              <button
                className="dl-split__option"
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                key={choice.quality}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                onClick={() => {
                  onDownload(choice.quality);
                  close(true);
                }}
              >
                <span className="dl-split__option-label">{choice.label}</span>
                <span className="dl-split__check" aria-hidden="true">
                  {checked && <CheckIcon className="icon icon--sm" />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
