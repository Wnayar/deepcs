import { Navigate, useLocation, useNavigate } from 'react-router';
import type { SessionSummary } from '../App';

/**
 * The last screen of a session, built from state the browser already holds: the
 * question and the start time came back from `/match/join`, the end time from
 * `/match/sessions/:id/end`, and whether the answer was revealed is something
 * this tab just did. There is deliberately no summary endpoint here — the
 * richer version is fed by the event log, and that is the Stats job's work.
 */
export function SummaryPage() {
  const navigate = useNavigate();
  // Carried in history state, not in the URL. Every other screen can be rebuilt
  // from its address; this one is assembled from what the session page happened
  // to know when you pressed End, and no endpoint returns it. Rather than
  // pretend otherwise with a URL that renders an empty page on refresh, a
  // summary with nothing behind it sends you to the roadmap.
  const summary = (useLocation().state as { summary?: SessionSummary } | null)?.summary;
  if (!summary) return <Navigate to="/" replace />;

  const minutes = Math.max(
    1,
    Math.round(
      (new Date(summary.endedAt).getTime() - new Date(summary.startedAt).getTime()) / 60_000,
    ),
  );

  return (
    <>
      <h2>Session ended</h2>

      <div className="card">
        {/* Same header as a question card: topic and difficulty, then the
            title. The remaining tags are for filtering, not for reading. */}
        <div className="muted" style={{ fontSize: '0.8rem' }}>
          {summary.question.tags[0]} · {summary.question.difficulty}
        </div>
        <h3 style={{ margin: '0.15rem 0' }}>{summary.question.title}</h3>
        <dl className="muted" style={{ margin: '0.75rem 0 0' }}>
          <div className="row">
            <dt>Lasted:</dt>
            <dd style={{ margin: 0 }}>
              {minutes} minute{minutes === 1 ? '' : 's'}
            </dd>
          </div>
          <div className="row">
            <dt>Reference answer:</dt>
            <dd style={{ margin: 0 }}>{summary.revealed ? 'revealed' : 'not revealed'}</dd>
          </div>
        </dl>
      </div>

      <p className="muted">
        The document is saved. Ending closed it to further edits for both of you.
      </p>

      <button className="primary" onClick={() => void navigate('/')}>
        Back to the lessons
      </button>
    </>
  );
}
