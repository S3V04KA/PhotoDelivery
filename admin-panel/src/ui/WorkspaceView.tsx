import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage, isUnauthorized, listSets, type SetSummary } from '../api';
import { FilesPanel } from './FilesPanel';
import type { SnackbarTone } from './Snackbar';
import { Tabs, type TabItem } from './Tabs';
import { UploadPanel } from './UploadPanel';
import { FolderIcon, LogoutIcon, PhotoLibraryIcon, UploadCloudIcon } from './icons';

type TabId = 'upload' | 'files';
type PaneState = 'loading' | 'ready' | 'error';

const TABS: readonly TabItem<TabId>[] = [
  { id: 'upload', label: 'Загрузить', icon: <UploadCloudIcon className="icon" /> },
  { id: 'files', label: 'Файлы', icon: <FolderIcon className="icon" /> },
];

interface WorkspaceViewProps {
  /** Разрешается в true, когда сессия закрыта и экран сменён. */
  readonly onLogout: () => Promise<boolean>;
  readonly onSessionExpired: () => void;
  readonly notify: (message: string, tone?: SnackbarTone) => void;
}

export function WorkspaceView({ onLogout, onSessionExpired, notify }: WorkspaceViewProps) {
  const [tab, setTab] = useState<TabId>('upload');
  const [sets, setSets] = useState<readonly SetSummary[]>([]);
  const [setsState, setSetsState] = useState<PaneState>('loading');
  const [setsError, setSetsError] = useState<string | null>(null);
  const [setId, setSetId] = useState('');
  const [revision, setRevision] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const knownSets = useRef<readonly SetSummary[]>([]);

  const refreshSets = useCallback((): void => {
    void listSets().then(
      (loaded) => {
        knownSets.current = loaded;
        setSets(loaded);
        setSetsState('ready');
        setSetsError(null);
      },
      (failure: unknown) => {
        if (isUnauthorized(failure)) {
          onSessionExpired();
          return;
        }

        setSetsState(knownSets.current.length === 0 ? 'error' : 'ready');
        setSetsError(errorMessage(failure, 'Не удалось получить список сетов'));
      },
    );
  }, [onSessionExpired]);

  useEffect(() => {
    refreshSets();
  }, [refreshSets]);

  const handleUploaded = (): void => {
    setRevision((value) => value + 1);
    refreshSets();
  };

  return (
    <div className="workspace">
      <header className="appbar">
        <span className="appbar__mark" aria-hidden="true">
          <PhotoLibraryIcon className="icon" />
        </span>

        <span className="appbar__titles">
          <span className="appbar__title">Админ-панель</span>
          <span className="appbar__subtitle">Загрузка и управление фотосетами</span>
        </span>

        <span className="appbar__spacer" />

        <button
          className="btn btn--tonal"
          type="button"
          disabled={loggingOut}
          onClick={() => {
            setLoggingOut(true);

            void onLogout().then((left) => {
              if (!left) {
                setLoggingOut(false);
              }
            });
          }}
        >
          {loggingOut ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <LogoutIcon className="icon" />
          )}
          {loggingOut ? 'Выходим…' : 'Выйти'}
        </button>
      </header>

      <Tabs items={TABS} active={tab} onChange={setTab} label="Разделы админ-панели" />

      {tab === 'upload' ? (
        <UploadPanel
          sets={sets}
          setId={setId}
          onSetIdChange={setSetId}
          onUploaded={handleUploaded}
          onSessionExpired={onSessionExpired}
          notify={notify}
        />
      ) : (
        <FilesPanel
          sets={sets}
          setsState={setsState}
          setsError={setsError}
          onRefreshSets={refreshSets}
          revision={revision}
          onSessionExpired={onSessionExpired}
          notify={notify}
        />
      )}
    </div>
  );
}
