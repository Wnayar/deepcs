import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_WAIT_MS, clearQueued, markQueued, readQueued } from './queue';

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
