import type { RoadmapTopic, Tier } from '../api';
import { doneCount, type Mark } from '../progress';

interface Props {
  topics: RoadmapTopic[];
  marks: Map<string, Mark>;
}

/** Gauge geometry in viewBox coordinates (100 wide), so it scales with
 * whatever CSS width it is given. */
const R = 42;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** A horseshoe, not a full circle: 300 degrees with the gap at the bottom,
 * so the sequence has a visible start (Easy, seven o'clock) and end. */
const SWEEP = 300 / 360;

/** Blank arc between neighbouring sectors, so the tiers read as separate. */
const GAP = 3;

/** Row order matches the map's flow: the difficulty ladder, then Skills. */
const TIERS: { tier: Tier; label: string }[] = [
  { tier: 'easy', label: 'Easy' },
  { tier: 'medium', label: 'Medium' },
  { tier: 'hard', label: 'Hard' },
  { tier: 'skills', label: 'Skills' },
];

interface Row {
  tier: Tier;
  label: string;
  done: number;
  total: number;
}

interface Sector extends Row {
  /** Where this tier's arc begins, in stroke units around the ring. */
  start: number;
  span: number;
}

/** Every step id in one tier, across all of its topics. */
function stepIdsInTier(topics: RoadmapTopic[], tier: Tier): string[] {
  const ids: string[] = [];

  for (const topic of topics) {
    if (topic.tier !== tier) {
      continue;
    }

    for (const step of topic.steps) {
      ids.push(step.id);
    }
  }

  return ids;
}

/** The reader's totals, drawn over the map: a count per tier beside a ring
 * that fills in each tier's colour, in row order around the circle. */
export function ProgressPanel({ topics, marks }: Props) {
  const rows: Row[] = TIERS.map(({ tier, label }) => {
    const ids = stepIdsInTier(topics, tier);

    return { tier, label, done: doneCount(marks, ids), total: ids.length };
  });

  let done = 0;
  let total = 0;

  for (const row of rows) {
    done += row.done;
    total += row.total;
  }

  /** This many steps as a length of arc. An empty roadmap would divide by
   * zero, and a NaN dash offset draws nothing. */
  function arc(count: number): number {
    if (total === 0) {
      return 0;
    }

    return (CIRCUMFERENCE * SWEEP * count) / total;
  }

  /* The ring is partitioned: each tier owns a sector sized by its share of
     all lessons, and its progress fills within that sector only, so "how
     much of Medium is done" can be read straight off the circle. */
  const sectors: Sector[] = [];
  let start = 0;

  for (const row of rows) {
    const span = arc(row.total);

    sectors.push({ ...row, start, span });
    start += span;
  }

  return (
    <aside className="progress-panel" aria-label="Your progress">
      <div className="tracker">
        <dl className="tracker-stats">
          {rows.map((row) => (
            <div key={row.tier} className={`stat ${row.tier}`}>
              <dt>{row.label}</dt>
              <dd>
                {row.done}/{row.total}
              </dd>
            </div>
          ))}
        </dl>

        {/* Both children share one grid cell (.gauge), centring the number in
            the ring without absolute positioning. */}
        <div className="gauge">
          <svg
            className="gauge-ring"
            viewBox="0 0 100 100"
            role="img"
            aria-label={`${done} of ${total} lessons done`}
          >
            {/* Rotated so the arc starts at seven o'clock and sweeps up and
                over. An untouched tier draws nothing: a zero-length arc's
                round line cap would render as a dot. */}
            <g transform="rotate(120 50 50)">
              {/* Each sector's track in a faint wash of its own colour, so
                  the empty ring already maps where every tier begins and
                  ends; progress paints over it at full strength. */}
              {sectors.map((sector) => {
                if (sector.total === 0) {
                  return null;
                }

                const track = Math.max(sector.span - GAP, 0.5);

                return (
                  <circle
                    key={`${sector.tier}-track`}
                    className={`gauge-track gauge-${sector.tier}`}
                    cx="50"
                    cy="50"
                    r={R}
                    strokeDasharray={`${track} ${CIRCUMFERENCE}`}
                    strokeDashoffset={-(sector.start + GAP / 2)}
                  />
                );
              })}

              {sectors.map((sector) => {
                if (sector.done === 0 || sector.total === 0) {
                  return null;
                }

                const share = sector.done / sector.total;
                const fill = Math.max((sector.span - GAP) * share, 0.5);

                return (
                  <circle
                    key={sector.tier}
                    className={`gauge-fill gauge-${sector.tier}`}
                    cx="50"
                    cy="50"
                    r={R}
                    strokeDasharray={`${fill} ${CIRCUMFERENCE}`}
                    strokeDashoffset={-(sector.start + GAP / 2)}
                  />
                );
              })}
            </g>
          </svg>

          <p className="gauge-count">
            <strong>{done}</strong>
            <span className="gauge-total">{total}</span>
            <span className="gauge-unit">done</span>
          </p>
        </div>
      </div>
    </aside>
  );
}
