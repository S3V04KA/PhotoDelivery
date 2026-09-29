import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { DEFAULT_PAGE_SIZE, type ListPage, type ObjectItem, type ObjectStore } from '../services/s3';

interface StoredObject {
  body: Buffer;
  contentType: string;
  lastModified: Date;
}

export class InMemoryStore implements ObjectStore {
  readonly putCalls: { key: string; contentType: string; fromFile: boolean }[] = [];
  readonly deleteBatches: string[][] = [];
  readonly #objects = new Map<string, StoredObject>();

  seed(key: string, body: Buffer | string, lastModified: Date, contentType = 'application/octet-stream'): void {
    this.#objects.set(key, {
      body: typeof body === 'string' ? Buffer.from(body) : body,
      contentType,
      lastModified,
    });
  }

  keys(): string[] {
    return [...this.#objects.keys()].sort();
  }

  exists(key: string): boolean {
    return this.#objects.has(key);
  }

  bodyOf(key: string): Buffer | undefined {
    return this.#objects.get(key)?.body;
  }

  contentTypeOf(key: string): string | undefined {
    return this.#objects.get(key)?.contentType;
  }

  async listPage(prefix: string, delimiter?: string, token?: string, maxKeys: number = DEFAULT_PAGE_SIZE): Promise<ListPage> {
    const separator = delimiter ?? '';
    const matched = [...this.#objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, size: value.body.length, lastModified: value.lastModified }))
      .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));

    const items: ObjectItem[] = [];
    const commonPrefixes = new Set<string>();
    for (const item of matched) {
      const cut = separator.length === 0 ? -1 : item.key.indexOf(separator, prefix.length);
      if (cut >= 0) {
        commonPrefixes.add(item.key.slice(0, cut + separator.length));
        continue;
      }
      items.push(item);
    }

    const offset = Number.parseInt(token ?? '0', 10);
    const start = Number.isInteger(offset) && offset > 0 ? offset : 0;
    const page = items.slice(start, start + maxKeys);
    const consumed = start + page.length;
    return {
      items: page,
      commonPrefixes: [...commonPrefixes],
      nextToken: consumed < items.length ? String(consumed) : null,
    };
  }

  async putFromFile(key: string, path: string, contentType: string): Promise<void> {
    this.putCalls.push({ key, contentType, fromFile: true });
    this.seed(key, await readFile(path), new Date(), contentType);
  }

  async putBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
    this.putCalls.push({ key, contentType, fromFile: false });
    this.seed(key, body, new Date(), contentType);
  }

  async deleteKeys(keys: readonly string[]): Promise<void> {
    this.deleteBatches.push([...keys]);
    for (const key of keys) this.#objects.delete(key);
  }

  async getStream(key: string): Promise<Readable> {
    const object = this.#objects.get(key);
    if (object === undefined) throw new Error(`Объект не найден: ${key}`);
    return Readable.from([object.body]);
  }
}
