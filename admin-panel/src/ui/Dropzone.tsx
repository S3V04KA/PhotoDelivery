import { useEffect, useRef, useState, type DragEvent } from 'react';

import { UploadCloudIcon } from './icons';

interface DropzoneProps {
  readonly disabled: boolean;
  readonly onFiles: (files: readonly File[]) => void;
  /** Инкремент этого значения возвращает фокус на зону после очистки очереди. */
  readonly focusToken: number;
}

const ACCEPT = 'image/*,video/*';

export function Dropzone({ disabled, onFiles, focusToken }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLButtonElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    zoneRef.current?.focus();
  }, [focusToken]);

  return (
    <>
      <button
        className="dropzone"
        type="button"
        ref={zoneRef}
        disabled={disabled}
        data-dragging={dragging}
        onClick={() => {
          if (!disabled) {
            inputRef.current?.click();
          }
        }}
        onDragEnter={(event: DragEvent<HTMLButtonElement>) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event: DragEvent<HTMLButtonElement>) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }}
        onDragLeave={(event: DragEvent<HTMLButtonElement>) => {
          event.preventDefault();
          dragDepth.current -= 1;

          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={(event: DragEvent<HTMLButtonElement>) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);

          if (disabled) {
            return;
          }

          const dropped = Array.from(event.dataTransfer.files);

          if (dropped.length > 0) {
            onFiles(dropped);
          }
        }}
      >
        <span className="dropzone__icon" aria-hidden="true">
          <UploadCloudIcon className="icon icon--xl" />
        </span>
        <span className="dropzone__lead">
          {dragging ? 'Отпустите, чтобы добавить файлы' : 'Перетащите фото и видео сюда'}
        </span>
        <span className="dropzone__hint">
          Или нажмите, чтобы выбрать. Файлы загружаются по одному, чтобы одна ошибка не останавливала
          остальные.
        </span>
      </button>

      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        multiple
        accept={ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);

          if (picked.length > 0) {
            onFiles(picked);
          }

          event.target.value = '';
        }}
      />
    </>
  );
}
