import { useEffect, useRef, useState } from 'react';
import {
  getQuestion,
  joinQueue,
  matchStatus,
  type Difficulty,
  type Question,
  type Session,
} from '../api';

const TOPICS = [
  'os',
  'networking',
  'databases',
  'oop',
  'system-design',
  'security',
  'debugging',
  'ai-tooling',
  'behavioural',
];

/** How often to ask whether a partner turned up. */
const POLL_MS = 2_000;

interface Props {
  /** A session already in progress, if there is one. */
  active: Session | null;
  onMatched: (session: Session, question: Question) => void;
  onResume: (session: Session) => void;
}

/**
 * Join the queue and wait.
 *
 * The polling here is not laziness about push — it is the crash-recovery
 * contract phase 3 designed. The pair claim lives in Redis and the session row
 * in Postgres, with no transaction spanning them, so a crash between the two
 * would leave a claimed partner with no session. `GET /match/status` answering
 * `none` is the signal to re-join, and it is the only thing that unsticks that
 * case. Every topic and difficulty resolves to a question, so a join never
 * dead-ends on an empty combination.
 */
export function MatchPage({ active, onMatched, onResume }: Props) {
  const [topic, setTopic] = useState('os');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const enter = async (session: Session) => {
    setWaiting(false);
    clearTimeout(timer.current);
    try {
      onMatched(session, await getQuestion(session.questionId));
    } catch {
      setError('matched, but the question could not be loaded');
    }
  };

  const poll = async () => {
    try {
      const status = await matchStatus(topic, difficulty);
      if (status.status === 'matched') return void enter(status.session);
      if (status.status === 'none') {
        // Neither matched nor queued: the claim was lost between Redis and
        // Postgres. Re-joining is the documented recovery, not an error.
        const rejoined = await joinQueue(topic, difficulty);
        if (rejoined.status === 'matched') return void enter(rejoined.session);
      }
      timer.current = setTimeout(() => void poll(), POLL_MS);
    } catch (err) {
      setWaiting(false);
      setError(err instanceof Error ? err.message : 'lost contact with matching');
    }
  };

  const start = async () => {
    setError(null);
    setWaiting(true);
    try {
      const result = await joinQueue(topic, difficulty);
      if (result.status === 'matched') return void enter(result.session);
      timer.current = setTimeout(() => void poll(), POLL_MS);
    } catch (err) {
      setWaiting(false);
      setError(err instanceof Error ? err.message : 'could not join the queue');
    }
  };

  const cancel = () => {
    // Leaves the queue entry behind: there is no leave endpoint, so the entry
    // is claimed by whoever joins next. Worth knowing rather than pretending
    // the button does more than it does.
    clearTimeout(timer.current);
    setWaiting(false);
  };

  // Joining while already matched hands back the same session rather than
  // queueing — phase 3's idempotence guard, which is what stops one person
  // being in two rooms. Saying so is the point: without this the button
  // silently teleports you into a room you thought you had left.
  if (active) {
    return (
      <>
        <h2>You are already in a session</h2>
        <p className="muted">
          Working with {active.partnerUid}. Leaving the editor does not end it — the document is
          still there, and so is your partner.
        </p>
        <div className="row">
          <button className="primary" onClick={() => onResume(active)}>
            Return to it
          </button>
        </div>
        <p className="muted" style={{ marginTop: '0.75rem' }}>
          To start a different one, end that session first.
        </p>
      </>
    );
  }

  return (
    <>
      <h2>Find a partner</h2>
      <p className="muted">
        You will both get the same question and a shared document to answer it in.
      </p>

      <div className="row" style={{ marginBottom: '1rem' }}>
        <select value={topic} disabled={waiting} onChange={(event) => setTopic(event.target.value)}>
          {TOPICS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <select
          value={difficulty}
          disabled={waiting}
          onChange={(event) => setDifficulty(event.target.value as Difficulty)}
        >
          <option value="easy">easy</option>
          <option value="medium">medium</option>
          <option value="hard">hard</option>
        </select>

        {waiting ? (
          <button onClick={cancel}>Stop waiting</button>
        ) : (
          <button className="primary" onClick={() => void start()}>
            Join the queue
          </button>
        )}
      </div>

      {waiting && (
        <p className="status">
          Waiting for someone to join {topic}/{difficulty}…
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}
