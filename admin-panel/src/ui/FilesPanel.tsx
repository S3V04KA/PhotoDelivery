import { useCallback, useEffect, useState } from 'react';

import {
  deleteFile,
  deleteSet,
  errorMessage,
  isUnauthorized,
  listFiles,
  type SetFile,
  type SetSummary,
} from '../api';
import { formatBytes, formatDateTime, formatFileCount, formatSetCount, truncateMiddle } from '../lib/format';
import { usePaletteForFiles } from '../lib/palette';
import { kindLabel } from '../lib/validate';
import { ConfirmDialog } from './ConfirmDialog';
import { StateCard } from './StateCard';
import { Thumbnail } from './Thumbnail';
import type { SnackbarTone } from './Snackbar';
import { DeleteIcon, FolderIcon, PhotoLibraryIcon, RefreshIcon } from './icons';

type PaneState = 'loading' | 'ready' | 'error';

type PendingDeletion = { readonly kind: 'file'; readonly name: string } | { readonly kind: 'set' };

interface FilesPanelProps {
  readonly sets: readonly SetSummary[];
  readonly setsState: PaneState;
  readonly setsError: string | null;
  readonly onRefreshSets: () => void;
  /** Инкремент после загрузок: правая панель должна перечитать список файлов. */
  readonly revision: number;
  readonly onSessionExpired: () => void;
  readonly notify: (message: string, tone?: SnackbarTone) => void;
}

