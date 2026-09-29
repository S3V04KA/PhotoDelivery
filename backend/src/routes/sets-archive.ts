import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import {
  ARCHIVE_MIME,
  prepareEntry,
  selectArchiveFiles,
  streamArchive,
  type ArchiveQuality,
} from '../services/archive';
import { listSetFiles, type FileEntry } from '../services/sets';
import type { ObjectStore } from '../services/s3';
import { asyncRoute, contentDisposition, readField } from '../util/http';
import { validateObjectName, validateSetId, type Validation } from '../util/media';
import { ZipWriter } from '../util/zip';

export const SET_EMPTY: string = 'Фотосет не найден или пуст';
export const FILE_NOT_FOUND: string = 'Файл не найден';
export const BAD_QUALITY: string = 'Некорректный параметр quality';
export const BAD_NAMES: string = 'Некорректный параметр names';

export interface SetsArchiveDeps {
  readonly store: ObjectStore;
}

function parseQuality(raw: unknown): Validation<ArchiveQuality> {
  if (raw === undefined) return { ok: true, value: 'original' };
  if (raw === 'original' || raw === 'compressed') return { ok: true, value: raw };
  return { ok: false, error: BAD_QUALITY };
}

function parseNames(raw: unknown): Validation<readonly string[]> {
  if (typeof raw !== 'string') {
    return raw === undefined ? { ok: true, value: [] } : { ok: false, error: BAD_NAMES };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: true, value: [] };
  const names: string[] = [];
  for (const part of trimmed.split(',')) {
    const name = validateObjectName(part.trim());
    if (!name.ok) return { ok: false, error: name.error };
    names.push(name.value);
  }
  return { ok: true, value: names };
}

async function findFile(store: ObjectStore, setId: string, name: string): Promise<FileEntry | null> {
  const files = await listSetFiles(store, setId);
  return files.find((file) => file.name === name) ?? null;
}

export function createSetsArchiveRouter(deps: SetsArchiveDeps): Router {
  const router = Router();

  router.get('/sets/:id/archive', asyncRoute(async (req, res) => {
    const setId = validateSetId(req.params.id);
    if (!setId.ok) {
      res.status(400).json({ error: setId.error });
      return;
    }
    const quality = parseQuality(readField(req.query, 'quality'));
    if (!quality.ok) {
      res.status(400).json({ error: quality.error });
      return;
    }
    const names = parseNames(readField(req.query, 'names'));
    if (!names.ok) {
      res.status(400).json({ error: names.error });
      return;
    }
    const files = await selectArchiveFiles(deps.store, setId.value, names.value);
    if (files.length === 0) {
      const setHasMedia = (await selectArchiveFiles(deps.store, setId.value, [])).length > 0;
      res.status(404).json({ error: setHasMedia ? FILE_NOT_FOUND : SET_EMPTY });
      return;
    }
    res.setHeader('Content-Type', ARCHIVE_MIME);
    res.setHeader('Content-Disposition', contentDisposition(`${setId.value}.zip`));
    const zip = new ZipWriter(res);
    for await (const entry of streamArchive(deps.store, setId.value, files, quality.value)) {
      try {
        await zip.addEntry(entry.name, entry.body, { mtime: entry.mtime });
      } finally {
        await entry.cleanup();
      }
    }
    await zip.finish();
    res.end();
  }));

  router.get('/sets/:id/file/:name', asyncRoute(async (req, res) => {
    const setId = validateSetId(req.params.id);
    if (!setId.ok) {
      res.status(400).json({ error: setId.error });
      return;
    }
    const name = validateObjectName(req.params.name);
    if (!name.ok) {
      res.status(400).json({ error: name.error });
      return;
    }
    const quality = parseQuality(readField(req.query, 'quality'));
    if (!quality.ok) {
      res.status(400).json({ error: quality.error });
      return;
    }
    const file = await findFile(deps.store, setId.value, name.value);
    if (file === null) {
      res.status(404).json({ error: FILE_NOT_FOUND });
      return;
    }
    const entry = await prepareEntry(deps.store, setId.value, file, quality.value);
    try {
      res.setHeader('Content-Type', entry.mime);
      res.setHeader('Content-Disposition', contentDisposition(entry.name));
      await pipeline(Buffer.isBuffer(entry.body) ? Readable.from([entry.body]) : entry.body, res);
    } finally {
      await entry.cleanup();
    }
  }));

  return router;
}
