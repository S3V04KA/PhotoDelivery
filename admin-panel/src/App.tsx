import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage, isUnauthorized, logout as logoutRequest, me } from './api';
import { applyGrayPalette } from './lib/palette';
import { BootScreen } from './ui/BootScreen';
import { LoginView } from './ui/LoginView';
import { Snackbar, type SnackbarTone } from './ui/Snackbar';
import { WorkspaceView } from './ui/WorkspaceView';

type Screen = 'booting' | 'login' | 'workspace';

interface Notice {
  readonly id: number;
  readonly message: string;
  readonly tone: SnackbarTone;
}

const SESSION_EXPIRED = 'Сессия истекла — войдите снова';
const SIGNED_OUT = 'Вы вышли из панели';
const BOOT_FAILURE = 'Сервер недоступен';

export default function App() {
  const [screen, setScreen] = useState<Screen>('booting');
  const [bootError, setBootError] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [attempt, setAttempt] = useState(0);
  const noticeId = useRef(0);

  const notify = useCallback((message: string, tone: SnackbarTone = 'ok'): void => {
    noticeId.current += 1;
    setNotice({ id: noticeId.current, message, tone });
  }, []);

  const dismissNotice = useCallback((): void => {
    setNotice(null);
  }, []);

  useEffect(() => {
    applyGrayPalette();
  }, []);

  useEffect(() => {
    let active = true;

    setBootError(null);

    void me().then(
      () => {
        if (active) {
          setScreen('workspace');
        }
      },
      (failure: unknown) => {
        if (!active) {
          return;
        }

        if (isUnauthorized(failure)) {
          setScreen('login');
          return;
        }

        setBootError(errorMessage(failure, BOOT_FAILURE));
      },
    );

    return () => {
      active = false;
    };
  }, [attempt]);

  const handleSessionExpired = useCallback((): void => {
    setScreen('login');
    setLoginNotice(SESSION_EXPIRED);
  }, []);

  const handleLogout = useCallback((): Promise<boolean> => {
    return logoutRequest().then(
      () => {
        setScreen('login');
        setLoginNotice(SIGNED_OUT);
        return true;
      },
      (failure: unknown) => {
        if (isUnauthorized(failure)) {
          setScreen('login');
          setLoginNotice(SIGNED_OUT);
          return true;
        }

        notify(errorMessage(failure, 'Не удалось выйти'), 'error');
        return false;
      },
    );
  }, [notify]);

  return (
    <>
      {screen === 'booting' && (
        <BootScreen
          error={bootError}
          onRetry={() => {
            setBootError(null);
            setAttempt((value) => value + 1);
          }}
        />
      )}

      {screen === 'login' && (
        <LoginView
          notice={loginNotice}
          onLoggedIn={() => {
            setLoginNotice(null);
            setScreen('workspace');
          }}
        />
      )}

      {screen === 'workspace' && (
        <WorkspaceView
          onLogout={handleLogout}
          onSessionExpired={handleSessionExpired}
          notify={notify}
        />
      )}

      <Snackbar
        message={notice?.message ?? null}
        tone={notice?.tone ?? 'ok'}
        onDismiss={dismissNotice}
      />
    </>
  );
}
