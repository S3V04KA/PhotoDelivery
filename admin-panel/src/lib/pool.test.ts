import { describe, expect, it } from 'vitest';

import { runPool } from './pool';

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

/** Ручной promise: resolve вызывается тестом, таймеров нет. */
function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

/** Крутит микрозадачи, пока predicate не станет истинным. */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error('waitFor: условие не наступило');
}

describe('runPool', () => {
  it('обрабатывает каждый элемент ровно один раз', async () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const seen: string[] = [];

    await runPool(items, 3, async (item) => {
      seen.push(item);
      await Promise.resolve();
    });

    expect(seen).toHaveLength(items.length);
    expect([...seen].sort()).toEqual([...items].sort());
  });

  it('держит лимит: limit стартуют до первого завершения, остальные ждут слота', async () => {
    const limit = 4;
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const gates: Deferred[] = [];
    const started: number[] = [];
    let inFlight = 0;
    let completed = 0;
    let maxInFlight = 0;

    const pool = runPool(items, limit, async (item) => {
      started.push(item);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      const gate = createDeferred();
      gates.push(gate);
      await gate.promise;

      inFlight -= 1;
      completed += 1;
    });

    // Ни один gate не открыт: limit задач уже стартовали, ни одна не завершилась.
    expect(started).toEqual([1, 2, 3, 4]);
    expect(completed).toBe(0);
    expect(maxInFlight).toBe(limit);

    for (let index = 0; index < items.length; index += 1) {
      await waitFor(() => gates.length > index);
      gates[index].resolve();
      expect(maxInFlight).toBeLessThanOrEqual(limit);
    }

    await pool;

    expect(started).toHaveLength(items.length);
    expect(completed).toBe(items.length);
    expect(maxInFlight).toBe(limit);
  });

  it('пустой список завершается сразу и не вызывает воркер', async () => {
    let called = 0;

    await runPool([], 4, async () => {
      called += 1;
    });

    expect(called).toBe(0);
  });

  it('лимит не больше нуля — ничего не запускается', async () => {
    let called = 0;

    await runPool([1, 2, 3], 0, async () => {
      called += 1;
    });

    expect(called).toBe(0);
  });

  it('лимит больше длины списка — все стартуют одновременно', async () => {
    const items = [1, 2, 3];
    const gates: Deferred[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const pool = runPool(items, 10, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      const gate = createDeferred();
      gates.push(gate);
      await gate.promise;

      inFlight -= 1;
    });

    expect(gates).toHaveLength(items.length);
    expect(maxInFlight).toBe(items.length);

    for (const gate of gates) {
      gate.resolve();
    }

    await pool;

    expect(maxInFlight).toBe(items.length);
  });

  it('ошибка воркера отклоняет пул с той же ошибкой', async () => {
    const failure = new Error('сетевая ошибка');
    const items = [1, 2, 3];

    await expect(
      runPool(items, 2, async (item) => {
        if (item === 2) {
          throw failure;
        }
      }),
    ).rejects.toBe(failure);
  });
});
