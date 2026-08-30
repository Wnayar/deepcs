import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { renderMarkdown } from '../markdown';
import { ApiError, getStep, type StepDetail } from '../api';
import { splitLesson, splitReference, type SplitReference } from '../lesson-sections';

/** Rendered lesson markdown; content comes from the build, never users. */
function Prose({
  md,
  className = 'prose',
  style,
}: {
  md: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }}
    />
  );
}

/**
 * One step as a focused read: one lesson section per screen, then a closing
 * screen where each question reveals its answer. The section lives in the
 * URL (`?s=2`, `?s=check`) so refresh keeps your place and Back means
 * "previous section". A paid step answers 401 or 402 and this page turns
 * each into its prompt (sign in / upgrade) rather than an error.
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
    // signedIn: signing in changes what this fetch is allowed to see.
  }, [stepId, signedIn]);

  const lesson = useMemo(() => {
    if (!step) {
      return null;
    }

    const split = splitLesson(step.lessonMd);

    // A short lesson with no headings still gets a screen of its own.
    if (split.sections.length === 0) {
      return { preamble: '', sections: [{ title: step.title, body: split.preamble }] };
    }

    return split;
  }, [step]);

  /** The answer key, split per question; unsplittable keys are kept whole
   * and every card shows all of it rather than nothing. */
  const reference = useMemo<SplitReference | { blob: string } | null>(() => {
    if (!step || !step.referenceMd) {
      return null;
    }

    const split = splitReference(step.referenceMd);

    if (split === null) {
      return { blob: step.referenceMd };
    }

    return split;
  }, [step]);

  const count = lesson?.sections.length ?? 1;
  const raw = params.get('s');
  const checking = raw === 'check';

  // Out-of-range section numbers clamp instead of erroring.
  const requested = Number(raw) || 1;
  const clamped = Math.min(Math.max(requested, 1), count);
  const section = checking ? count : clamped;

  /** Moves to a section, or to the key summary. Section 1 drops the param,
   * so a step's plain URL is its first screen. */
  const goTo = (next: number | 'check') => {
    setMenuOpen(false);

    if (next === 'check') {
      setParams({ s: 'check' });
      return;
    }

    if (next > 1) {
      setParams({ s: String(next) });
      return;
    }

    setParams({});
  };

  // A new screen starts at its top with the bar in view.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    setBarHidden(false);
  }, [stepId, raw]);

  // The bar hides on scroll down and returns on any scroll up; the
  // threshold ignores rubber-band jitter.
  useEffect(() => {
    let last = window.scrollY;

    const onScroll = () => {
      const y = window.scrollY;
      const wentDown = y > last + 4 && y > 120;
      const wentUp = y < last - 4;

      if (wentDown) {
        setBarHidden(true);
        setMenuOpen(false);
      } else if (wentUp) {
        setBarHidden(false);
      }

      last = y;
    };

    window.addEventListener('scroll', onScroll, { passive: true });

    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The dropdown closes on Escape or any press outside it.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const onPress = (event: PointerEvent) => {
      const inside = menu.current?.contains(event.target as Node) ?? false;

      if (!inside) {
        setMenuOpen(false);
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPress);
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('pointerdown', onPress);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  /** Reveals or re-hides one question's answer. */
  const toggleAnswer = (index: number) => {
    const next = new Set(open);

    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }

    setOpen(next);
  };

  // A refused paid step gets the one action that fixes it, not an error
  // tone: the reader did nothing wrong.
  if (denied === 401) {
    return (
      <div className="gate">
        <h2>Part of DeepCS Pro</h2>
        <p className="muted">Sign in to continue.</p>
        <Link className="navlink primary" to="/signin" state={{ from: window.location.pathname }}>
          Sign in
        </Link>
      </div>
    );
  }

  // A signed-in reader who opened a Pro lesson has already shown intent:
  // no interstitial, straight to the offer.
  if (denied === 402) {
    return <Navigate to="/upgrade" replace />;
  }

  if (error && !step) {
    return <p className="error">{error}</p>;
  }

  if (!step || !lesson) {
    return <p className="muted">Loading…</p>;
  }

  // A key that split into numbered answers feeds the cards one at a time; an
  // unsplittable one is shown whole under every card.
  let answers: SplitReference | null = null;
  let blob: string | null = null;

  if (reference !== null) {
    if ('answers' in reference) {
      answers = reference;
    } else {
      blob = reference.blob;
    }
  }

  // section is clamped above, so the fallback only satisfies the types.
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
          {lesson.sections.map((entry, index) => {
            const reached = checking || index < section;

            return <span key={entry.title} className={reached ? 'dot on' : 'dot'} />;
          })}
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
              {/* Marked, not styled as another section: the questions are
                  the point of the lesson. */}
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
                    <Prose md={answers.answers[index]} />
                  )}
                  {open.has(index) && blob && <Prose className="reference prose" md={blob} />}
                </div>
              ))}
            </div>

            {answers?.extra && <Prose className="card prose" md={answers.extra} />}

            <div className="row" style={{ marginTop: '1.5rem' }}>
              <button className="primary" onClick={() => void navigate(`/topic/${step.topic}`)}>
                ← Back to the roadmap
              </button>
            </div>
          </>
        ) : (
          <>
            {section === 1 && lesson.preamble && (
              <Prose md={lesson.preamble} style={{ marginBottom: '1.5rem' }} />
            )}

            <Prose md={`## ${current.title}\n\n${current.body}`} />

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
