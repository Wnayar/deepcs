import { useEffect, useRef, useState } from 'react';
import { getRoadmap, type RoadmapTopic } from '../api';

/**
 * The size of one grid cell in pixels, and the size of a topic box inside it.
 * The seed stores positions as small whole numbers (0, 1, 2) so the reading
 * order is legible in the migration; turning those into pixels is layout, and
 * belongs here.
 */
const CELL_X = 230;
const CELL_Y = 150;
const BOX_W = 190;
const BOX_H = 62;

const ZOOM_LIMITS = { min: 0.45, max: 1.8 };

interface Point {
  x: number;
  y: number;
}

/** The centre of a topic's box, which is what edges are drawn between. */
function centre(topic: RoadmapTopic): Point {
  return { x: topic.gridX * CELL_X + BOX_W / 2, y: topic.gridY * CELL_Y + BOX_H / 2 };
}

/**
 * A curve from the bottom of one box to the top of another.
 *
 * Straight lines between centres would pass through the boxes themselves, so
 * each edge leaves the bottom edge of its prerequisite and arrives at the top
 * edge of its dependent. The control points are directly above and below those
 * ends, which is what makes every arrow read as travelling downward even when
 * the two topics are far apart sideways.
 */
function edgePath(from: RoadmapTopic, to: RoadmapTopic): string {
  const a = centre(from);
  const b = centre(to);
  const start = { x: a.x, y: a.y + BOX_H / 2 };
  const end = { x: b.x, y: b.y - BOX_H / 2 };
  const lift = Math.max(28, (end.y - start.y) / 2);
  return `M ${start.x} ${start.y} C ${start.x} ${start.y + lift}, ${end.x} ${end.y - lift}, ${end.x} ${end.y}`;
}

/**
 * The map of topics, with an arrow from each topic to the ones it makes easier.
 *
 * Pan and zoom are hand-written rather than pulled from a graph library. What
 * is needed here is a canvas you can drag and scale, not a node editor: nodes
 * never move, so the whole interaction is one translate and one scale applied
 * to a single SVG group. A library would add a dependency and a lot of API to
 * review for behaviour that is about forty lines.
 */
export function RoadmapPage({ onOpenTopic }: { onOpenTopic: (topic: RoadmapTopic) => void }) {
  const [topics, setTopics] = useState<RoadmapTopic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const dragFrom = useRef<{ pointer: Point; view: Point } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getRoadmap()
      .then((res) => setTopics(res.topics))
      .catch(() => setError('The roadmap could not be loaded. Try refreshing the page.'));
  }, []);

  /**
   * Centre the map once it is known, so it opens showing the whole thing
   * rather than the top-left corner of an arbitrarily sized grid.
   */
  useEffect(() => {
    if (!topics || !canvas.current) return;
    const width = Math.max(...topics.map((t) => t.gridX)) * CELL_X + BOX_W;
    const box = canvas.current.getBoundingClientRect();
    setView({ x: (box.width - width) / 2, y: 32, scale: 1 });
  }, [topics]);

  const startDrag = (event: React.PointerEvent) => {
    // Only a plain press on the background: a press on a topic is a click.
    if (event.button !== 0) return;
    dragFrom.current = {
      pointer: { x: event.clientX, y: event.clientY },
      view: { x: view.x, y: view.y },
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDrag = (event: React.PointerEvent) => {
    const from = dragFrom.current;
    if (!from) return;
    setView((v) => ({
      ...v,
      x: from.view.x + (event.clientX - from.pointer.x),
      y: from.view.y + (event.clientY - from.pointer.y),
    }));
  };

  const endDrag = () => {
    dragFrom.current = null;
    setDragging(false);
  };

  /**
   * Zoom towards the pointer rather than towards the origin, so the thing
   * under the cursor stays under the cursor. Without the offset correction the
   * map slides away as it grows, which feels like the zoom is fighting you.
   */
  const onWheel = (event: React.WheelEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    const pointer = { x: event.clientX - box.left, y: event.clientY - box.top };
    setView((v) => {
      const scale = Math.min(
        ZOOM_LIMITS.max,
        Math.max(ZOOM_LIMITS.min, v.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)),
      );
      const ratio = scale / v.scale;
      return {
        scale,
        x: pointer.x - (pointer.x - v.x) * ratio,
        y: pointer.y - (pointer.y - v.y) * ratio,
      };
    });
  };

  const zoomBy = (factor: number) =>
    setView((v) => ({
      ...v,
      scale: Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, v.scale * factor)),
    }));

  if (error) return <p className="error">{error}</p>;
  if (!topics) return <p className="muted">Loading the roadmap…</p>;

  const byName = new Map(topics.map((t) => [t.topic, t]));

  return (
    <>
      <div className="canvas-header">
        <h2>Your roadmap</h2>
        <p className="lede">
          Nine topics. A line from one to another means the first makes the second easier to read,
          not that you have to finish it. Pick anything you like and start there.
        </p>
      </div>

      <div
        ref={canvas}
        className={`canvas${dragging ? ' dragging' : ''}`}
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
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
                style={{ cursor: 'pointer' }}
                onClick={() => onOpenTopic(topic)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') onOpenTopic(topic);
                }}
              >
                <rect
                  x={topic.gridX * CELL_X}
                  y={topic.gridY * CELL_Y}
                  width={BOX_W}
                  height={BOX_H}
                  rx={10}
                />
                <text x={topic.gridX * CELL_X + BOX_W / 2} y={topic.gridY * CELL_Y + BOX_H / 2 - 8}>
                  {topic.title}
                </text>
                <text
                  className="sub"
                  x={topic.gridX * CELL_X + BOX_W / 2}
                  y={topic.gridY * CELL_Y + BOX_H / 2 + 11}
                >
                  {topic.steps.length} steps
                </text>
              </g>
            ))}
          </g>
        </svg>

        <span className="canvas-hint">Drag to move. Scroll to zoom. Click a topic to open it.</span>

        <div className="canvas-controls">
          <button className="quiet" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
            −
          </button>
          <button className="quiet" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>
            +
          </button>
        </div>
      </div>
    </>
  );
}
