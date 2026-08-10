import type { Difficulty } from './api';

/**
 * Whether this browser is waiting for a partner, and how long it may keep
 * asking about it.
 *
 * The app polls to find out that a match happened, because being matched is
 * something that happens to you: your partner's request is what creates the
 * session. The question this module answers is *when polling is allowed at
 * all*, and the answer matters more than it sounds.
 *
 * Polling whenever someone is signed in and not in a session means every
 * person quietly reading a lesson asks the server a question every few seconds,
 * forever. That defeats the two things the deployment's cost model rests on:
 * Neon suspends idle compute, and Cloud Run scales to zero, and neither can
 * happen while a request arrives every four seconds. A tab left open overnight
 * is then not a small waste, it is an always-on database and two always-on
 * services, billed all month, for nobody.
 *
 * So the rule is: only ask when there is something to wait for, only while the
 * tab is in front of the reader, and not forever.
 */

const KEY = 'deepcs.queued';

/** After this, stop asking and clear the flag. Somebody who queued and walked
 * away should not leave a browser polling for the rest of the day. */
export const MAX_WAIT_MS = 15 * 60_000;

export interface Queued {
  topic: string;
  difficulty: Difficulty;
  /** Epoch milliseconds, used for both the backoff and the expiry. */
  since: number;
}

/**
 * How long to wait before asking again, given how long we have been waiting.
 *
 * A match is most likely in the first moments, when the person who made you
 * wait is still at the keyboard, so that is where the frequent asking is worth
 * paying for. After a few minutes the cost of asking has not changed but the
 * chance of an answer has, and a fixed interval keeps paying the first price
 * for the last odds.
 */
export function nextDelayMs(elapsedMs: number): number {
  if (elapsedMs < 60_000) return 3_000;
  if (elapsedMs < 5 * 60_000) return 8_000;
  return 20_000;
}

/** Remember that this browser joined the queue, so the shell keeps watching
 * even after the match screen is navigated away from. In storage rather than
 * in React state because that is exactly the case that broke: the state was
 * lost on navigation and on refresh. */
export function markQueued(topic: string, difficulty: Difficulty): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ topic, difficulty, since: Date.now() }));
  } catch {
    /* private browsing can refuse storage; the match screen still polls */
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
    // must not be a reason to poll, which is the failure that costs money.
    return null;
  }
}
