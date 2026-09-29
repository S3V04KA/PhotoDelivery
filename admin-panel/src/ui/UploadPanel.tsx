import { useCallback, useRef, useState } from 'react';

import { errorMessage, isUnauthorized, uploadFile, type SetSummary, type ThumbStatus } from '../api';
import {
  formatBytes,
  formatErrorCount,
  formatFileCount,
  truncateMiddle,
} from '../lib/format';
import { runPool } from '../lib/pool';
import { kindLabel, mediaKind, validateSetId, type MediaKind } from '../lib/validate';
import { Dropzone } from './Dropzone';
import { ProgressBar } from './ProgressBar';
import { SetPicker } from './SetPicker';
import type { SnackbarTone } from './Snackbar';
import {
  CheckIcon,
  CloseIcon,
  DescriptionIcon,
  ErrorIcon,
  ImageIcon,
  MovieIcon,
  UploadCloudIcon,
} from './icons';

type RowStatus = 'queued' | 'uploading' | 'done' | 'error' | 'skipped';

interface QueueRow {
  readonly id: number;
  readonly file: File;
  readonly name: string;
  readonly size: number;
  readonly kind: MediaKind;
  readonly supported: boolean;
  readonly status: RowStatus;
  readonly percent: number;
  readonly error: string | null;
  readonly thumb: ThumbStatus;
}

interface UploadSummary {
  readonly done: number;
  readonly failed: number;
  readonly skipped: number;
}

interface UploadPanelProps {
  readonly sets: readonly SetSummary[];
  readonly setId: string;
  readonly onSetIdChange: (value: string) => void;
  readonly onUploaded: () => void;
  readonly onSessionExpired: () => void;
  readonly notify: (message: string, tone?: SnackbarTone) => void;
}

const NOTHING_PENDING = 'Нечего загружать: добавьте файлы';
const INTERRUPTED = 'Загрузка прервана';
const PREVIEW_OK_NOTE = 'предпросмотр: ок';
const UPLOAD_CONCURRENCY = 4;

function kindIcon(kind: MediaKind) {
  if (kind === 'image') {
    return <ImageIcon className="icon" />;
  }

  if (kind === 'video') {
    return <MovieIcon className="icon" />;
  }

  return <DescriptionIcon className="icon" />;
}

function thumbNote(thumb: ThumbStatus): string | null {
  if (thumb === 'ok') {
    return PREVIEW_OK_NOTE;
  }

  if (thumb === 'failed') {
    return 'файл загружен, превью не создалось';
  }

  if (thumb === 'skipped') {
    return 'файл загружен, превью пропущено';
  }

  return null;
}

interface QueueItemProps {
  readonly row: QueueRow;
  readonly busy: boolean;
  readonly onRemove: (id: number) => void;
}

function QueueItem({ row, busy, onRemove }: QueueItemProps) {
  const note = row.status === 'done' ? thumbNote(row.thumb) : null;

  return (
    <li className="queue__row" data-status={row.status}>
      <span className="queue__icon" aria-hidden="true">
        {kindIcon(row.kind)}
      </span>

      <span className="queue__meta">
        <span className="queue__name" title={row.name}>
          {truncateMiddle(row.name, 40)}
        </span>
        <span className="queue__size">
          {formatBytes(row.size)} · {kindLabel(row.kind)}
        </span>
      </span>

      <span className="queue__status">
        {row.status === 'queued' && <span className="chip">в очереди</span>}

        {row.status === 'uploading' && (
          <span className="chip chip--primary">загрузка {row.percent}%</span>
        )}

        {row.status === 'done' && (
          <span className="chip chip--ok">
            <CheckIcon className="icon" />
            готово
          </span>
        )}

        {row.status === 'error' && (
          <span className="chip chip--error">
            <ErrorIcon className="icon" />
            ошибка
          </span>
        )}

        {row.status === 'skipped' && <span className="chip">формат не поддерживается</span>}

        <button
          className="icon-btn icon-btn--sm"
          type="button"
          aria-label={`Убрать ${row.name} из очереди`}
          disabled={busy || row.status === 'uploading'}
          onClick={() => {
            onRemove(row.id);
          }}
        >
          <CloseIcon className="icon icon--sm" />
        </button>
      </span>

      {row.status === 'uploading' && (
        <span className="queue__bar">
          <ProgressBar percent={row.percent} label={`Загрузка ${row.name}`} />
        </span>
      )}

      {row.status === 'done' && (
        <span className="queue__bar">
          <ProgressBar percent={100} tone="ok" label={`${row.name} загружен`} />
        </span>
      )}

      {row.status === 'error' && row.percent > 0 && (
        <span className="queue__bar">
          <ProgressBar percent={row.percent} tone="error" label={`${row.name} — ошибка загрузки`} />
        </span>
      )}

      {row.status === 'error' && <span className="queue__note queue__note--error">{row.error}</span>}

      {row.status === 'done' && note !== null && (
        <span className={note === PREVIEW_OK_NOTE ? 'queue__note queue__note--ok' : 'queue__note'}>
          {note}
        </span>
      )}
    </li>
  );
}

