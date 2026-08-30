import { Link } from 'react-router';

/**
 * The first screen a stranger sees. It answers what this is, who wrote it,
 * and what it costs, then hands over to the map.
 *
 * The tree below is a drawing, not the live map: it never fetches, never
 * pans, and its bars are illustrative. The titles are the real topics,
 * because the point is to show what is inside.
 *
 * Nothing keeps this in step with roadmap.json, which lives in the content
 * repo and is not built into this bundle, so adding a topic there means
 * editing the two arrays below by hand. The tell is the hero claiming a
 * topic count the drawing does not show.
 */

interface Node {
  id: string;
  title: string;
  /** Grid centre, in the viewBox's units. */
  x: number;
  y: number;
  tier: 'easy' | 'medium' | 'hard' | 'skills';
  /** Fraction of the bar filled, for illustration only. */
  filled: number;
}

const W = 156;
const H = 44;

const NODES: Node[] = [
  { id: 'oop', title: 'OOP', x: 90, y: 34, tier: 'easy', filled: 1 },
  { id: 'databases', title: 'Databases', x: 446, y: 34, tier: 'easy', filled: 0.6 },
  { id: 'design-patterns', title: 'Design Patterns', x: 90, y: 144, tier: 'medium', filled: 0.3 },
  { id: 'networking', title: 'Networking', x: 268, y: 144, tier: 'medium', filled: 0 },
  { id: 'security', title: 'Security', x: 268, y: 254, tier: 'medium', filled: 0 },
  { id: 'system-design', title: 'System Design', x: 268, y: 364, tier: 'medium', filled: 0 },
  { id: 'os', title: 'Operating Systems', x: 268, y: 474, tier: 'hard', filled: 0 },
  /* The skills topics depend on nothing, so they carry no edges and sit in
     the column the spine leaves free, as they do on the real map. */
  { id: 'debugging', title: 'Debugging', x: 446, y: 254, tier: 'skills', filled: 0 },
  { id: 'ai-tooling', title: 'AI Tooling', x: 446, y: 364, tier: 'skills', filled: 0 },
  { id: 'behavioural', title: 'Behavioural', x: 446, y: 474, tier: 'skills', filled: 0 },
];

const EDGES: [string, string][] = [
  ['oop', 'design-patterns'],
  ['networking', 'security'],
  ['design-patterns', 'system-design'],
  ['security', 'system-design'],
  ['databases', 'system-design'],
  ['system-design', 'os'],
];

const byId = new Map(NODES.map((n) => [n.id, n]));

/** The same right-angled trace the real map draws, with rounded corners. */
function trace(from: Node, to: Node): string {
  const y1 = from.y + H / 2 + 6;
  const y2 = to.y - H / 2;

  // Directly below: no jog, so no corners to round.
  if (from.x === to.x) {
    return `M ${from.x} ${y1} L ${to.x} ${y2}`;
  }

  const midY = (y1 + y2) / 2;
  const dir = Math.sign(to.x - from.x);
  const r = 10;
  return (
    `M ${from.x} ${y1} L ${from.x} ${midY - r} Q ${from.x} ${midY}, ${from.x + dir * r} ${midY} ` +
    `L ${to.x - dir * r} ${midY} Q ${to.x} ${midY}, ${to.x} ${midY + r} L ${to.x} ${y2}`
  );
}

/** The illustrative tree: the same shapes the real map draws, at fixed
 * coordinates, with no data behind it. */
function MockTree() {
  return (
    <svg className="mock-tree" viewBox="0 0 536 520" role="img" aria-label="The DeepCS roadmap">
      {EDGES.map(([fromId, toId]) => {
        const from = byId.get(fromId);
        const to = byId.get(toId);

        // An edge naming a node that is not in NODES is simply not drawn.
        if (from === undefined || to === undefined) {
          return null;
        }

        return <path key={`${fromId}${toId}`} className="mock-edge" d={trace(from, to)} />;
      })}

      {NODES.map((n) => (
        <g key={n.id} className="mock-node">
          <rect x={n.x - W / 2} y={n.y - H / 2} width={W} height={H} rx={9} />
          <rect
            className={`mock-tier tier-${n.tier}`}
            x={n.x - W / 2 + 2.5}
            y={n.y - H / 2 + 2.5}
            width={4}
            height={H - 5}
            rx={2}
          />
          <text x={n.x} y={n.y}>
            {n.title}
          </text>
          <rect className="mock-track" x={n.x - W / 2 + 1} y={n.y + H / 2 + 5} width={W - 2} height={5} rx={2.5} />
          {n.filled > 0 && (
            <rect
              className="mock-fill"
              x={n.x - W / 2 + 1}
              y={n.y + H / 2 + 5}
              width={(W - 2) * n.filled}
              height={5}
              rx={2.5}
            />
          )}
        </g>
      ))}
    </svg>
  );
}

/** The landing page: what this is, who wrote it, and the way in. */
export function HomePage() {
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <p className="badge">Essential SWE knowledge</p>
          <h2 className="hero-title">
            <span className="hero-lead">Prepare for</span>
            <span className="hero-big">technical interviews.</span>
          </h2>
          {/* One paragraph, and the half no competitor can copy is in it: a
              named person who is still sitting these interviews. */}
          <p className="muted">
            My revision notes from Computer Science at the National University of Singapore,
            where I am a final-year student and teaching assistant. Condensed for modern day
            technical interviews.
          </p>
          <div className="row hero-actions">
            <Link className="navlink primary" to="/roadmap">
              Explore the roadmap
            </Link>
            <Link className="navlink" to="/advice">
              How to prepare
            </Link>
          </div>
          {/* The scale, kept out of the badge so the badge can position
              rather than inventory. */}
          <p className="hero-proof">10 key topics</p>
        </div>

        <Link className="hero-map" to="/roadmap" aria-label="Open the roadmap">
          <MockTree />
        </Link>
      </section>

      {/* Where a larger site would run a wall of company logos. This is the
          honest equivalent: the reason the notes are public at all. */}
      <section className="backing">
        <p className="backing-label">Why this is public</p>
        <p className="backing-line">
          These were private notes until friends kept asking for copies. Thank you for the
          push and support{' '}
          <span className="support-heart" aria-hidden="true">
            ♥
          </span>
        </p>
      </section>
    </div>
  );
}
