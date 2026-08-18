import type { Difficulty } from './api';

/**
 * Whether this browser is waiting for a partner, which is what decides whether
 * the shell asks `/match/status` at all.
 *
 * Asking on behalf of everybody signed in would be its own problem: every
 * person quietly reading a lesson would send a request every few seconds for as
 * long as they read, and none of those requests could ever have an answer.
 */

const KEY = 'deepcs.queued';

/** After this, stop asking and forget. A tab abandoned mid-queue should not go
 * on sending requests for the rest of the day, and past this point the entry is
 * being dropped on the server anyway: it matches WAIT_TTL_SECONDS in
 * services/matching/src/queue.ts, so a person stops asking at roughly the
 * moment they stop being claimable. */
export const MAX_WAIT_MS = 60_000;

export interface Queued {
  topic: string;
  difficulty: Difficulty;
  /** Epoch milliseconds, used for the expiry. */
  since: number;
}

/** Remember that this browser joined the queue, so the shell keeps watching
 * after the match screen is navigated away from. In storage rather than React
 * state, which navigation and refresh both discard. */
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
    // must not be a reason to start asking, which is what costs money.
    return null;
  }
}
