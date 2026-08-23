import type { RoadmapTopic } from '../api';
import { doneCount, type Mark } from '../progress';

interface Props {
  topics: RoadmapTopic[];
  marks: Map<string, Mark>;
}

/** Gauge geometry in viewBox coordinates (100 wide), so it scales with
 * whatever CSS width it is given. */
const R = 42;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** The reader's totals, drawn over the map: lessons done inside a ring,
 * topics finished below it. */
export function ProgressPanel({ topics, marks }: Props) {
  const steps = topics.flatMap((topic) => topic.steps.map((step) => step.id));
  const done = doneCount(marks, steps);

  const finished = topics.filter(
    (topic) =>
      topic.steps.length > 0 &&
      doneCount(
        marks,
        topic.steps.map((step) => step.id),
      ) === topic.steps.length,
  ).length;

  // An empty roadmap would divide by zero; a NaN dash offset draws nothing.
  const fraction = steps.length === 0 ? 0 : done / steps.length;

  return (
    <aside className="progress-panel" aria-label="Your progress">
      {/* Both children share one grid cell (.gauge), centring the number in
          the ring without absolute positioning. */}
      <div className="gauge">
        <svg
          className="gauge-ring"
          viewBox="0 0 100 100"
          role="img"
          aria-label={`${done} of ${steps.length} lessons done`}
        >
          {/* Rotated so the ring starts at twelve o'clock. */}
          <g transform="rotate(-90 50 50)">
            <circle className="gauge-track" cx="50" cy="50" r={R} />
            <circle
              className="gauge-fill"
              cx="50"
              cy="50"
              r={R}
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
            />
          </g>
        </svg>

        <p className="gauge-count">
          <strong>{done}</strong>
          <span className="gauge-total">{steps.length}</span>
          <span className="gauge-unit">lessons</span>
        </p>
      </div>

      <p className="gauge-topics">
        <strong>{finished}</strong> of {topics.length} topics complete
      </p>
    </aside>
  );
}
