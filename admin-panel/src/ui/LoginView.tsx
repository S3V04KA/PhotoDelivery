import { useId, useState, type FormEvent } from 'react';

import { errorMessage, login as loginRequest } from '../api';
import { ErrorIcon, InfoIcon, ShieldIcon, VisibilityIcon, VisibilityOffIcon } from './icons';

interface LoginViewProps {
  /** Информационное сообщение сверху карточки (сессия истекла / выход). */
  readonly notice: string | null;
  readonly onLoggedIn: () => void;
}

const FAILURE_MESSAGE = 'Не удалось войти. Попробуйте ещё раз';

export function LoginView({ notice, onLoggedIn }: LoginViewProps) {
  const [userLogin, setUserLogin] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loginId = useId();
  const passwordId = useId();

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    if (busy) {
      return;
    }

    const trimmed = userLogin.trim();

    if (trimmed === '') {
      setError('Введите логин');
      return;
    }

    if (password === '') {
      setError('Введите пароль');
      return;
    }

    setError(null);
    setBusy(true);

    void loginRequest(trimmed, password).then(
      () => {
        onLoggedIn();
      },
      (failure: unknown) => {
        setError(errorMessage(failure, FAILURE_MESSAGE));
        setBusy(false);
      },
    );
  };

  return (
    <main className="auth">
      <section className="auth__card">
        <span className="auth__mark" aria-hidden="true">
          <ShieldIcon className="icon" />
        </span>

        <h1 className="auth__title">Админ-панель</h1>
        <p className="auth__subtitle">Загрузка фото и видео в фотобакет</p>

        {notice !== null && (
          <p className="auth__notice">
            <InfoIcon className="icon" />
            {notice}
          </p>
        )}

        <form className="auth__form" onSubmit={handleSubmit} noValidate>
          <div className="field" data-filled={userLogin.length > 0} data-invalid={error !== null}>
            <div className="field__box">
              <span className="field__line field__line--top" aria-hidden="true" />
              <span className="field__line field__line--bottom" aria-hidden="true" />
              <span className="field__line field__line--side field__line--start" aria-hidden="true" />
              <span className="field__line field__line--side field__line--end" aria-hidden="true" />
              <label className="field__label" htmlFor={loginId}>
                Логин
              </label>
              <input
                className="field__input"
                id={loginId}
                name="login"
                type="text"
                value={userLogin}
                autoComplete="username"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy}
                onChange={(event) => {
                  setUserLogin(event.target.value);

                  if (error !== null) {
                    setError(null);
                  }
                }}
              />
            </div>
          </div>

          <div
            className="field field--trailing"
            data-filled={password.length > 0}
            data-invalid={error !== null}
          >
            <div className="field__box">
              <span className="field__line field__line--top" aria-hidden="true" />
              <span className="field__line field__line--bottom" aria-hidden="true" />
              <span className="field__line field__line--side field__line--start" aria-hidden="true" />
              <span className="field__line field__line--side field__line--end" aria-hidden="true" />
              <label className="field__label" htmlFor={passwordId}>
                Пароль
              </label>
              <input
                className="field__input"
                id={passwordId}
                name="password"
                type={passwordVisible ? 'text' : 'password'}
                value={password}
                autoComplete="current-password"
                disabled={busy}
                onChange={(event) => {
                  setPassword(event.target.value);

                  if (error !== null) {
                    setError(null);
                  }
                }}
              />
              <button
                className="field__trailing"
                type="button"
                aria-label={passwordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                aria-pressed={passwordVisible}
                disabled={busy}
                onClick={() => {
                  setPasswordVisible((visible) => !visible);
                }}
              >
                {passwordVisible ? (
                  <VisibilityOffIcon className="icon" />
                ) : (
                  <VisibilityIcon className="icon" />
                )}
              </button>
            </div>
          </div>

          {error !== null && (
            <p className="auth__error" role="alert">
              <ErrorIcon className="icon" />
              {error}
            </p>
          )}

          <button
            className="btn btn--filled btn--block auth__submit"
            type="submit"
            disabled={busy}
          >
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? 'Входим…' : 'Войти'}
          </button>
        </form>

        <p className="auth__footnote">Сессия хранится в cookie браузера и заканчивается после выхода.</p>
      </section>
    </main>
  );
}
