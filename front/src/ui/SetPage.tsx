import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';

import { archiveUrl, triggerDownload, type DownloadQuality } from '../lib/download';
import { hashSeed } from '../lib/layout';
import { usePaletteForSet, type PaletteStatus } from '../lib/palette';
import { listMedia } from '../lib/s3';
import { S3Error, SetNotFoundError, type MediaItem } from '../lib/types';
import { DownloadButton } from './DownloadButton';
import { CloseIcon } from './icons';
import { ErrorPanel, EmptyPanel } from './MessagePanel';
import { MediaGrid, SkeletonGrid } from './MediaGrid';
import { formatMediaCount, truncateMiddle } from './plural';
import { ViewerFallback } from './ViewerFallback';

/** The viewer is a separate chunk: nobody pays for it on the root page. */
const Viewer = lazy(() => import('./Viewer'));

interface SetFailure {
  readonly message: string;
  readonly hint: string;
}

type SetState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly items: readonly MediaItem[] }
  | { readonly status: 'error'; readonly failure: SetFailure };

function toSetFailure(error: unknown): SetFailure {
  // Checked first: a missing set is the more specific outcome of the two.
  if (error instanceof SetNotFoundError) {
    return {
      message: 'Фотосет не найден или пуст',
      hint: 'Проверьте ID фотосета — возможно, в ссылке опечатка.',
    };
  }

  if (error instanceof S3Error) {
    return {
      message: error.message,
      hint: 'Не удалось получить файлы из хранилища. Попробуйте ещё раз.',
    };
  }

  if (error instanceof Error && error.message.trim() !== '') {
    return { message: error.message, hint: 'Попробуйте ещё раз.' };
  }

  return { message: 'Не удалось загрузить фотосет', hint: 'Попробуйте ещё раз.' };
}

interface SetPageProps {
  readonly setId: string;
}

const NO_ITEMS: readonly MediaItem[] = [];

/**
 * A set page is a dead end by design: the app bar names the set, the grid
 * opens the viewer, and that is all. There is no link out of the set — only
 * the browser's own back button. Long-pressing a tile switches the app bar
 * into a selection panel, which is the one place the user can act on a group
 * of files at once.
 */
export function SetPage({ setId }: SetPageProps) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SetState>({ status: 'loading' });
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let active = true;

    setState({ status: 'loading' });

    void listMedia(setId).then(
      (items) => {
        if (active) {
          setState({ status: 'ready', items });
        }
      },
      (error: unknown) => {
        if (active) {
          setState({ status: 'error', failure: toSetFailure(error) });
        }
      },
    );

    return () => {
      active = false;
    };
  }, [setId, attempt]);

  const items = state.status === 'ready' ? state.items : NO_ITEMS;
  const paletteStatus: PaletteStatus = state.status;
  /* The mosaic's rhythm is drawn from this, and only from this: one set always
     wears the same face, two sets never look alike, and the skeleton and the
     loaded grid are handed the same draw. */
  const seed = useMemo(() => hashSeed(setId), [setId]);

  usePaletteForSet(setId, items, paletteStatus);

  const handleRetry = useCallback(() => {
    setAttempt((previous) => previous + 1);
  }, []);

  const handleClose = useCallback(() => {
    setViewerIndex(null);
  }, []);

  const selectedNames = useMemo(
    () => items.filter((item) => selected.has(item.key)).map((item) => item.name),
    [items, selected],
  );

  const handleToggle = useCallback((item: MediaItem) => {
    setSelected((previous) => {
      const next = new Set(previous);

      if (!next.delete(item.key)) {
        next.add(item.key);
      }

      return next;
    });
  }, []);

  const handleLongPress = useCallback((item: MediaItem) => {
    setSelectMode(true);
    setSelected((previous) => {
      const next = new Set(previous);
      next.add(item.key);
      return next;
    });
  }, []);

  const exitSelection = useCallback(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, []);

  /* An empty selection has nothing left to act on, so the panel steps aside on
     its own; the explicit cancel button is there for the same job. */
  useEffect(() => {
    if (selected.size === 0) {
      setSelectMode(false);
    }
  }, [selected]);

  const handleDownloadAlbum = useCallback(
    (quality: DownloadQuality) => {
      triggerDownload(archiveUrl(setId, undefined, quality));
    },
    [setId],
  );

  const handleDownloadSelected = useCallback(
    (quality: DownloadQuality) => {
      if (selectedNames.length === 0) {
        return;
      }

      triggerDownload(archiveUrl(setId, selectedNames, quality));
    },
    [selectedNames, setId],
  );

  const title = truncateMiddle(setId);
  const count = state.status === 'ready' ? formatMediaCount(state.items) : '';
  const selectionCount = selected.size;
  const hasItems = state.status === 'ready' && state.items.length > 0;

  return (
    <div className="set">
      {selectMode ? (
        <div className="appbar appbar--select" role="group" aria-label="Выделение файлов">
          <button
            className="icon-btn"
            type="button"
            onClick={exitSelection}
            aria-label="Отменить выделение"
          >
            <CloseIcon className="icon" />
          </button>

          <p className="appbar__title" aria-live="polite">
            Выбрано {selectionCount}
          </p>

          <DownloadButton
            onDownload={handleDownloadSelected}
            disabled={selectionCount === 0}
            ariaLabel="Скачать выбранные файлы"
          />
        </div>
      ) : (
        <header className="appbar">
          <div className="appbar__lead">
            <h1 className="appbar__title" title={setId}>
              {title}
            </h1>
            <p className="appbar__count">{count}</p>
          </div>

          {hasItems && (
            <DownloadButton
              className="appbar__action"
              onDownload={handleDownloadAlbum}
              ariaLabel="Скачать альбом целиком"
            />
          )}
        </header>
      )}

      {state.status === 'loading' && <SkeletonGrid seed={seed} />}

      {state.status === 'error' && (
        <ErrorPanel message={state.failure.message} hint={state.failure.hint} onRetry={handleRetry} />
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <EmptyPanel
          message="В этом фотосете нет файлов"
          hint="Возможно, в нём пока только папка с превью или файлы неподдерживаемых форматов."
          onRetry={handleRetry}
        />
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <>
          <MediaGrid
            items={state.items}
            seed={seed}
            onOpen={setViewerIndex}
            selectMode={selectMode}
            selected={selected}
            onToggle={handleToggle}
            onLongPress={handleLongPress}
          />
          {viewerIndex !== null && (
            <Suspense fallback={<ViewerFallback />}>
              <Viewer
                setId={setId}
                items={state.items}
                index={viewerIndex}
                onIndexChange={setViewerIndex}
                onClose={handleClose}
              />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}