export function UploadPanel({
  sets,
  setId,
  onSetIdChange,
  onUploaded,
  onSessionExpired,
  notify,
}: UploadPanelProps) {
  const [rows, setRows] = useState<readonly QueueRow[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [setIdError, setSetIdError] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const nextId = useRef(1);

  const patch = useCallback((id: number, changes: Partial<QueueRow>): void => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...changes } : row)));
  }, []);

  const addFiles = useCallback((files: readonly File[]): void => {
    setSummary(null);

    setRows((current) => {
      const next = [...current];

      for (const file of files) {
        const kind = mediaKind(file.name);
        const supported = kind !== 'other';
        const key = `${file.name}:${file.size}`;
        const duplicate = next.findIndex(
          (row) => `${row.name}:${row.file.size}` === key && row.status !== 'uploading',
        );
        const row: QueueRow = {
          id: nextId.current,
          file,
          name: file.name,
          size: file.size,
          kind,
          supported,
          status: supported ? 'queued' : 'skipped',
          percent: 0,
          error: null,
          thumb: 'unknown',
        };

        nextId.current += 1;

        if (duplicate >= 0) {
          next[duplicate] = row;
        } else {
          next.push(row);
        }
      }

      return next;
    });
  }, []);

  const pending = rows.filter((row) => row.supported && row.status !== 'done');
  const hasSetId = validateSetId(setId).ok;

  const run = async (): Promise<void> => {
    if (running) {
      return;
    }

    const check = validateSetId(setId);

    if (!check.ok) {
      setSetIdError(check.error);
      notify(check.error, 'error');
      return;
    }

    if (pending.length === 0) {
      notify(NOTHING_PENDING, 'error');
      return;
    }

    const queue = [...pending];
    const skipped = rows.length - rows.filter((row) => row.supported).length;

    setSetIdError(null);
    setRunning(true);
    setSummary(null);

    let done = 0;
    let failed = 0;
    let expired = false;

    await runPool(queue, UPLOAD_CONCURRENCY, async (row) => {
      if (expired) {
        return;
      }

      patch(row.id, { status: 'uploading', percent: 0, error: null, thumb: 'unknown' });

      try {
        const outcome = await uploadFile({
          setId: check.value,
          file: row.file,
          onProgress: (percent) => {
            patch(row.id, { percent });
          },
        });

        const entry =
          outcome.results.find((result) => result.name === row.name) ?? outcome.results[0];

        if (entry === undefined || !entry.ok) {
          failed += 1;
          patch(row.id, { status: 'error', error: entry?.error ?? 'Файл не загружен' });
          return;
        }

        done += 1;
        patch(row.id, { status: 'done', percent: 100, thumb: entry.thumb, error: null });
      } catch (failure) {
        if (isUnauthorized(failure)) {
          if (!expired) {
            expired = true;
            setRunning(false);
            onSessionExpired();
          }

          return;
        }

        failed += 1;
        patch(row.id, { status: 'error', error: errorMessage(failure, 'Файл не загружен') });
      }
    });

    setRunning(false);

    if (expired) {
      return;
    }

    setSummary({ done, failed, skipped });

    if (done > 0) {
      onUploaded();
    }

    notify(
      `Загружено ${formatFileCount(done)}, ошибок: ${formatErrorCount(failed)}`,
      failed > 0 ? 'error' : 'ok',
    );
  };

  const startOver = (): void => {
    setRows([]);
    setSummary(null);
    setFocusToken((token) => token + 1);
  };

  return (
    <div className="panel" id="panel-upload" role="tabpanel" aria-labelledby="tab-upload">
      <section className="panel__section">
        <h2 className="section__title">
          <UploadCloudIcon className="icon" />
          Куда загружаем
        </h2>
        <SetPicker
          sets={sets}
          value={setId}
          onChange={(value) => {
            onSetIdChange(value);
            setSetIdError(null);
          }}
          error={setIdError}
          disabled={running}
        />
      </section>

      <section className="panel__section">
        <h2 className="section__title">
          <UploadCloudIcon className="icon" />
          Файлы
        </h2>
        <Dropzone disabled={running} onFiles={addFiles} focusToken={focusToken} />
        <p className="section__hint">
          Поддерживаются JPG, PNG, GIF, WebP, AVIF, BMP, TIFF, HEIC и MP4, WebM, MOV, M4V, OGV, MKV,
          AVI. Остальные форматы отмечаются в очереди и не отправляются на сервер.
        </p>
      </section>

      {rows.length === 0 ? (
        <p className="queue__empty">
          Очередь пуста. Выберите фотосет и добавьте файлы — здесь появится список с прогрессом.
        </p>
      ) : (
        <section className="panel__section">
          <h2 className="section__title">
            <UploadCloudIcon className="icon" />
            Очередь
            <span className="chip">{formatFileCount(rows.length)}</span>
          </h2>

          <ul className="queue">
            {rows.map((row) => (
              <QueueItem
                key={row.id}
                row={row}
                busy={running}
                onRemove={(id) => {
                  setRows((current) => current.filter((item) => item.id !== id));
                }}
              />
            ))}
          </ul>

          <div className="upload__actions">
            <button
              className="btn btn--filled"
              type="button"
              disabled={running || pending.length === 0 || !hasSetId}
              onClick={() => {
                void run().catch(() => {
                  setRunning(false);
                  notify(INTERRUPTED, 'error');
                });
              }}
            >
              {running && <span className="spinner" aria-hidden="true" />}
              {running
                ? 'Загружаем…'
                : pending.length === 0
                  ? 'Всё загружено'
                  : `Загрузить ${formatFileCount(pending.length)}`}
            </button>
            <button
              className="btn btn--outlined btn--compact"
              type="button"
              disabled={running || rows.length === 0}
              onClick={startOver}
            >
              Очистить очередь
            </button>
          </div>

          {!hasSetId && <p className="section__hint">Укажите ID фотосета, чтобы начать загрузку.</p>}

          {summary !== null && (
            <div className="summary">
              <span className="summary__text">
                Загружено {formatFileCount(summary.done)}, ошибок: {formatErrorCount(summary.failed)}
                {summary.skipped > 0 ? `, пропущено ${formatFileCount(summary.skipped)}` : ''}
              </span>
              <span className="summary__actions">
                <button className="btn btn--tonal btn--compact" type="button" onClick={startOver}>
                  Загрузить ещё
                </button>
              </span>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
