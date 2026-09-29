/**
 * Bounded-concurrency runner: hands every item to `worker` with at most
 * `limit` of them in flight at the same time. Items are claimed in order —
 * the first item always starts first — and a finished worker immediately
 * picks up the next pending one, so a single slow upload no longer holds up
 * the whole queue the way a sequential loop does.
 *
 * An empty list (or a non-positive limit) resolves without ever calling the
 * worker. A rejecting worker rejects the returned promise with that same
 * error, Promise.all style, while the other in-flight workers are left to
 * settle on their own.
 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0 || limit <= 0) {
    return;
  }

  const concurrency = Math.min(limit, items.length);
  let cursor = 0;

  const runner = async (): Promise<void> => {
    while (cursor < items.length) {
      // The cursor moves synchronously before the await: single-threaded JS
      // guarantees two runners can never claim the same item.
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, runner));
}
