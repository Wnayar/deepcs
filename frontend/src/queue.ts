import type { Difficulty } from './api';

/**
 * Whether this browser is waiting for a partner.
 *
 * The app is *told* when a match happens, over the stream in `matchEvents.ts`,
 * so nothing is spent while nothing is happening. What this module decides is
 * narrower but still worth deciding: whether to hold a stream open at all.
 *
 * Holding one open for everybody signed in would put the earlier problem back
 * in a new shape. A connection is not free either: on Cloud Run it occupies a
 * concurrency slot and keeps the instance alive, so every person quietly
 * reading a lesson would pin a service for as long as they read. A stream is
 * opened only by somebody actually waiting for a partner, and it is given up
 * after a while, because a tab abandoned mid-queue should not hold a connection
 * open for the rest of the day.
 */

const KEY = 'deepcs.queued';

/** After this, stop watching and forget. Somebody who queued and walked away
 * should not leave a connection open for the rest of the day. */
export const MAX_WAIT_MS = 15 * 60_000;

export interface Queued {
  topic: string;
  difficulty: Difficulty;
  /** Epoch milliseconds, used for the expiry. */
  since: number;
}

/** Remember that this browser joined the queue, so the shell keeps watching
 * even after the match screen is navigated away from. In storage rather than
 * in React state because that is exactly the case that broke: the state was
 * lost on navigation and on refresh. */
export function markQueued(topic: string, difficulty: Difficulty): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ topic, difficulty, since: Date.now() }));
  } catch {
    /* private browsing can refuse storage; the match screen still watches */
  }
}

export function clearQueued(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to undo */
  }
}

/** What this browser is waiting for, or `null` if it is waiting for nothing or
 * has been waiting too long to keep asking. */
export function readQueued(now = Date.now()): Queued | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;

    const value = JSON.parse(raw) as Partial<Queued>;
    if (typeof value.topic !== 'string' || typeof value.since !== 'number') return null;
    if (now - value.since > MAX_WAIT_MS) {
      clearQueued();
      return null;
    }
    return value as Queued;
  } catch {
    // Unreadable or unparseable is the same as not queued. A corrupt entry
    // must not be a reason to open a stream, which is what costs money.
    return null;
  }
}
