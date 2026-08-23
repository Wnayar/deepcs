import { useCallback, useEffect, useState } from 'react';
import { getMe, setProgress } from './api';

/** One reader's mark on one step. Two flags rather than one status, because
 * starring something you have not done is most of the point of starring it. */
export interface Mark {
  done: boolean;
  starred: boolean;
}

const UNMARKED: Mark = { done: false, starred: false };

export interface ProgressState {
  /** Marks by step id. A step with no entry is unmarked. */
  marks: Map<string, Mark>;
  mark: (stepId: string, next: Mark) => void;
  markOf: (stepId: string) => Mark;
  /** Whether this reader owns the paid tier. False while signed out and
   * while the answer is still in flight — the UI may only ever upgrade from
   * locked to unlocked, never flash the other way. */
  entitled: boolean;
}

/**
 * The reader's ticks, stars and entitlement, loaded in one call and written
 * through on each click.
 *
 * Kept here rather than in the roadmap page because two screens read it: the
 * map draws a bar per topic, and the topic panel draws a row per step. The
 * map owns the state and hands the panel what it needs, so opening a topic
 * never refetches.
 *
 * **Signed out is not an error.** The map is public and the request 401s,
 * which is caught and read as "no marks, no entitlement".
 */
export function useProgress(signedIn: boolean): ProgressState {
  const [marks, setMarks] = useState<Map<string, Mark>>(new Map());
  const [entitled, setEntitled] = useState(false);

  useEffect(() => {
    if (!signedIn) {
      // Signing out must clear what the previous reader had marked, or their
      // ticks stay on the map for whoever signs in next.
      setMarks(new Map());
      setEntitled(false);
      return;
    }

    let live = true;
    getMe()
      .then((res) => {
        if (!live) return;
        setMarks(
          new Map(res.progress.map((p) => [p.stepId, { done: p.done, starred: p.starred }])),
        );
        setEntitled(res.entitled);
      })
      .catch(() => {
        // Offline, or signed out between the check and the call. An empty
        // map is the honest answer: nothing is shown as done or unlocked
        // that is not known to be.
      });

    return () => {
      live = false;
    };
  }, [signedIn]);

  /**
   * Redraw first, then tell the server.
   *
   * Waiting for the round trip would put a visible lag on every click, and
   * the route replaces state rather than toggling it, so a burst of clicks
   * settles on whatever the last one said no matter what order the replies
   * arrive in. A failed write puts the box back, because a tick the server
   * does not have is worse than a click that visibly did not take.
   */
  const mark = useCallback(
    (stepId: string, next: Mark) => {
      const before = marks.get(stepId) ?? UNMARKED;
      setMarks((prev) => new Map(prev).set(stepId, next));

      void setProgress(stepId, next.done, next.starred).catch(() => {
        setMarks((prev) => new Map(prev).set(stepId, before));
      });
    },
    [marks],
  );

  const markOf = useCallback((stepId: string) => marks.get(stepId) ?? UNMARKED, [marks]);

  return { marks, mark, markOf, entitled };
}

/** How many of these steps are done. The roadmap's only arithmetic, in one
 * place because the node bars, the topic panel and the totals all need it. */
export function doneCount(marks: Map<string, Mark>, stepIds: string[]): number {
  return stepIds.reduce((n, id) => n + (marks.get(id)?.done ? 1 : 0), 0);
}
