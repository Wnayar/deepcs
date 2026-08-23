import { useCallback, useEffect, useState } from 'react';
import { getMe, setProgress } from './api';

/** One reader's mark on one step. Two flags, not one status: starring
 * something you have not done is most of the point of starring. */
export interface Mark {
  done: boolean;
  starred: boolean;
}

const UNMARKED: Mark = { done: false, starred: false };

export interface ProgressState {
  /** Marks by step id; no entry means unmarked. */
  marks: Map<string, Mark>;
  mark: (stepId: string, next: Mark) => void;
  markOf: (stepId: string) => Mark;
  /** False while signed out or in flight: the UI only ever upgrades from
   * locked to unlocked, never flashes the other way. */
  entitled: boolean;
}

/**
 * The reader's marks and entitlement, loaded once and written through on
 * each click. Owned by the shell because the header, the map, and the topic
 * panel all read it. Signed out is not an error: no marks, no entitlement.
 */
export function useProgress(signedIn: boolean): ProgressState {
  const [marks, setMarks] = useState<Map<string, Mark>>(new Map());
  const [entitled, setEntitled] = useState(false);

  useEffect(() => {
    if (!signedIn) {
      // Signing out must clear the previous reader's marks.
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
        // Offline or signed out mid-flight; an empty map is the honest state.
      });

    return () => {
      live = false;
    };
  }, [signedIn]);

  // Redraw first, then tell the server. The route replaces state rather
  // than toggling, so a burst of clicks settles on the last one; a failed
  // write puts the box back.
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

/** How many of these steps are done; shared by the node bars, the topic
 * panel, and the totals. */
export function doneCount(marks: Map<string, Mark>, stepIds: string[]): number {
  return stepIds.reduce((n, id) => n + (marks.get(id)?.done ? 1 : 0), 0);
}
