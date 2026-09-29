import type { ReactNode } from 'react';

import { ErrorIcon, PhotoLibraryIcon } from './icons';

export interface StateCardProps {
  readonly message: string;
  readonly hint?: string | null;
  /** «Нейтральная» (empty) reads differently from «ошибка». */
  readonly tone?: 'error' | 'neutral';
  readonly action?: { readonly label: string; readonly onClick: () => void };
  readonly icon?: ReactNode;
  readonly role?: 'status' | 'alert';
}

export function StateCard({
  message,
  hint,
  tone = 'error',
  action,
  icon,
  role = 'status',
}: StateCardProps) {
  return (
    <div className="state" role={role}>
      <div className="state__card">
        <span
          className={tone === 'neutral' ? 'state__icon state__icon--neutral' : 'state__icon'}
          aria-hidden="true"
        >
          {icon ?? (tone === 'neutral' ? <PhotoLibraryIcon className="icon" /> : <ErrorIcon className="icon" />)}
        </span>
        <p className="state__message">{message}</p>
        {hint !== undefined && hint !== null && <p className="state__hint">{hint}</p>}
        {action !== undefined && (
          <button className="btn btn--tonal state__action" type="button" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
