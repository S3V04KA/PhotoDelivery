import { useId, useState, type FormEvent } from 'react';

import { PhotoLibraryIcon } from './icons';

const FALLBACK_TITLE = 'Фото';

function readSiteTitle(): string {
  const configured: unknown = import.meta.env.VITE_SITE_TITLE;

  return typeof configured === 'string' && configured.trim() !== ''
    ? configured.trim()
    : FALLBACK_TITLE;
}

const SITE_TITLE = readSiteTitle();

/** Accepts the shapes people actually paste: `/id`, `id/`, spaces around it. */
function normalizeSetId(raw: string): string {
  return raw.trim().replace(/^\/+/, '').replace(/\/+$/, '').trim();
}

export function RootPage() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const supportId = `${fieldId}-support`;

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const setId = normalizeSetId(value);

    if (setId === '') {
      setError('Введите ID фотосета');
      return;
    }

    setError(null);
    window.location.hash = `#/${encodeURIComponent(setId)}`;
  };

  return (
    <main className="root">
      <section className="root__card">
        <span className="root__mark" aria-hidden="true">
          <PhotoLibraryIcon className="icon" />
        </span>

        <h1 className="root__title">{SITE_TITLE}</h1>
        <p className="root__subtitle">Введите ID фотосета</p>

        <form className="root__form" onSubmit={handleSubmit} noValidate>
          <div className="field" data-filled={value.length > 0} data-invalid={error !== null}>
            <div className="field__box">
              <span className="field__line field__line--top" aria-hidden="true" />
              <span className="field__line field__line--bottom" aria-hidden="true" />
              <span className="field__line field__line--side field__line--start" aria-hidden="true" />
              <span className="field__line field__line--side field__line--end" aria-hidden="true" />
              <label className="field__label" htmlFor={fieldId}>
                ID фотосета
              </label>
              <input
                className="field__input"
                id={fieldId}
                name="setId"
                type="text"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);

                  if (error !== null) {
                    setError(null);
                  }
                }}
                aria-invalid={error !== null}
                aria-describedby={supportId}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
              />
            </div>
          </div>

          <p className="field__support" id={supportId} data-error={error !== null} aria-live="polite">
            {error ?? 'ID из ссылки, например otpusk-2024'}
          </p>

          <button className="btn btn--filled btn--block" type="submit">
            Открыть
          </button>
        </form>
      </section>
    </main>
  );
}
