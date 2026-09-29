/**
 * Typed client for the admin API. The backend is built against this exact
 * contract, so nothing here invents an endpoint or a field.
 *
 * Every response body is parsed defensively: a non-JSON body (a proxy error
 * page, an empty 204) degrades to a readable message instead of throwing a
 * SyntaxError the UI would have to render.
 */

import type { MediaKind } from './lib/validate';

const API_BASE = '/api/admin';
const NETWORK_MESSAGE = 'Нет связи с сервером';
const FALLBACK_MESSAGE = 'Что-то пошло не так';
const UNREADABLE_MESSAGE = 'Сервер вернул некорректный ответ';

export interface SetSummary {
  readonly id: string;
  readonly files: number;
  readonly size: number;
  readonly lastModified: string;
}

export interface SetFile {
  readonly name: string;
  readonly size: number;
  readonly lastModified: string;
  readonly kind: MediaKind;
}

export type ThumbStatus = 'ok' | 'failed' | 'skipped' | 'unknown';

export interface UploadResultEntry {
  readonly name: string;
  readonly ok: boolean;
  readonly thumb: ThumbStatus;
  readonly error: string | null;
}

export interface UploadOutcome {
  readonly results: readonly UploadResultEntry[];
  readonly done: number;
  readonly failed: number;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function errorMessage(error: unknown, fallback: string = FALLBACK_MESSAGE): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? { ...value } : {};
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value : '';
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readArray(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function parseJson(text: string): unknown {
  if (text.trim() === '') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}

function messageFrom(payload: unknown, status: number): string {
  const error = asRecord(payload)['error'];

  if (typeof error === 'string' && error.trim() !== '') {
    return error;
  }

  return `Ошибка сервера (${status})`;
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return parseJson(await response.text());
  } catch {
    return null;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}/${path}`, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, NETWORK_MESSAGE);
  }

  const payload = await readBody(response);

  if (!response.ok) {
    throw new ApiError(response.status, messageFrom(payload, response.status));
  }

  return payload;
}

function toSetSummary(value: unknown): SetSummary | null {
  const record = asRecord(value);
  const id = readString(record, 'id');

  return id === ''
    ? null
    : {
        id,
        files: readNumber(record, 'files'),
        size: readNumber(record, 'size'),
        lastModified: readString(record, 'lastModified'),
      };
}

function toSetFile(value: unknown): SetFile | null {
  const record = asRecord(value);
  const name = readString(record, 'name');

  if (name === '') {
    return null;
  }

  const kind = record['kind'];

  return {
    name,
    size: readNumber(record, 'size'),
    lastModified: readString(record, 'lastModified'),
    kind: kind === 'image' || kind === 'video' ? kind : 'other',
  };
}

function toThumbStatus(value: unknown): ThumbStatus {
  if (value === 'ok' || value === 'failed' || value === 'skipped') {
    return value;
  }

  return 'unknown';
}

function toUploadResultEntry(value: unknown): UploadResultEntry | null {
  const record = asRecord(value);
  const name = readString(record, 'name');

  if (name === '') {
    return null;
  }

  const error = readString(record, 'error');

  return {
    name,
    ok: record['ok'] === true,
    thumb: toThumbStatus(record['thumb']),
    error: error === '' ? null : error,
  };
}

function toUploadOutcome(payload: unknown): UploadOutcome {
  const record = asRecord(payload);
  const results: UploadResultEntry[] = [];

  for (const item of readArray(record, 'results')) {
    const entry = toUploadResultEntry(item);

    if (entry !== null) {
      results.push(entry);
    }
  }

  return {
    results,
    done: readNumber(record, 'done'),
    failed: readNumber(record, 'failed'),
  };
}

function requirePayload(payload: unknown): void {
  if (payload === null) {
    throw new ApiError(0, UNREADABLE_MESSAGE);
  }
}

function setPath(setId: string): string {
  return `sets/${encodeURIComponent(setId)}`;
}

export async function me(): Promise<void> {
  requirePayload(await request('me'));
}

export async function login(userLogin: string, password: string): Promise<void> {
  requirePayload(
    await request('login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: userLogin, password }),
    }),
  );
}

export async function logout(): Promise<void> {
  requirePayload(await request('logout', { method: 'POST' }));
}

export async function listSets(): Promise<readonly SetSummary[]> {
  const payload = await request('sets');
  const sets: SetSummary[] = [];

  for (const item of readArray(asRecord(payload), 'sets')) {
    const summary = toSetSummary(item);

    if (summary !== null) {
      sets.push(summary);
    }
  }

  return sets;
}

export async function listFiles(setId: string): Promise<readonly SetFile[]> {
  const payload = await request(`${setPath(setId)}/files`);
  const files: SetFile[] = [];

  for (const item of readArray(asRecord(payload), 'files')) {
    const file = toSetFile(item);

    if (file !== null) {
      files.push(file);
    }
  }

  return files;
}

export async function deleteSet(setId: string): Promise<number> {
  const payload = await request(setPath(setId), { method: 'DELETE' });
  return readNumber(asRecord(payload), 'deleted');
}

export async function deleteFile(setId: string, name: string): Promise<number> {
  const payload = await request(`${setPath(setId)}/files?name=${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  return readNumber(asRecord(payload), 'deleted');
}

export interface UploadRequest {
  readonly setId: string;
  readonly file: File;
  readonly onProgress: (percent: number) => void;
}

/**
 * XHR rather than fetch: only XHR reports upload progress, and the admin
 * panel has to show a real percentage for multi-hundred-megabyte videos.
 */
export function uploadFile(request: UploadRequest): Promise<UploadOutcome> {
  const form = new FormData();
  form.append('setId', request.setId);
  form.append('files', request.file, request.file.name);

  return new Promise<UploadOutcome>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('POST', `${API_BASE}/uploads`, true);
    xhr.responseType = 'text';

    xhr.upload.addEventListener('progress', (event: ProgressEvent) => {
      if (event.lengthComputable && event.total > 0) {
        request.onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    });

    xhr.addEventListener('load', () => {
      const raw: unknown = xhr.response;
      const payload = parseJson(typeof raw === 'string' ? raw : '');

      if (xhr.status === 0) {
        reject(new ApiError(0, NETWORK_MESSAGE));
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(xhr.status, messageFrom(payload, xhr.status)));
        return;
      }

      if (payload === null) {
        reject(new ApiError(xhr.status, UNREADABLE_MESSAGE));
        return;
      }

      resolve(toUploadOutcome(payload));
    });

    xhr.addEventListener('error', () => {
      reject(new ApiError(0, NETWORK_MESSAGE));
    });

    xhr.addEventListener('abort', () => {
      reject(new ApiError(0, 'Загрузка прервана'));
    });

    xhr.send(form);
  });
}
