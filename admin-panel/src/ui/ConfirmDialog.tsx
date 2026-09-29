import { useEffect, useId, useRef } from 'react';

import { DeleteIcon } from './icons';

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Отмена',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const panel = panelRef.current;

    if (panel === null) {
      return;
    }

    const focusables = Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
    (focusables[0] ?? panel).focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== 'Tab' || focusables.length < 2) {
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="dialog-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className="dialog"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
      >
        <div className="dialog__head">
          <span className="dialog__icon" aria-hidden="true">
            <DeleteIcon className="icon" />
          </span>
          <h2 className="dialog__title" id={titleId}>
            {title}
          </h2>
        </div>

        <p className="dialog__body" id={bodyId}>
          {body}
        </p>

        <div className="dialog__actions">
          <button className="btn btn--tonal" type="button" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button className="btn btn--danger" type="button" onClick={onConfirm} disabled={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
