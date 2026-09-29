import { useEffect } from 'react';

import { CheckIcon, CloseIcon, ErrorIcon } from './icons';

export type SnackbarTone = 'ok' | 'error';

interface SnackbarProps {
  /** null collapses the snackbar entirely. */
  readonly message: string | null;
  readonly tone: SnackbarTone;
  readonly onDismiss: () => void;
}

const AUTO_DISMISS_MS = 4000;

export function Snackbar({ message, tone, onDismiss }: SnackbarProps) {
  useEffect(() => {
    if (message === null) {
      return;
    }

    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [message, onDismiss]);

  if (message === null) {
    return null;
  }

  return (
    <div className="snackbar">
      <div className="snackbar__surface" role="status" aria-live="polite">
        <span className="snackbar__mark" aria-hidden="true">
          {tone === 'ok' ? <CheckIcon className="icon icon--sm" /> : <ErrorIcon className="icon icon--sm" />}
        </span>
        <span className="snackbar__text">{message}</span>
        <button className="snackbar__close" type="button" aria-label="Закрыть" onClick={onDismiss}>
          <CloseIcon className="icon icon--sm" />
        </button>
      </div>
    </div>
  );
}
