import type { ReactNode } from 'react';

import { ErrorIcon, PhotoLibraryIcon } from './icons';

interface StatePanelProps {
  readonly message: string;
  readonly hint: string;
  /** Re-fetches this same set. Never navigates anywhere. */
  readonly onRetry: () => void;
}

interface PanelShellProps extends StatePanelProps {
  readonly icon: ReactNode;
  /** Announced assertively: the screen the user asked for is unavailable. */
  readonly assertive: boolean;
  readonly neutral?: boolean;
}

function PanelShell({ icon, message, hint, onRetry, assertive, neutral }: PanelShellProps) {
  return (
    <div className="state" role={assertive ? 'alert' : 'status'}>
      <div className="state__card">
        <span
          className={neutral === true ? 'state__icon state__icon--neutral' : 'state__icon'}
          aria-hidden="true"
        >
          {icon}
        </span>
        <p className="state__message">{message}</p>
        <p className="state__hint">{hint}</p>
        <button className="btn btn--tonal state__action" type="button" onClick={onRetry}>
          Повторить
        </button>
      </div>
    </div>
  );
}

export function ErrorPanel(props: StatePanelProps) {
  return <PanelShell {...props} icon={<ErrorIcon className="icon" />} assertive />;
}

/** A set that resolved with no displayable files is empty, not broken. */
export function EmptyPanel(props: StatePanelProps) {
  return <PanelShell {...props} icon={<PhotoLibraryIcon className="icon" />} assertive={false} neutral />;
}
