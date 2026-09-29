import { StateCard } from './StateCard';

interface BootScreenProps {
  readonly error: string | null;
  readonly onRetry: () => void;
}

export function BootScreen({ error, onRetry }: BootScreenProps) {
  if (error !== null) {
    return (
      <main className="workspace">
        <StateCard
          role="alert"
          message="Не удалось связаться с сервером"
          hint={error}
          action={{ label: 'Повторить', onClick: onRetry }}
        />
      </main>
    );
  }

  return (
    <main className="state" role="status">
      <div className="state__card">
        <span className="state__icon state__icon--neutral" aria-hidden="true">
          <span className="spinner spinner--md" />
        </span>
        <p className="state__message">Проверяем сессию…</p>
        <p className="state__hint">Это занимает меньше секунды</p>
      </div>
    </main>
  );
}