export function FilesPanel({
  sets,
  setsState,
  setsError,
  onRefreshSets,
  revision,
  onSessionExpired,
  notify,
}: FilesPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [files, setFiles] = useState<readonly SetFile[] | null>(null);
  const [filesState, setFilesState] = useState<PaneState>('loading');
  const [pending, setPending] = useState<PendingDeletion | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [token, setToken] = useState(0);

  const loadFiles = useCallback(
    (setId: string): void => {
      setFilesState('loading');
      setFiles(null);

      void listFiles(setId).then(
        (loaded) => {
          setFiles(loaded);
          setFilesState('ready');
        },
        (failure: unknown) => {
          if (isUnauthorized(failure)) {
            onSessionExpired();
            return;
          }

          setFilesState('error');
          notify(errorMessage(failure, 'Не удалось загрузить список файлов'), 'error');
        },
      );
    },
    [notify, onSessionExpired],
  );

  useEffect(() => {
    if (selectedId !== null) {
      loadFiles(selectedId);
    }
  }, [selectedId, token, revision, loadFiles]);

  usePaletteForFiles(files, selectedId);

  const reload = (): void => {
    setToken((value) => value + 1);
  };

  const confirmDeletion = async (): Promise<void> => {
    if (pending === null || deleting) {
      return;
    }

    const target = pending;
    setDeleting(true);

    try {
      if (target.kind === 'file' && selectedId !== null) {
        await deleteFile(selectedId, target.name);
        notify('Файл удалён', 'ok');
        reload();
      } else if (target.kind === 'set' && selectedId !== null) {
        await deleteSet(selectedId);
        notify('Сет удалён', 'ok');
        setSelectedId(null);
        setFiles(null);
      }
    } catch (failure) {
      if (isUnauthorized(failure)) {
        setDeleting(false);
        setPending(null);
        onSessionExpired();
        return;
      }

      notify(errorMessage(failure, 'Не удалось удалить'), 'error');
    }

    setDeleting(false);
    setPending(null);
    onRefreshSets();
  };

  const selected = sets.find((set) => set.id === selectedId) ?? null;

  return (
    <div className="panel" id="panel-files" role="tabpanel" aria-labelledby="tab-files">
      <div className="panes">
        <section className="pane" aria-label="Сеты">
          <header className="pane__head">
            <span className="pane__head-text">
              <span className="pane__title">Сеты</span>
              <span className="pane__meta">{formatSetCount(sets.length)}</span>
            </span>
            <button
              className="icon-btn"
              type="button"
              aria-label="Обновить список сетов"
              onClick={onRefreshSets}
            >
              <RefreshIcon className="icon" />
            </button>
          </header>

          {setsState === 'loading' && (
            <div className="pane__body" aria-hidden="true">
              {[0, 1, 2, 3].map((index) => (
                <span className="skeleton pane__skeleton pane__skeleton--set" key={index} />
              ))}
            </div>
          )}

          {setsState === 'error' && (
            <StateCard
              role="alert"
              message="Не удалось получить список сетов"
              hint={setsError}
              action={{ label: 'Повторить', onClick: onRefreshSets }}
            />
          )}

          {setsState === 'ready' && sets.length === 0 && (
            <div className="pane__placeholder">
              <PhotoLibraryIcon className="icon" />
              Сетов пока нет. Загрузите первый фотосет на вкладке «Загрузить».
            </div>
          )}

          {setsState === 'ready' && sets.length > 0 && (
            <div className="pane__body">
              {sets.map((set) => (
                <button
                  className="set-row"
                  key={set.id}
                  type="button"
                  aria-current={set.id === selectedId}
                  onClick={() => {
                    setSelectedId(set.id);
                  }}
                >
                  <span className="set-row__icon" aria-hidden="true">
                    <FolderIcon className="icon icon--sm" />
                  </span>
                  <span className="set-row__text">
                    <span className="set-row__id">{set.id}</span>
                    <span className="set-row__meta">
                      {formatFileCount(set.files)} · {formatBytes(set.size)} ·{' '}
                      {formatDateTime(set.lastModified)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="pane" aria-label="Файлы">
          <header className="pane__head">
            <span className="pane__head-text">
              <span className="pane__title">{selected === null ? 'Файлы' : selected.id}</span>
              <span className="pane__meta">
                {selected === null
                  ? 'Выберите сет слева'
                  : `${formatFileCount(selected.files)} · ${formatBytes(selected.size)}`}
              </span>
            </span>

            <button
              className="btn btn--danger-tonal btn--compact"
              type="button"
              disabled={selected === null || deleting}
              onClick={() => {
                setPending({ kind: 'set' });
              }}
            >
              <DeleteIcon className="icon icon--sm" />
              Удалить сет
            </button>
          </header>

          {selected === null && (
            <div className="pane__placeholder">
              <FolderIcon className="icon" />
              Нажмите на сет, чтобы увидеть его файлы.
            </div>
          )}

          {selected !== null && filesState === 'loading' && (
            <div className="pane__body" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((index) => (
                <span className="skeleton pane__skeleton pane__skeleton--file" key={index} />
              ))}
            </div>
          )}

          {selected !== null && filesState === 'error' && (
            <StateCard
              role="alert"
              message="Не удалось получить файлы"
              hint="Список не загрузился — возможно, сет был удалён."
              action={{
                label: 'Повторить',
                onClick: () => {
                  if (selectedId !== null) {
                    loadFiles(selectedId);
                  }
                },
              }}
            />
          )}

          {selected !== null && filesState === 'ready' && files !== null && files.length === 0 && (
            <div className="pane__placeholder">
              <FolderIcon className="icon" />
              В этом сете пока нет файлов.
            </div>
          )}

          {selected !== null && filesState === 'ready' && files !== null && files.length > 0 && (
            <div className="pane__body pane__body--flat">
              {files.map((file) => (
                <div className="file-row" key={`${selected.id}/${file.name}`}>
                  <Thumbnail setId={selected.id} name={file.name} kind={file.kind} />

                  <span className="file-row__text">
                    <span className="file-row__name" title={file.name}>
                      {truncateMiddle(file.name, 46)}
                    </span>
                    <span className="file-row__meta">
                      {formatBytes(file.size)} · {formatDateTime(file.lastModified)}
                    </span>
                    <span className="file-row__chips">
                      <span
                        className={
                          file.kind === 'image'
                            ? 'chip chip--primary'
                            : file.kind === 'video'
                              ? 'chip chip--accent'
                              : 'chip'
                        }
                      >
                        {kindLabel(file.kind)}
                      </span>
                    </span>
                  </span>

                  <button
                    className="icon-btn icon-btn--danger"
                    type="button"
                    aria-label={`Удалить ${file.name}`}
                    disabled={deleting}
                    onClick={() => {
                      setPending({ kind: 'file', name: file.name });
                    }}
                  >
                    <DeleteIcon className="icon" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={pending !== null}
        busy={deleting}
        title={pending?.kind === 'file' ? 'Удалить файл?' : 'Удалить сет?'}
        body={
          pending?.kind === 'file'
            ? `Файл «${pending.name}» будет удалён из выбранного сета.`
            : `Сет «${selectedId ?? ''}» будет удалён вместе со всеми файлами. Это нельзя отменить.`
        }
        confirmLabel="Удалить"
        onCancel={() => {
          setPending(null);
        }}
        onConfirm={() => {
          void confirmDeletion();
        }}
      />
    </div>
  );
}
