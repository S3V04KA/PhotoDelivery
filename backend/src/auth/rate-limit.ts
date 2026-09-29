export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const MAX_TRACKED_KEYS = 1024;

export class LoginRateLimiter {
  readonly #failures = new Map<string, number[]>();
  readonly #maxFailures: number;
  readonly #windowMs: number;
  readonly #now: () => number;

  constructor(maxFailures: number, windowMs: number, now: () => number = Date.now) {
    this.#maxFailures = maxFailures;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  isBlocked(key: string): boolean {
    return this.#liveFailures(key).length >= this.#maxFailures;
  }

  recordFailure(key: string): void {
    const stamps = this.#liveFailures(key);
    stamps.push(this.#now());
    this.#failures.set(key, stamps);
  }

  reset(key: string): void {
    this.#failures.delete(key);
  }

  #liveFailures(key: string): number[] {
    const cutoff = this.#now() - this.#windowMs;
    if (this.#failures.size > MAX_TRACKED_KEYS) this.#sweep(cutoff);
    const kept = (this.#failures.get(key) ?? []).filter((stamp) => stamp > cutoff);
    if (kept.length > 0) this.#failures.set(key, kept);
    else this.#failures.delete(key);
    return kept;
  }

  #sweep(cutoff: number): void {
    for (const [key, stamps] of this.#failures) {
      if (!stamps.some((stamp) => stamp > cutoff)) this.#failures.delete(key);
    }
  }
}
