import { ErrorIcon } from './icons';

/**
 * Reached only for malformed paths (`#/a/b`). It is not part of a set, so it
 * may — and should — offer a way back to the start.
 */
export function NotFoundPage() {
  return (
    <main className="root">
      <section className="root__card">
        <span className="root__mark" aria-hidden="true">
          <ErrorIcon className="icon" />
        </span>

        <h1 className="root__title">Страница не найдена</h1>
        <p className="root__subtitle">
          Фотодоставка открывается по ссылке вида <code>#/имя-фотосета</code>
        </p>

        <a className="btn btn--filled btn--block root__action" href="#/">
          На главную
        </a>
      </section>
    </main>
  );
}
