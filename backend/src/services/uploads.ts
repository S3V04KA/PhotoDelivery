import { rm } from 'node:fs/promises';
import { kindOf, mimeFor, objectKey } from '../util/media';
import { PreviewError, type Previewer } from './preview';
import type { ObjectStore } from './s3';

export const UNSUPPORTED_FORMAT: string = 'Неподдерживаемый формат';

export type ThumbStatus = 'ok' | 'failed' | 'skipped';

export interface UploadResult {
  readonly name: string;
  readonly ok: boolean;
  readonly thumb: ThumbStatus;
  readonly error?: string;
}

export interface StoredUpload {
  readonly originalname: string;
  readonly path: string;
}

export interface UploadDeps {
  readonly store: ObjectStore;
  readonly previewer: Previewer;
}

type Step = { readonly ok: true } | { readonly ok: false; readonly error: string };

interface Pending {
  readonly setId: string;
  readonly name: string;
  readonly path: string;
}

function describe(error: unknown): string {
  if (error instanceof PreviewError) return error.reason;
  if (error instanceof Error) return error.message.slice(0, 120);
  return 'Неизвестная ошибка';
}

async function putOriginal(store: ObjectStore, upload: Pending): Promise<Step> {
  try {
    await store.putFromFile(objectKey(upload.setId, upload.name), upload.path, mimeFor(upload.name));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

async function putPreview(deps: UploadDeps, upload: Pending): Promise<Step> {
  try {
    const preview = await deps.previewer.generate({
      path: upload.path,
      fileName: upload.name,
      setId: upload.setId,
    });
    await deps.store.putBuffer(preview.key, preview.body, mimeFor(preview.key));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function storeUpload(
  deps: UploadDeps,
  setId: string,
  file: StoredUpload,
): Promise<UploadResult> {
  const name = file.originalname;
  if (kindOf(name) === 'other') {
    await rm(file.path, { force: true });
    return { name, ok: false, thumb: 'skipped', error: UNSUPPORTED_FORMAT };
  }
  const pending: Pending = { setId, name, path: file.path };
  try {
    const original = await putOriginal(deps.store, pending);
    if (!original.ok) {
      return { name, ok: false, thumb: 'failed', error: original.error };
    }
    const preview = await putPreview(deps, pending);
    if (!preview.ok) {
      return { name, ok: true, thumb: 'failed', error: preview.error };
    }
    return { name, ok: true, thumb: 'ok' };
  } finally {
    await rm(file.path, { force: true });
  }
}
