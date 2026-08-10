import { useEffect, useState } from 'react';
import { listQuestions, type Difficulty, type Question } from '../api';

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
        <article className="card" key={question.id}>
          <h3>{question.title}</h3>
          <div>
            <span className="tag">{question.difficulty}</span>
            {question.tags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <ol className="muted" style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
            {question.parts.map((part) => (
              <li key={part}>{part}</li>
            ))}
          </ol>
        </article>
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
