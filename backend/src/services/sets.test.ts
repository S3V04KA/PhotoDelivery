import { describe, expect, it } from 'vitest';
import { collectKeysUnder, keyExists, listSetFiles, listSets } from './sets';
import { InMemoryStore } from '../testing/in-memory-store';

const T1 = new Date('2026-01-01T10:00:00.000Z');
const T2 = new Date('2026-01-02T10:00:00.000Z');
const T3 = new Date('2026-01-03T10:00:00.000Z');

function seededStore(): InMemoryStore {
  const store = new InMemoryStore();
  store.seed('alpha/one.jpg', 'a'.repeat(100), T1, 'image/jpeg');
  store.seed('alpha/two.mp4', 'b'.repeat(200), T2, 'video/mp4');
  store.seed('alpha/thumb/one.jpg', 't'.repeat(10), T3, 'image/jpeg');
  store.seed('alpha/', '', T3);
  store.seed('alpha/notes.txt', 'n'.repeat(50), T3);
  store.seed('beta/photo.png', 'c'.repeat(70), T2, 'image/png');
  store.seed('loose-key', 'z', T3);
  return store;
}

describe('listSets', () => {
  it('считает только медиа прямых потомков, превью и папку исключая', async () => {
    const sets = await listSets(seededStore());
    const alpha = sets.find((set) => set.id === 'alpha');
    expect(alpha).toEqual({
      id: 'alpha',
      files: 2,
      size: 300,
      lastModified: T2.toISOString(),
    });
  });

  it('сортирует сеты по времени изменения по убыванию', async () => {
    const sets = await listSets(seededStore());
    expect(sets.map((set) => set.id)).toEqual(['alpha', 'beta']);
    expect(sets[0]?.lastModified).toBe(T2.toISOString());
  });

  it('не создаёт сет для ключей без префикса и без медиа', async () => {
    const store = new InMemoryStore();
    store.seed('loose-key', 'z', T1);
    store.seed('gamma/notes.txt', 'n', T1);
    expect(await listSets(store)).toEqual([]);
  });
});

describe('listSetFiles', () => {
  it('возвращает прямых потомков с типом и исключает thumb/', async () => {
    const files = await listSetFiles(seededStore(), 'alpha');
    expect(files).toEqual([
      { name: 'notes.txt', size: 50, lastModified: T3.toISOString(), kind: 'other' },
      { name: 'one.jpg', size: 100, lastModified: T1.toISOString(), kind: 'image' },
      { name: 'two.mp4', size: 200, lastModified: T2.toISOString(), kind: 'video' },
    ]);
  });

  it('пуст для несуществующего сета', async () => {
    expect(await listSetFiles(seededStore(), 'missing')).toEqual([]);
  });
});

describe('collectKeysUnder', () => {
  it('собирает все ключи сета, включая thumb/ и плейсхолдер папки', async () => {
    const keys = await collectKeysUnder(seededStore(), 'alpha');
    expect(keys.sort()).toEqual([
      'alpha/',
      'alpha/notes.txt',
      'alpha/one.jpg',
      'alpha/thumb/one.jpg',
      'alpha/two.mp4',
    ]);
  });
});

describe('keyExists', () => {
  it('различает существующий и отсутствующий ключ', async () => {
    const store = seededStore();
    expect(await keyExists(store, 'alpha/one.jpg')).toBe(true);
    expect(await keyExists(store, 'alpha/missing.jpg')).toBe(false);
  });
});
