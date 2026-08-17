import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { getStep, questionReference, type Step } from '../api';
import { splitLesson, splitReference, type SplitReference } from '../lesson-sections';

/**
 * One step as a focused read: a slim bar carrying where you are, then one
 * lesson section per screen in a single centred column, then a closing screen
 * where each question reveals its own answer.
 *
 * Everything that is not the current section lives in the bar's dropdown, so
 * a screen holds exactly: where you are, one section, and the way onward. The
 * topic's other steps are not shown at all; moving on goes back out through
 * the roadmap. The bar hides while you scroll down and returns when you
 * scroll up, the way mobile browser chrome does.
 *
 * The questions come first on purpose. Reading without knowing what it is for
 * is where people give up, and three lines at the top saying "this is what you
 * will be able to answer" turns the same material into something with an end.
 *
 * The section lives in the URL (`?s=2`, `?s=check`) rather than component
 * state, so refresh keeps your place and Back is "previous section" instead of
 * "leave the lesson".
 *
 * `marked` output goes in through `dangerouslySetInnerHTML`, which is safe
 * here for a reason worth stating rather than assuming: this markdown is
 * seeded by a migration from a fixed set of notes, no user writes it, and no
 * route updates it. The day lessons start accepting submissions is the day
 * that line needs a sanitizer in front of it.
 */
export function StepPage({ signedIn }: { signedIn: boolean }) {
  const navigate = useNavigate();
  const { id: stepId = '' } = useParams();
  const [params, setParams] = useSearchParams();

  const [step, setStep] = useState<Step | null>(null);
  const [reference, setReference] = useState<SplitReference | { blob: string } | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [loadingAnswers, setLoadingAnswers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [barHidden, setBarHidden] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStep(null);
    setReference(null);
    setOpen(new Set());
    setError(null);
    getStep(stepId)
      .then(setStep)
      .catch(() => setError('This step could not be loaded. Try refreshing the page.'));
  }, [stepId]);

  const lesson = useMemo(() => {
    if (!step) return null;
    const split = splitLesson(step.lessonMd);
    // A short lesson with no headings still gets a screen of its own.
    if (split.sections.length === 0)
      return { preamble: '', sections: [{ title: step.title, body: split.preamble }] };
    return split;
  }, [step]);

  // Which screen the URL names: a 1-based section number, or the check screen.
  // e.g. /step/abc shows section 1, /step/abc?s=3 the third, /step/abc?s=check
  // the questions. Out-of-range numbers clamp instead of erroring.
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

  // The key is fetched once, on the first reveal, and split per question. A key
  // without the `### N.` numbering cannot be split, so it is kept whole and
  // every card shows all of it rather than nothing.
  const toggleAnswer = async (index: number) => {
    const next = new Set(open);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setOpen(next);

    if (reference || !next.has(index)) return;
    setLoadingAnswers(true);
    try {
      const { referenceMd } = await questionReference(stepId);
      setReference(splitReference(referenceMd) ?? { blob: referenceMd });
    } catch {
      setError('The answers could not be loaded. Try again in a moment.');
      setOpen(new Set());
    } finally {
      setLoadingAnswers(false);
    }
  };

  if (error && !step) return <p className="error">{error}</p>;
  if (!step || !lesson) return <p className="muted">Loading…</p>;

  const answers = reference && 'answers' in reference ? reference : null;
  const blob = reference && 'blob' in reference ? reference.blob : null;
  // `section` is clamped to [1, count] above and `lesson` always has at least
  // one section, so this cannot miss; the fallback only satisfies the types.
  const current = lesson.sections[section - 1] ?? { title: step.title, body: '' };
  const prev = lesson.sections[section - 2];
  const next = lesson.sections[section];

  return (
    <>
      <div className={barHidden ? 'stepbar hidden' : 'stepbar'}>
        <span className="stepbar-title">
          Step {step.step} · {step.title}
        </span>

        <span
          className="dots"
          aria-label={checking ? 'Check yourself' : `Section ${section} of ${count}`}
        >
          {lesson.sections.map((entry, index) => (
            <span
              key={entry.title}
              className={checking || index < section ? 'dot on' : 'dot'}
            />
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
              <button aria-current={checking ? 'true' : undefined} onClick={() => goTo('check')}>
                Check yourself
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
            <h3 style={{ marginTop: '1.5rem' }}>Ready to check yourself?</h3>
            <p className="muted">
              Try answering each question out loud before revealing anything. Working through them
              with someone else is the version that actually sticks, because you have to say it
              rather than recognise it.
            </p>

            <div className="stack" style={{ gap: '0.6rem', margin: '1.25rem 0' }}>
              {step.parts.map((part, index) => (
                <div key={part} className="card qa">
                  <div className="qa-head">
                    <span className="qa-question">{part}</span>
                    {signedIn && (
                      <button
                        className="quiet"
                        onClick={() => void toggleAnswer(index)}
                        disabled={loadingAnswers}
                      >
                        {loadingAnswers && open.has(index)
                          ? 'Loading…'
                          : open.has(index) && reference
                            ? 'Hide'
                            : 'Show answer'}
                      </button>
                    )}
                  </div>
                  {open.has(index) && answers && answers.answers[index] && (
                    <div
                      className="prose"
                      dangerouslySetInnerHTML={{ __html: marked.parse(answers.answers[index]) }}
                    />
                  )}
                  {open.has(index) && blob && (
                    <div
                      className="reference prose"
                      dangerouslySetInnerHTML={{ __html: marked.parse(blob) }}
                    />
                  )}
                </div>
              ))}
            </div>

            {!signedIn && <p className="muted">Sign in to see the answers.</p>}
            {error && <p className="error">{error}</p>}

            {answers?.extra && (
              <div
                className="card prose"
                dangerouslySetInnerHTML={{ __html: marked.parse(answers.extra) }}
              />
            )}

            <div className="row" style={{ marginTop: '1.5rem' }}>
              <button
                className="primary"
                onClick={() =>
                  void navigate(`/match?topic=${step.topic}&difficulty=${step.difficulty}`)
                }
              >
                Work through it with a partner
              </button>
              <button onClick={() => goTo(count)}>← Back to the lesson</button>
            </div>
          </>
        ) : (
          <>
            {section === 1 && (
              <>
                <div className="card" style={{ margin: '0 0 2rem' }}>
                  <h3 style={{ marginBottom: '0.75rem' }}>What you should be able to answer</h3>
                  <ol className="checklist">
                    {step.parts.map((part) => (
                      <li key={part}>{part}</li>
                    ))}
                  </ol>
                </div>
                {lesson.preamble && (
                  <div
                    className="prose"
                    style={{ marginBottom: '1.5rem' }}
                    dangerouslySetInnerHTML={{ __html: marked.parse(lesson.preamble) }}
                  />
                )}
              </>
            )}

            <article
              className="prose"
              dangerouslySetInnerHTML={{
                __html: marked.parse(`## ${current.title}\n\n${current.body}`),
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
                  Check yourself →
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
