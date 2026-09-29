import { MAX_KEYS, MAX_PAGES } from './listing-limits';
import type { ObjectItem, ObjectStore } from './s3';
import { kindOf, thumbPrefix, type MediaKind } from '../util/media';

export interface SetSummary {
  readonly id: string;
  readonly files: number;
  readonly size: number;
  readonly lastModified: string;
}

export interface FileEntry {
  readonly name: string;
  readonly size: number;
  readonly lastModified: string;
  readonly kind: MediaKind;
}

interface Accumulator {
  files: number;
  size: number;
  lastModified: Date;
}

async function collectItems(store: ObjectStore, prefix: string, delimiter?: string): Promise<readonly ObjectItem[]> {
  const items: ObjectItem[] = [];
  let token: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await store.listPage(prefix, delimiter, token ?? undefined);
    items.push(...result.items);
    if (result.nextToken === null) break;
    token = result.nextToken;
  }
  return items;
}

function accumulate(sets: Map<string, Accumulator>, item: ObjectItem): void {
  const slash = item.key.indexOf('/');
  if (slash <= 0) return;
  const id = item.key.slice(0, slash);
  const rest = item.key.slice(slash + 1);
  if (rest.length === 0 || rest.includes('/') || kindOf(rest) === 'other') return;
  const current = sets.get(id) ?? { files: 0, size: 0, lastModified: new Date(0) };
  sets.set(id, {
    files: current.files + 1,
    size: current.size + item.size,
    lastModified: item.lastModified > current.lastModified ? item.lastModified : current.lastModified,
  });
}

export async function listSets(store: ObjectStore): Promise<SetSummary[]> {
  const sets = new Map<string, Accumulator>();
  let token: string | null = null;
  let seen = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await store.listPage('', undefined, token ?? undefined);
    for (const item of result.items) {
      seen += 1;
      accumulate(sets, item);
    }
    if (result.nextToken === null || seen >= MAX_KEYS) break;
    token = result.nextToken;
  }
  return [...sets]
    .sort((left, right) => right[1].lastModified.getTime() - left[1].lastModified.getTime())
    .map(([id, value]) => ({
      id,
      files: value.files,
      size: value.size,
      lastModified: value.lastModified.toISOString(),
    }));
}

export async function listSetFiles(store: ObjectStore, setId: string): Promise<FileEntry[]> {
  const prefix = `${setId}/`;
  const thumbs = thumbPrefix(setId);
  const items = await collectItems(store, prefix, '/');
  return items.flatMap((item): FileEntry[] => {
    if (item.key === prefix || item.key.startsWith(thumbs)) return [];
    const name = item.key.slice(prefix.length);
    if (name.length === 0 || name.includes('/')) return [];
    return [
      {
        name,
        size: item.size,
        lastModified: item.lastModified.toISOString(),
        kind: kindOf(name),
      },
    ];
  });
}

export async function collectKeysUnder(store: ObjectStore, setId: string): Promise<string[]> {
  const items = await collectItems(store, `${setId}/`);
  return items.map((item) => item.key);
}

export async function keyExists(store: ObjectStore, key: string): Promise<boolean> {
  const result = await store.listPage(key, '/');
  return result.items.some((item) => item.key === key);
}
