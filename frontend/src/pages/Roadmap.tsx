import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { getRoadmap, type RoadmapTopic } from '../api';
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

/** How far the pointer may move before a press counts as a drag rather than a
 * click. Below this, a press that wobbles by a pixel still opens the topic. */
const DRAG_THRESHOLD_PX = 4;

/**
 * The roadmap: a tree read downward, one box per topic.
 *
 * Pan and zoom are hand-written because the boxes never move, so the whole
 * interaction is one translate and one scale on a single SVG group. The
 * arithmetic lives in `roadmap-layout.ts` where it can be tested; what is left
 * here is the event handling, and three details in it are the difference
 * between the map being smooth and being unusable:
 *
 *   1. The pointer is *not* captured when a press starts. Capturing on
 *      pointerdown routes every later event to the canvas, so the click never
 *      reaches the topic under the cursor and nothing opens. Movement is
 *      tracked on `window` instead, and a press that never moves stays an
 *      ordinary click on whatever it landed on.
 *   2. The wheel listener is attached natively with `passive: false`, because
 *      React's onWheel cannot call preventDefault. It depends on `topics`
 *      because the canvas does not exist until they arrive.
 *   3. Text selection is off in the stylesheet, or dragging across a label
 *      turns into a highlight halfway through.
 */
export function RoadmapPage() {
  const navigate = useNavigate();
  // Present when the URL is /topic/:topic, absent at /. The panel is part of
  // this screen rather than a separate one, so opening it does not unmount the
  // map and closing it does not have to rebuild it.
  const { topic: openSlug } = useParams();
  const onOpenTopic = (topic: RoadmapTopic) => void navigate(`/topic/${topic.topic}`);

  const [topics, setTopics] = useState<RoadmapTopic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);

  const canvas = useRef<HTMLDivElement>(null);
  /** Set while a press is turning into a drag, and read by the click handler so
   * that letting go at the end of a pan does not also open a topic. */
  const moved = useRef(false);

  useEffect(() => {
    getRoadmap()
      .then((res) => setTopics(res.topics))
      .catch(() => setError('The roadmap could not be loaded. Try refreshing the page.'));
  }, []);

  /** Scale and centre so the whole tree is visible, whatever the window size. */
  const fit = useCallback(() => {
    const box = canvas.current?.getBoundingClientRect();
    if (!box || !topics) return;
    const next = fitView(box, topics);
    if (next) setView(next);
  }, [topics]);

  // Before paint, so the tree is never briefly in the wrong place.
  useLayoutEffect(fit, [fit]);

  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();

      // A trackpad pinch reaches the page as a wheel event with ctrlKey set,
      // which is the only way a browser reports one. Both it and a plain
      // scroll zoom, but they arrive at very different magnitudes, so each
      // gets its own sensitivity: one shared constant makes a pinch move in
      // leaps or a wheel barely move at all.
      const step = event.ctrlKey || event.metaKey ? 0.01 : 0.002;

      setView((v) =>
        zoomAt(
          v,
          Math.exp(-event.deltaY * step),
          event.clientX - box.left,
          event.clientY - box.top,
        ),
      );
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [topics]);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const origin = { x: event.clientX, y: event.clientY };
    const from = { x: view.x, y: view.y };
    moved.current = false;

    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - origin.x;
      const dy = move.clientY - origin.y;
      if (!moved.current && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      moved.current = true;
      setDragging(true);
      setView((v) => ({ ...v, x: from.x + dx, y: from.y + dy }));
    };

    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // Cleared only after the click that follows this pointerup has been seen.
      setTimeout(() => {
        moved.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const zoomFromCentre = (factor: number) => {
    const box = canvas.current?.getBoundingClientRect();
    setView((v) => zoomAt(v, factor, (box?.width ?? 0) / 2, (box?.height ?? 0) / 2));
  };

  if (error) return <p className="error">{error}</p>;
  if (!topics) return <p className="muted">Loading the roadmap…</p>;

  const byName = new Map(topics.map((t) => [t.topic, t]));
  const open = openSlug ? byName.get(openSlug) : undefined;

  return (
    <div
      ref={canvas}
      className={`canvas${dragging ? ' dragging' : ''}`}
      onPointerDown={onPointerDown}
    >
      <svg role="presentation">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {topics.flatMap((topic) =>
            topic.dependsOn
              .map((name) => byName.get(name))
              .filter((from): from is RoadmapTopic => from !== undefined)
              .map((from) => (
                <path
                  key={`${from.topic}->${topic.topic}`}
                  className="edge"
                  d={edgePath(from, topic)}
                />
              )),
          )}

          {topics.map((topic) => (
            <g
              key={topic.topic}
              className="node"
              role="button"
              tabIndex={0}
              aria-label={`${topic.title}, ${topic.steps.length} steps`}
              onClick={() => {
                if (!moved.current) onOpenTopic(topic);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onOpenTopic(topic);
              }}
            >
              <rect x={boxLeft(topic)} y={boxTop(topic)} width={BOX_W} height={BOX_H} rx={9} />
              <text x={topic.gridX * CELL_X} y={topic.gridY * CELL_Y + 4}>
                {topic.title}
              </text>
            </g>
          ))}
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

      {open && (
        <TopicDialog
          topic={open}
          onOpenStep={(stepId) => void navigate(`/step/${stepId}`)}
          onClose={() => void navigate('/')}
        />
      )}
    </div>
  );
}
