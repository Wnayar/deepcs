import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { renderMarkdown } from '../markdown';
import { ApiError, getStep, type StepDetail } from '../api';
import { splitLesson, splitReference, type SplitReference } from '../lesson-sections';

/**
 * One step as a focused read: a slim bar carrying where you are, then one
 * lesson section per screen in a single centred column, then a closing screen
 * where each question reveals its own answer.
 *
 * Everything that is not the current section lives in the bar's dropdown, so
 * a screen holds exactly: where you are, one section, and the way onward. The
 * bar hides while you scroll down and returns when you scroll up, the way
 * mobile browser chrome does.
 *
 * The section lives in the URL (`?s=2`, `?s=check`) rather than component
 * state, so refresh keeps your place and Back is "previous section" instead
 * of "leave the lesson".
 *
 * Content arrives as static files (DESIGN.md §6): the lesson markdown by
 * step id, the questions and answers from the tier's questions file. Answers
 * are self-serve — there is no consent machinery and nothing to earn; on the
 * paid tier the whole file only arrives entitled, which is the actual gate.
 * A paid step answers 401 (sign in) or 402 (upgrade) and this page turns
 * each into its prompt rather than an error.
 */
export function StepPage({ signedIn }: { signedIn: boolean }) {
  const navigate = useNavigate();
  const { id: stepId = '' } = useParams();
  const [params, setParams] = useSearchParams();

  const [step, setStep] = useState<StepDetail | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState<401 | 402 | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [barHidden, setBarHidden] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStep(null);
    setOpen(new Set());
    setError(null);
    setDenied(null);
    getStep(stepId)
      .then(setStep)
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 402)) {
          setDenied(err.status);
        } else {
          setError('This step could not be loaded. Try refreshing the page.');
        }
      });
    // `signedIn` is a dependency because signing in changes what this fetch
    // is allowed to see, and the 401 prompt below is how you get here.
  }, [stepId, signedIn]);

  const lesson = useMemo(() => {
    if (!step) return null;
    const split = splitLesson(step.lessonMd);
    // A short lesson with no headings still gets a screen of its own.
    if (split.sections.length === 0)
      return { preamble: '', sections: [{ title: step.title, body: split.preamble }] };
    return split;
  }, [step]);

  /** The answer key, split per question. A key without the `### N.`
   * numbering cannot be split, so it is kept whole and every card shows all
   * of it rather than nothing. */
  const reference = useMemo<SplitReference | { blob: string } | null>(() => {
    if (!step || !step.referenceMd) return null;
    return splitReference(step.referenceMd) ?? { blob: step.referenceMd };
  }, [step]);

  // Which screen the URL names: a 1-based section number, or the check
  // screen. Out-of-range numbers clamp instead of erroring.
  const count = lesson?.sections.length ?? 1;
  const raw = params.get('s');
  const checking = raw === 'check';
  const section = checking ? count : Math.min(Math.max(Number(raw) || 1, 1), count);

  const goTo = (next: number | 'check') => {
    setMenuOpen(false);
    setParams(next === 'check' ? { s: 'check' } : next > 1 ? { s: String(next) } : {});
  };

  // A new screen starts at its top, whether reached by the pager or by Back,
  // and always with the bar in view.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    setBarHidden(false);
  }, [stepId, raw]);

  // Scrolling down is reading, so the bar gets out of the way; any scroll up
  // means the reader wants their bearings, so it comes back. The threshold
  // ignores rubber-band jitter.
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y > last + 4 && y > 120) {
        setBarHidden(true);
        setMenuOpen(false);
      } else if (y < last - 4) {
        setBarHidden(false);
      }
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The dropdown closes like the topic panel does: Escape, or any press
  // outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onPress = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPress);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPress);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const toggleAnswer = (index: number) => {
    const next = new Set(open);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setOpen(next);
  };

  // A paid step, refused. 401 is "who are you", 402 is "pay first"; each
  // gets the one action that fixes it, not an error tone — the reader did
  // nothing wrong.
  if (denied === 401)
    return (
      <div className="gate">
        <h2>This lesson is in the paid tier</h2>
        <p className="muted">Sign in first, then unlock everything with a one-time purchase.</p>
        <Link className="navlink primary" to="/signin">
          Sign in
        </Link>
      </div>
    );
  if (denied === 402)
    return (
      <div className="gate">
        <h2>This lesson is in the paid tier</h2>
        <p className="muted">
          One purchase unlocks every topic, lesson, question and answer, for good.
        </p>
        <Link className="navlink primary" to="/upgrade">
          Unlock everything
        </Link>
      </div>
    );

  if (error && !step) return <p className="error">{error}</p>;
  if (!step || !lesson) return <p className="muted">Loading…</p>;

  const answers = reference && 'answers' in reference ? reference : null;
  const blob = reference && 'blob' in reference ? reference.blob : null;
  // `section` is clamped to [1, count] above and `lesson` always has at
  // least one section, so this cannot miss; the fallback satisfies the types.
  const current = lesson.sections[section - 1] ?? { title: step.title, body: '' };
  const prev = lesson.sections[section - 2];
  const next = lesson.sections[section];

  return (
    <>
      <div className={barHidden ? 'stepbar hidden' : 'stepbar'}>
        <span className="stepbar-title">{step.title}</span>

        <span
          className="dots"
          aria-label={checking ? 'Key summary' : `Section ${section} of ${count}`}
        >
          {lesson.sections.map((entry, index) => (
            <span key={entry.title} className={checking || index < section ? 'dot on' : 'dot'} />
          ))}
        </span>

        <div className="menu" ref={menu}>
          <button className="quiet" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
            Sections ▾
          </button>
          {menuOpen && (
            <div className="menu-list" aria-label={`Sections of ${step.title}`}>
              {lesson.sections.map((entry, index) => (
                <button
                  key={entry.title}
                  aria-current={!checking && section === index + 1 ? 'true' : undefined}
                  onClick={() => goTo(index + 1)}
                >
                  {index + 1}. {entry.title}
                </button>
              ))}
              {/* The one entry that is not just another section: the questions
                  are the point of the lesson, so it is marked rather than left
                  to look like a seventh heading. */}
              <button
                className="menu-key"
                aria-current={checking ? 'true' : undefined}
                onClick={() => goTo('check')}
              >
                <span aria-hidden="true" className="menu-key-mark">
                  ◆
                </span>
                Key summary
              </button>
              <hr className="divider" />
              <button onClick={() => void navigate(`/topic/${step.topic}`)}>← Roadmap</button>
            </div>
          )}
        </div>
      </div>

      <div className="step-content">
        {checking ? (
          <>
            <h3 style={{ marginTop: '1.5rem' }}>Key summary</h3>

            <div className="stack" style={{ gap: '0.6rem', margin: '1.25rem 0' }}>
              {step.parts.map((part, index) => (
                <div key={part} className="card qa">
                  <div className="qa-head">
                    <span className="qa-question">{part}</span>
                    <button className="quiet" onClick={() => toggleAnswer(index)}>
                      {open.has(index) ? 'Hide' : 'Show answer'}
                    </button>
                  </div>
                  {open.has(index) && answers && answers.answers[index] && (
                    <div
                      className="prose"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(answers.answers[index]) }}
                    />
                  )}
                  {open.has(index) && blob && (
                    <div
                      className="reference prose"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(blob) }}
                    />
                  )}
                </div>
              ))}
            </div>

            {answers?.extra && (
              <div
                className="card prose"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(answers.extra) }}
              />
            )}

            <div className="row" style={{ marginTop: '1.5rem' }}>
              {/* Out, not back. This is the end of the lesson, so the useful
                  move is choosing the next one; re-reading the last section is
                  a click away in the section list either way. */}
              <button className="primary" onClick={() => void navigate(`/topic/${step.topic}`)}>
                ← Back to the roadmap
              </button>
            </div>
          </>
        ) : (
          <>
            {section === 1 && lesson.preamble && (
              <div
                className="prose"
                style={{ marginBottom: '1.5rem' }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(lesson.preamble) }}
              />
            )}

            <article
              className="prose"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(`## ${current.title}\n\n${current.body}`),
              }}
            />

            <div className="row pager">
              {prev ? <button onClick={() => goTo(section - 1)}>← {prev.title}</button> : <span />}
              {next ? (
                <button className="primary" onClick={() => goTo(section + 1)}>
                  Next: {next.title} →
                </button>
              ) : (
                <button className="primary" onClick={() => goTo('check')}>
                  Key summary →
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
