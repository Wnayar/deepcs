import type { RoadmapTopic } from '../api';
import { doneCount, type Mark } from '../progress';

interface Props {
  topics: RoadmapTopic[];
  marks: Map<string, Mark>;
}

/**
 * The gauge's geometry, in the SVG's own coordinates rather than in pixels.
 * The `viewBox` below is 100 wide, so these numbers are percentages of the
 * drawing and the whole thing scales with whatever CSS width it is given.
 */
const R = 42;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * What this reader has got through, over the map.
 *
 * The count sits *inside* the ring rather than beside it, because the two are
 * one fact and reading them as one is the whole point of a gauge. A number next
 * to a circle is two things to look at.
 *
 * The second line is topics finished, not steps part-done. "Six steps started"
 * is a measure of activity; "two topics you could explain end to end" is a
 * measure of what you have, and only the second one is worth wanting more of.
 */
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

  // Guarded, because an empty roadmap would divide by zero and the ring would
  // render with a NaN offset — which draws nothing and looks like a styling bug
  // rather than like missing data.
  const fraction = steps.length === 0 ? 0 : done / steps.length;

  return (
    <aside className="progress-panel" aria-label="Your progress">
      {/* Both children are placed in the same grid cell (see `.gauge` in the
          stylesheet), which is how the number ends up centred inside the ring
          without either one being positioned absolutely. */}
      <div className="gauge">
        <svg
          className="gauge-ring"
          viewBox="0 0 100 100"
          role="img"
          aria-label={`${done} of ${steps.length} lessons done`}
        >
          {/* Rotated so the ring starts at twelve o'clock. A dash offset starts
              at three o'clock, which reads as though progress began late. */}
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
