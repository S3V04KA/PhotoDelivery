import { useId, useMemo, useState, type FocusEvent, type KeyboardEvent } from 'react';

import type { SetSummary } from '../api';
import { formatBytes, formatDateTime, formatFileCount } from '../lib/format';
import { validateSetId } from '../lib/validate';
import { AddIcon, CheckIcon, ExpandMoreIcon, PhotoLibraryIcon } from './icons';

const MAX_SUGGESTIONS = 8;
const FIELD_HINT = 'ID: буквы, цифры, дефис; без слэшей';
const EMPTY_HINT = 'В бакете пока нет сетов — введите любой ID, он создастся при загрузке';

interface SetPickerProps {
  readonly sets: readonly SetSummary[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Ошибка, поднятая выше (например, попытка загрузки с невалидным ID). */
  readonly error: string | null;
  readonly disabled: boolean;
}

type PickerOption =
  | { readonly kind: 'new'; readonly id: string }
  | { readonly kind: 'existing'; readonly id: string; readonly set: SetSummary };

export function SetPicker({ sets, value, onChange, error, disabled }: SetPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputId = useId();
  const listId = `${inputId}-list`;
  const supportId = `${inputId}-support`;

  const trimmed = value.trim();

  const options = useMemo<readonly PickerOption[]>(() => {
    const needle = trimmed.toLowerCase();
    const matches = sets
      .filter((set) => needle === '' || set.id.toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
    const exists = sets.some((set) => set.id === trimmed);
    const head: readonly PickerOption[] =
      trimmed !== '' && !exists ? [{ kind: 'new', id: trimmed }] : [];

    return [
      ...head,
      ...matches.map(
        (set) => ({ kind: 'existing', id: set.id, set }) as PickerOption,
      ),
    ];
  }, [sets, trimmed]);

  const check = validateSetId(trimmed);
  const invalid = trimmed !== '' && !check.ok;
  const supportText = error ?? (check.ok ? FIELD_HINT : check.error);

  const commit = (option: PickerOption): void => {
    onChange(option.id);
    setOpen(false);
    setActiveIndex(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();

      if (!open) {
        setOpen(true);
        return;
      }

      if (options.length === 0) {
        return;
      }

      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => (index + delta + options.length) % options.length);
      return;
    }

    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }

    if (event.key === 'Enter' && open) {
      const option = options[activeIndex];

      if (option !== undefined) {
        event.preventDefault();
        commit(option);
      }
    }
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>): void => {
    const next = event.relatedTarget;

    if (next instanceof Node && event.currentTarget.closest('.picker')?.contains(next)) {
      return;
    }

    setOpen(false);
  };

  return (
    <div
      className="picker field"
      data-filled={value.length > 0}
      data-invalid={invalid || error !== null}
    >
      <div className="field__box">
        <span className="field__line field__line--top" aria-hidden="true" />
        <span className="field__line field__line--bottom" aria-hidden="true" />
        <span className="field__line field__line--side field__line--start" aria-hidden="true" />
        <span className="field__line field__line--side field__line--end" aria-hidden="true" />
        <label className="field__label" htmlFor={inputId}>
          Фотосет
        </label>
        <input
          className="field__input"
          id={inputId}
          name="setId"
          type="text"
          role="combobox"
          value={value}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-describedby={supportId}
          aria-invalid={invalid || error !== null}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
        <button
          className="field__trailing"
          type="button"
          aria-label={open ? 'Скрыть список сетов' : 'Показать список сетов'}
          aria-expanded={open}
          disabled={disabled}
          tabIndex={-1}
          onClick={() => {
            setOpen((isOpen) => !isOpen);
          }}
        >
          <ExpandMoreIcon className="icon" />
        </button>
      </div>

      {open && (
        <ul className="picker__menu" id={listId} role="listbox" aria-label="Сеты">
          {options.length === 0 && <li className="picker__empty">{EMPTY_HINT}</li>}

          {options.map((option, index) => (
            <li key={option.id} role="none">
              <button
                className={
                  option.kind === 'new' ? 'picker__option picker__option--new' : 'picker__option'
                }
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onMouseEnter={() => {
                  setActiveIndex(index);
                }}
                onClick={() => {
                  commit(option);
                }}
              >
                <span className="picker__option-icon" aria-hidden="true">
                  {option.kind === 'new' ? (
                    <AddIcon className="icon icon--sm" />
                  ) : (
                    <PhotoLibraryIcon className="icon icon--sm" />
                  )}
                </span>

                <span className="picker__option-text">
                  <span className="picker__option-id">{option.id}</span>
                  <span className="picker__option-meta">
                    {option.kind === 'new'
                      ? 'Новый ID — создастся при первой загрузке'
                      : `${formatFileCount(option.set.files)} · ${formatBytes(option.set.size)} · ${formatDateTime(option.set.lastModified)}`}
                  </span>
                </span>

                {option.kind === 'existing' && option.set.id === trimmed && (
                  <span aria-hidden="true">
                    <CheckIcon className="icon icon--sm" />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p
        className="field__support"
        id={supportId}
        data-error={invalid || error !== null}
        aria-live="polite"
      >
        {supportText}
      </p>
    </div>
  );
}
