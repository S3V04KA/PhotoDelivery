import { describe, expect, it } from 'vitest';
import { LoginRateLimiter } from './rate-limit';

const WINDOW_MS = 15 * 60 * 1000;

function limiterWithClock(): { limiter: LoginRateLimiter; advance: (ms: number) => void } {
  let now = Date.UTC(2026, 0, 15, 12, 0, 0);
  const limiter = new LoginRateLimiter(5, WINDOW_MS, () => now);
  return { limiter, advance: (ms: number) => { now += ms; } };
}

describe('LoginRateLimiter', () => {
  it('блокирует IP после пяти неудачных попыток', () => {
    const { limiter } = limiterWithClock();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.isBlocked('1.2.3.4')).toBe(false);
      limiter.recordFailure('1.2.3.4');
    }
    expect(limiter.isBlocked('1.2.3.4')).toBe(true);
  });

  it('разблокирует после успешного входа', () => {
    const { limiter } = limiterWithClock();
    limiter.recordFailure('1.2.3.4');
    limiter.recordFailure('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(false);
    limiter.reset('1.2.3.4');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.isBlocked('1.2.3.4')).toBe(false);
      limiter.recordFailure('1.2.3.4');
    }
  });

  it('забывает неудачи старше окна в 15 минут', () => {
    const { limiter, advance } = limiterWithClock();
    for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordFailure('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(true);
    advance(WINDOW_MS + 1);
    expect(limiter.isBlocked('1.2.3.4')).toBe(false);
  });

  it('считает попытки по каждому IP отдельно', () => {
    const { limiter } = limiterWithClock();
    for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordFailure('1.2.3.4');
    expect(limiter.isBlocked('1.2.3.4')).toBe(true);
    expect(limiter.isBlocked('5.6.7.8')).toBe(false);
  });
});
