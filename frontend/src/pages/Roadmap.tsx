import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getRoadmap, type RoadmapTopic } from '../api';

/**
 * Grid to pixels. `gridX` and `gridY` are the *centre* of a box, in small whole
 * numbers, so the migration reads as a shape rather than as coordinates.
 */
const CELL_X = 122;
const CELL_Y = 112;
const BOX_W = 194;
const BOX_H = 54;

const MIN_SCALE = 0.4;
const MAX_SCALE = 2;

/** How far the pointer may move before a press counts as a drag rather than a
 * click. Below this, a press that wobbles by a pixel still opens the topic. */
const DRAG_THRESHOLD_PX = 4;

interface View {
  x: number;
  y: number;
  scale: number;
}

const left = (t: RoadmapTopic) => t.gridX * CELL_X - BOX_W / 2;
const top = (t: RoadmapTopic) => t.gridY * CELL_Y - BOX_H / 2;

/**
 * A curve from the bottom of one box to the top of the next.
 *
 * Deliberately loose. These lines say "this is the order I would read them in",
 * not "this one is required by that one", so they only need to lead the eye
 * downward. Control points sit straight below the start and straight above the
 * end, which is what keeps every line reading as downward travel even when two
 * topics are far apart sideways.
 */
function edgePath(from: RoadmapTopic, to: RoadmapTopic): string {
  const x1 = from.gridX * CELL_X;
  const y1 = from.gridY * CELL_Y + BOX_H / 2;
  const x2 = to.gridX * CELL_X;
  const y2 = to.gridY * CELL_Y - BOX_H / 2;
  const bend = (y2 - y1) / 2;
  return `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
}

/**
 * The roadmap: a tree read downward, one box per topic.
 *
 * Pan and zoom are hand-written because nodes never move, so the whole
 * interaction is one translate and one scale on a single SVG group. Three
 * details make the difference between that being smooth and being unusable,
 * and all three were wrong in the first version:
 *
 *   1. The pointer is *not* captured when a press starts. Capturing on
 *      pointerdown routes every later event to the canvas, so the click never
 *      reaches the topic under the cursor and nothing opens. Movement is
 *      tracked on `window` instead, and a press that never moves stays an
 *      ordinary click on whatever it landed on.
 *   2. The wheel listener is attached natively with `passive: false`. React's
 *      onWheel cannot call preventDefault, so the page scrolled away underneath
 *      the zoom.
 *   3. Text selection is off. Dragging across a label otherwise selects it, and
 *      the drag turns into a highlight halfway through.
 */
export function RoadmapPage({ onOpenTopic }: { onOpenTopic: (topic: RoadmapTopic) => void }) {
  const [topics, setTopics] = useState<RoadmapTopic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);

  const canvas = useRef<HTMLDivElement>(null);
  /** Set while a press is turning into a drag, and read by the node click
   * handler so that letting go at the end of a pan does not open a topic. */
  const moved = useRef(false);

  useEffect(() => {
    getRoadmap()
      .then((res) => setTopics(res.topics))
      .catch(() => setError('The roadmap could not be loaded. Try refreshing the page.'));
  }, []);

  /** Scale and centre so the whole tree is visible, whatever the window size. */
  const fit = useCallback(() => {
    const box = canvas.current?.getBoundingClientRect();
    if (!box || !topics || topics.length === 0) return;

    const xs = topics.map((t) => t.gridX * CELL_X);
    const ys = topics.map((t) => t.gridY * CELL_Y);
    const width = Math.max(...xs) - Math.min(...xs) + BOX_W;
    const height = Math.max(...ys) - Math.min(...ys) + BOX_H;
    const pad = 64;

    const scale = Math.min(1, (box.width - pad) / width, (box.height - pad) / height);
    setView({
      scale,
      x: box.width / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * scale,
      y: box.height / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * scale,
    });
  }, [topics]);

  // Before paint, so the tree never appears in the wrong place first.
  useLayoutEffect(fit, [fit]);

  useEffect(() => {
    const onResize = () => fit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fit]);

  /**
   * Zoom towards the pointer, so whatever is under the cursor stays under it.
   * Scaling towards the origin instead makes the map slide away as it grows,
   * which feels like the zoom is fighting you.
   */
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const px = event.clientX - box.left;
      const py = event.clientY - box.top;

      setView((v) => {
        const factor = Math.exp(-event.deltaY * 0.0015);
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
        const ratio = scale / v.scale;
        return { scale, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio };
      });
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

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
      // Cleared after the click that follows this pointerup has been handled.
      setTimeout(() => {
        moved.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const zoomBy = (factor: number) =>
    setView((v) => {
      const box = canvas.current?.getBoundingClientRect();
      const px = (box?.width ?? 0) / 2;
      const py = (box?.height ?? 0) / 2;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const ratio = scale / v.scale;
      return { scale, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio };
    });

  const open = (topic: RoadmapTopic) => {
    if (moved.current) return;
    onOpenTopic(topic);
  };

  if (error) return <p className="error">{error}</p>;
  if (!topics) return <p className="muted">Loading the roadmap…</p>;

  const byName = new Map(topics.map((t) => [t.topic, t]));

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
              className={`node${topic.dependsOn.length === 0 ? ' start' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`${topic.title}, ${topic.steps.length} steps`}
              onClick={() => open(topic)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onOpenTopic(topic);
              }}
            >
              <rect x={left(topic)} y={top(topic)} width={BOX_W} height={BOX_H} rx={9} />
              <text x={topic.gridX * CELL_X} y={topic.gridY * CELL_Y - 7}>
                {topic.title}
              </text>
              <text className="sub" x={topic.gridX * CELL_X} y={topic.gridY * CELL_Y + 12}>
                {topic.steps.length} steps
              </text>
            </g>
          ))}
        </g>
      </svg>

      <div className="canvas-title">
        <h2>Your roadmap</h2>
        <p className="faint">
          The order I would read them in. Start at the top and follow it down. Nothing is locked, so
          jump in wherever you like.
        </p>
      </div>

      <div className="canvas-controls">
        <button className="quiet" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
          +
        </button>
        <button className="quiet" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
          −
        </button>
        <button className="quiet" aria-label="Fit to screen" onClick={fit}>
          ⤢
        </button>
      </div>

      <span className="canvas-hint">Follow it downward. Click a topic to open it.</span>
    </div>
  );
}
