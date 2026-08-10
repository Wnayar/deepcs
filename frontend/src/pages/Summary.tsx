import type { SessionSummary } from '../App';

/**
 * Step 8 of the product loop, built from state the browser already holds —
 * the question, the partner and the start time all came back from
 * `/match/join`, and whether the answer was revealed is something this tab
 * just did. There is deliberately no summary endpoint: the richer version
 * (how many sessions, popular topics) is fed by the event log, and that is
 * phase 7's job.
 */
export function SummaryPage({ summary, onDone }: { summary: SessionSummary; onDone: () => void }) {
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

      <button className="primary" onClick={onDone}>
        Back to the lessons
      </button>
    </>
  );
}
