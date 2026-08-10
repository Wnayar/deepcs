import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_WAIT_MS, clearQueued, markQueued, nextDelayMs, readQueued } from './queue';

/**
 * A stand-in for `localStorage`, so these run in Node without pulling in a DOM
 * implementation for four keys and a JSON blob. What is under test is our
 * decision about when polling is allowed, not the browser's storage.
 */
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
});

afterEach(() => clearQueued());

describe('nextDelayMs', () => {
  it('asks often at first and rarely later', () => {
    expect(nextDelayMs(0)).toBe(3_000);
    expect(nextDelayMs(59_000)).toBe(3_000);
    expect(nextDelayMs(61_000)).toBe(8_000);
    expect(nextDelayMs(6 * 60_000)).toBe(20_000);
  });

  it('never asks more often than every three seconds', () => {
    for (let elapsed = 0; elapsed < MAX_WAIT_MS; elapsed += 1_000) {
      expect(nextDelayMs(elapsed)).toBeGreaterThanOrEqual(3_000);
    }
  });

  /**
   * The number that decides the bill. Polling is only affordable if the total
   * per wait is bounded, and it is the *shape* of the backoff that bounds it:
   * a flat three-second interval for fifteen minutes is 300 requests, which is
   * an always-on database for one person who wandered off.
   */
  it('costs at most a few dozen requests for a whole wait', () => {
    let elapsed = 0;
    let polls = 0;
    while (elapsed < MAX_WAIT_MS) {
      elapsed += nextDelayMs(elapsed);
      polls += 1;
    }
    expect(polls).toBeLessThan(90);
  });
});

describe('readQueued', () => {
  it('is null when nothing was queued', () => {
    expect(readQueued()).toBeNull();
  });

  it('remembers what was queued for', () => {
    markQueued('os', 'easy');
    expect(readQueued()).toMatchObject({ topic: 'os', difficulty: 'easy' });
  });

  it('gives up rather than polling forever', () => {
    markQueued('os', 'easy');
    const now = Date.now() + MAX_WAIT_MS + 1;

    expect(readQueued(now)).toBeNull();
    // And it forgets, so the next read is not a second expiry check.
    expect(localStorage.getItem('deepcs.queued')).toBeNull();
  });

  it('treats a corrupt entry as not queued', () => {
    // Anything unreadable must mean "do not poll". The failure that costs
    // money is deciding to poll when there is nothing to wait for.
    localStorage.setItem('deepcs.queued', '{not json');
    expect(readQueued()).toBeNull();

    localStorage.setItem('deepcs.queued', '{"topic":42}');
    expect(readQueued()).toBeNull();
  });
});
