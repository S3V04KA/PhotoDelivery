/** Тип файла, который умеет показать просмотрщик. */
export type MediaKind = 'image' | 'video';

export interface MediaItem {
  /** Полный ключ в бакете: "{setId}/{filename}". */
  key: string;
  /** Имя файла без папки сета. */
  name: string;
  /** Полный URL оригинала, закодированный по сегментам. */
  url: string;
  /** Полный URL превью из "{setId}/thumb/". */
  thumbUrl: string;
  kind: MediaKind;
}

/** Сеть, 5xx, отказ в доступе или нечитаемый ответ хранилища. */
export class S3Error extends Error {
  readonly name = 'S3Error';
}

/** Сет не существует, пуст либо хранилище сообщило NoSuchBucket/NoSuchKey. */
export class SetNotFoundError extends Error {
  readonly name = 'SetNotFoundError';
}
