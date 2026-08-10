import { useEffect, useState } from 'react';
import { listQuestions, questionReference, type Difficulty, type Question } from '../api';

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

/**
 * Browse the bank. Public — this is the screen that makes the deployed site
 * worth visiting alone, since matchmaking with nobody else online would
 * otherwise demo as an empty room.
 *
 * Note what is *not* here: no answer. `reference_md` is never served to a
 * browser by Questions at all, so there is nothing to hide in the UI — the
 * only way to see one is through the reveal flow, with a partner.
 */
export function QuestionsPage({ signedIn }: { signedIn: boolean }) {
  const [items, setItems] = useState<Question[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The first page, refetched whenever a filter changes. It carries no cursor
   * on purpose: a cursor is a position in one particular result set, so
   * reusing it across a filter change would page through a list that no longer
   * exists.
   *
   * Written as its own effect rather than calling a shared loader, so that its
   * dependencies really are just the filters. A `load(append)` helper would be
   * recreated every render and either re-run this on each keystroke or need a
   * lint suppression to pretend otherwise.
   */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    listQuestions({
      tags: topic || undefined,
      difficulty: difficulty || undefined,
      q: search || undefined,
    })
      .then((page) => {
        // A slow first request must not overwrite the results of a later
        // filter the user has already moved on to.
        if (cancelled) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'could not load questions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [topic, difficulty, search]);

  /** The next page, appended. Only ever called from the button, so it reads
   * the current cursor at click time and needs no dependency tracking. */
  const loadMore = async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await listQuestions({
        tags: topic || undefined,
        difficulty: difficulty || undefined,
        q: search || undefined,
        cursor,
      });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not load more');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h2>Question bank</h2>

      <div className="row" style={{ marginBottom: '1rem' }}>
        <select value={topic} onChange={(event) => setTopic(event.target.value)}>
          <option value="">All topics</option>
          {TOPICS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <select
          value={difficulty}
          onChange={(event) => setDifficulty(event.target.value as Difficulty | '')}
        >
          <option value="">Any difficulty</option>
          <option value="easy">easy</option>
          <option value="medium">medium</option>
          <option value="hard">hard</option>
        </select>

        <input
          type="search"
          placeholder="Search titles…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {error && <p className="error">{error}</p>}
      {!error && items.length === 0 && !loading && <p className="muted">Nothing matches.</p>}

      {items.map((question) => (
        <QuestionCard key={question.id} question={question} signedIn={signedIn} />
      ))}

      <div className="row">
        {/* Cursor pagination: the cursor is the last id seen, so "more" is
            stable even if the bank changes between pages. */}
        {cursor && (
          <button onClick={() => void loadMore()} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
        {!signedIn && <span className="muted">Sign in to solve one with a partner.</span>}
      </div>
    </>
  );
}

/**
 * One question, closed by default.
 *
 * The header is topic and difficulty then the title — the two things you
 * actually choose on. The rest of the tags stay in the data for filtering but
 * are not shown: "processes · threads · fork · context-switch" adds nothing to
 * a card already headed "Processes & Threads". The questions themselves live
 * behind the click, because a list where every card lists six of them cannot
 * be scanned.
 */
function QuestionCard({ question, signedIn }: { question: Question; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showAnswer = async () => {
    setLoading(true);
    setError(null);
    try {
      setReference((await questionReference(question.id)).referenceMd);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'could not load the answer');
    } finally {
      setLoading(false);
    }
  };

  return (
    <article className="card">
      <button
        onClick={() => setOpen((was) => !was)}
        style={{ border: 0, padding: 0, background: 'none', textAlign: 'left', width: '100%' }}
      >
        <div className="muted" style={{ fontSize: '0.8rem' }}>
          {question.tags[0]} · {question.difficulty}
        </div>
        <h3 style={{ margin: '0.15rem 0' }}>{question.title}</h3>
        <div className="muted" style={{ fontSize: '0.8rem' }}>
          {question.parts.length} questions {open ? '▾' : '▸'}
        </div>
      </button>

      {open && (
        <>
          <ol style={{ margin: '0.75rem 0 0', paddingLeft: '1.2rem' }}>
            {question.parts.map((part) => (
              <li key={part}>{part}</li>
            ))}
          </ol>

          <div className="row" style={{ marginTop: '0.75rem' }}>
            {signedIn ? (
              !reference && (
                <button onClick={() => void showAnswer()} disabled={loading}>
                  {loading ? 'Loading…' : 'Show answer'}
                </button>
              )
            ) : (
              <span className="muted">Sign in to see the answer.</span>
            )}
          </div>

          {error && <p className="error">{error}</p>}
          {reference && <div className="reference">{reference}</div>}
        </>
      )}
    </article>
  );
}
