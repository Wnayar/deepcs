import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { getRoadmap, type RoadmapTopic } from '../api';
import { doneCount, type ProgressState } from '../progress';
import { ProgressPanel } from './ProgressPanel';
import { TopicDialog } from './TopicDialog';
import {
  BOX_H,
  BOX_W,
  CELL_X,
  CELL_Y,
  boxLeft,
  boxTop,
  edgePath,
  fitView,
  zoomAt,
  type View,
} from '../roadmap-layout';

/** Pointer travel below this keeps a press a click rather than a drag. */
const DRAG_THRESHOLD_PX = 4;

/** The progress bar hung under a node. */
const BAR_H = 5;

interface Props {
  /** Signed out, the map draws without marks rather than offering controls
   * that would 401. */
  signedIn: boolean;
  progress: ProgressState;
}

/**
 * The roadmap: a tree read downward, one box per topic, with hand-written
 * pan and zoom (one translate and one scale on a single SVG group; the
 * arithmetic is in roadmap-layout.ts). Two constraints in the event
 * handling: the pointer is not captured on pointerdown, or the click would
 * never reach the topic under it (movement is tracked on `window` instead),
 * and the wheel listener is attached natively with `passive: false` because
 * React's onWheel cannot preventDefault.
 */
export function RoadmapPage({ signedIn, progress }: Props) {
  const navigate = useNavigate();
  // Present at /topic/:topic, absent at /.
  const { topic: openSlug } = useParams();

  /** Opening a topic is a navigation, so Back closes the panel. */
  const onOpenTopic = (topic: RoadmapTopic) => void navigate(`/topic/${topic.topic}`);

  const { marks, markOf, mark, entitled } = progress;
  const [topics, setTopics] = useState<RoadmapTopic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);

  const canvas = useRef<HTMLDivElement>(null);
  /** Read by the click handler so releasing a pan does not open a topic. */
  const moved = useRef(false);
  /** Set while two fingers are down, so a pinch does not also pan. */
  const pinching = useRef(false);
  /** The view as of this render, for handlers that must not re-subscribe
   * on every pan frame. */
  const viewNow = useRef(view);
  viewNow.current = view;

  useEffect(() => {
    getRoadmap()
      .then(setTopics)
      .catch(() => setError('The roadmap could not be loaded. Try refreshing the page.'));
  }, []);

  /** Centres the whole tree in the canvas, if the canvas has a size yet. */
  const fit = useCallback(() => {
    const box = canvas.current?.getBoundingClientRect();

    if (!box || !topics) {
      return;
    }

    const next = fitView(box, topics);

    if (next !== null) {
      setView(next);
    }
  }, [topics]);

  // Before paint, so the tree is never briefly in the wrong place.
  useLayoutEffect(fit, [fit]);

  useEffect(() => {
    window.addEventListener('resize', fit);

    return () => window.removeEventListener('resize', fit);
  }, [fit]);

  useEffect(() => {
    const element = canvas.current;

    if (!element) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      const box = element.getBoundingClientRect();

      // A trackpad pinch arrives as a wheel event with ctrlKey set, at a
      // very different magnitude from a scroll, so each gets its own
      // sensitivity.
      const isPinch = event.ctrlKey || event.metaKey;
      const step = isPinch ? 0.01 : 0.002;

      const factor = Math.exp(-event.deltaY * step);
      const px = event.clientX - box.left;
      const py = event.clientY - box.top;

      setView((v) => zoomAt(v, factor, px, py));
    };

    element.addEventListener('wheel', onWheel, { passive: false });

    return () => element.removeEventListener('wheel', onWheel);
  }, [topics]);

  // Pinch to zoom. Touch events rather than pointer events: the gesture is
  // the distance between two fingers, which pointers only expose by
  // bookkeeping every contact by hand. A trackpad pinch is a ctrlKey wheel
  // event and is handled above; a touchscreen sends neither.
  useEffect(() => {
    const element = canvas.current;

    if (!element) {
      return;
    }

    let startSpread = 0;
    let startScale = 1;

    /** The two contacts, or null unless exactly two fingers are down. */
    const pair = (touches: TouchList) => {
      if (touches.length !== 2) {
        return null;
      }

      const a = touches[0];
      const b = touches[1];

      if (a === undefined || b === undefined) {
        return null;
      }

      return { a, b };
    };

    /** How far apart the two fingers are. */
    const spread = (two: { a: Touch; b: Touch }) => {
      return Math.hypot(two.a.clientX - two.b.clientX, two.a.clientY - two.b.clientY);
    };

    const onStart = (event: TouchEvent) => {
      const two = pair(event.touches);

      if (two === null) {
        return;
      }

      pinching.current = true;
      startSpread = spread(two);
      startScale = viewNow.current.scale;
    };

    const onMove = (event: TouchEvent) => {
      const two = pair(event.touches);

      if (two === null || startSpread === 0) {
        return;
      }

      event.preventDefault();

      const box = element.getBoundingClientRect();
      const midX = (two.a.clientX + two.b.clientX) / 2 - box.left;
      const midY = (two.a.clientY + two.b.clientY) / 2 - box.top;

      // Measured against the spread the gesture began at, so the zoom
      // tracks the fingers rather than accumulating per frame.
      const wanted = startScale * (spread(two) / startSpread);

      setView((v) => zoomAt(v, wanted / v.scale, midX, midY));
    };

    const onEnd = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        return;
      }

      startSpread = 0;

      // Cleared after the pointerup that ends the pan has been seen.
      setTimeout(() => {
        pinching.current = false;
      }, 0);
    };

    element.addEventListener('touchstart', onStart, { passive: false });
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd);
    element.addEventListener('touchcancel', onEnd);

    return () => {
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onEnd);
    };
  }, [topics]);

  /** Starts a pan, and watches `window` until the button comes back up. */
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) {
      return;
    }

    const origin = { x: event.clientX, y: event.clientY };
    const from = { x: view.x, y: view.y };
    moved.current = false;

    const onMove = (move: PointerEvent) => {
      if (pinching.current) {
        return;
      }

      const dx = move.clientX - origin.x;
      const dy = move.clientY - origin.y;
      const withinThreshold = Math.hypot(dx, dy) < DRAG_THRESHOLD_PX;

      if (!moved.current && withinThreshold) {
        return;
      }

      moved.current = true;
      setDragging(true);
      setView((v) => ({ ...v, x: from.x + dx, y: from.y + dy }));
    };

    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      // Cleared after the click that follows this pointerup has been seen.
      setTimeout(() => {
        moved.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** What the +/- buttons do: zoom about the middle of the canvas. */
  const zoomFromCentre = (factor: number) => {
    const box = canvas.current?.getBoundingClientRect();
    const midX = (box?.width ?? 0) / 2;
    const midY = (box?.height ?? 0) / 2;

    setView((v) => zoomAt(v, factor, midX, midY));
  };

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!topics) {
    return <p className="muted">Loading the roadmap…</p>;
  }

  const byName = new Map(topics.map((topic) => [topic.topic, topic]));

  let open: RoadmapTopic | undefined;

  if (openSlug !== undefined) {
    open = byName.get(openSlug);
  }

  return (
    <div
      ref={canvas}
      className={`canvas${dragging ? ' dragging' : ''}`}
      onPointerDown={onPointerDown}
    >
      <svg role="presentation">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {topics.flatMap((topic) => {
            const parents: RoadmapTopic[] = [];

            for (const name of topic.dependsOn) {
              const from = byName.get(name);

              // A dependency on a topic that is not on the map draws nothing.
              if (from !== undefined) {
                parents.push(from);
              }
            }

            return parents.map((from) => {
              const d = edgePath(from, topic);

              return (
                /* Cased like a subway line: the bg-coloured underlay cuts
                   the grid wherever the trace runs, so an axis-aligned
                   edge never sinks into an axis-aligned grid line. */
                <g key={`${from.topic}->${topic.topic}`}>
                  <path className="edge-casing" d={d} />
                  <path className="edge" d={d} />
                </g>
              );
            });
          })}

          {topics.map((topic) => {
            const stepIds = topic.steps.map((step) => step.id);
            const total = topic.steps.length;
            const done = doneCount(marks, stepIds);
            const allDone = total > 0 && done === total;
            const locked = topic.access === 'paid' && !entitled;

            return (
              <g
                key={topic.topic}
                className={allDone ? 'node done' : 'node'}
                role="button"
                tabIndex={0}
                aria-label={`${topic.title}, ${done} of ${total} lessons done`}
                onClick={() => {
                  if (!moved.current) {
                    onOpenTopic(topic);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    onOpenTopic(topic);
                  }
                }}
              >
                <rect x={boxLeft(topic)} y={boxTop(topic)} width={BOX_W} height={BOX_H} rx={9} />
                {/* The tier, on the box itself: a coloured spine on the left
                    edge, matching the tracker's row colours, legible at any
                    zoom without labelling every node. */}
                <rect
                  className={`node-tier tier-${topic.tier}`}
                  x={boxLeft(topic) + 2.5}
                  y={boxTop(topic) + 2.5}
                  width={4}
                  height={BOX_H - 5}
                  rx={2}
                />
                <text x={topic.gridX * CELL_X} y={topic.gridY * CELL_Y}>
                  {topic.title}
                </text>

                {/* Hung just below the box, full width: inside the border a
                    bar reads as a rendering artefact, below it reads as the
                    topic's base. Drawn even at zero, so "nothing done" reads
                    as an empty track rather than a topic with no steps. */}
                <rect
                  className="node-track"
                  x={boxLeft(topic) + 1}
                  y={boxTop(topic) + BOX_H + 5}
                  width={BOX_W - 2}
                  height={BAR_H}
                  rx={BAR_H / 2}
                />
                {done > 0 && (
                  <rect
                    className="node-fill"
                    x={boxLeft(topic) + 1}
                    y={boxTop(topic) + BOX_H + 5}
                    width={((BOX_W - 2) * done) / Math.max(1, total)}
                    height={BAR_H}
                    rx={BAR_H / 2}
                  />
                )}

                {/* Paid topics stay titled and clickable, tagged with a tier
                    pill pinned across the top corner rather than a padlock:
                    seven locks read as a wall, a product name reads as an
                    offer. The panel does the selling. */}
                {locked && (
                  <g className="pro-tag" aria-hidden="true">
                    <rect
                      x={boxLeft(topic) + BOX_W - 48}
                      y={boxTop(topic) - 8}
                      width={38}
                      height={17}
                      rx={8.5}
                    />
                    <text x={boxLeft(topic) + BOX_W - 29} y={boxTop(topic) + 0.5}>
                      PRO
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="canvas-controls">
        <button className="quiet" aria-label="Zoom in" onClick={() => zoomFromCentre(1.25)}>
          +
        </button>
        <button className="quiet" aria-label="Zoom out" onClick={() => zoomFromCentre(1 / 1.25)}>
          −
        </button>
        <button className="quiet" aria-label="Fit the whole map on screen" onClick={fit}>
          ⛶
        </button>
      </div>

      {signedIn && <ProgressPanel topics={topics} marks={marks} />}

      {open && (
        <TopicDialog
          topic={open}
          signedIn={signedIn}
          locked={open.access === 'paid' && !entitled}
          markOf={markOf}
          onMark={mark}
          onOpenStep={(stepId) => void navigate(`/step/${stepId}`)}
          onClose={() => void navigate('/roadmap')}
        />
      )}
    </div>
  );
}
