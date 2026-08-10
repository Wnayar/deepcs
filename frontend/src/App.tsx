import { useEffect, useState } from 'react';
import {
  currentSession,
  ensureProfile,
  getQuestion,
  type Difficulty,
  type Question,
  type Session,
} from './api';
import { signOutUser, watchUser, type User } from './auth';
import { LearnPage } from './pages/Learn';
import { LessonPage } from './pages/Lesson';
import { LoginPage } from './pages/Login';
import { QuestionsPage } from './pages/Questions';
import { MatchPage } from './pages/Match';
import { SessionPage } from './pages/Session';
import { SummaryPage } from './pages/Summary';

/**
 * A `useState` switch rather than a router. There are seven screens and no
 * deep-linking requirement in this phase, so react-router would be a
 * dependency and a concept for nothing. The one place it costs something is
 * noted on the session screen: a refresh mid-session drops you back to the
 * question list rather than rejoining.
 */
export type View =
  | { name: 'learn' }
  | { name: 'lesson'; topic: string }
  | { name: 'questions' }
  | { name: 'match'; preset?: { topic: string; difficulty: Difficulty } }
  | { name: 'session'; session: Session; question: Question }
  | { name: 'summary'; summary: SessionSummary };

export interface SessionSummary {
  question: Question;
  startedAt: string;
  endedAt: string;
  revealed: boolean;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  // Learn, not the bank. The material is the thing you can use without an
  // account and without a partner, so it is what an arriving visitor sees.
  const [view, setView] = useState<View>({ name: 'learn' });

  useEffect(
    () =>
      watchUser((next) => {
        setUser(next);
        setReady(true);
      }),
    [],
  );

  const [active, setActive] = useState<Session | null>(null);

  // Users creates the profile row lazily on this call, and `/match/join`
  // refuses a uid it has never seen — so this has to happen once per sign-in,
  // before the user can reach anything that matters.
  //
  // Asking for the active session in the same pass is what stops the app lying
  // about where you are: navigating away from the editor closes the socket but
  // does not end anything, so without this the nav would keep offering to
  // "find a partner" while you were still in a room.
  useEffect(() => {
    if (!user) return setActive(null);
    void ensureProfile().catch(() => {});
    void currentSession()
      .then(setActive)
      .catch(() => setActive(null));
  }, [user]);

  /** Back into a session already in progress. The room is rebuilt from its
   * snapshot server-side, so this resumes rather than restarts. */
  const resume = async (session: Session) => {
    try {
      setView({ name: 'session', session, question: await getQuestion(session.questionId) });
    } catch {
      /* the nav entry stays; trying again is harmless */
    }
  };

  if (!ready) return <main className="muted">Loading…</main>;

  return (
    <>
      <header>
        {/* The wordmark is the way back to the front page — an inert <h1>
            in the corner of an app is a dead end everyone tries to click. */}
        <h1>
          <button className="wordmark" onClick={() => setView({ name: 'learn' })}>
            deepcs
          </button>
        </h1>
        <nav>
          {/* `aria-current` is what marks the tab you are on, and the blue
              outline in styles.css is drawn from it rather than from a second
              class — so the highlight cannot drift out of step with what a
              screen reader announces. A lesson counts as being under Learn. */}
          <button
            aria-current={view.name === 'learn' || view.name === 'lesson' ? 'page' : undefined}
            onClick={() => setView({ name: 'learn' })}
          >
            Learn
          </button>
          <button
            aria-current={view.name === 'questions' ? 'page' : undefined}
            onClick={() => setView({ name: 'questions' })}
          >
            Questions
          </button>
          {/* Shown signed out too, and it has to be: the match view falls back
              to the sign-in form, so this is the only route to it. Hiding it
              until you are signed in leaves a signed-out visitor with no way
              to sign in at all. */}
          {/* Three states, not two. "Return to session" while you are already
              looking at it is a button that does nothing, so being in the room
              gets its own quiet green marker and only leaving it turns into a
              blue call to go back. */}
          {active ? (
            view.name === 'session' ? (
              <span className="live">In session</span>
            ) : (
              <button className="primary" onClick={() => void resume(active)}>
                Return to session
              </button>
            )
          ) : (
            <button
              aria-current={view.name === 'match' ? 'page' : undefined}
              onClick={() => setView({ name: 'match' })}
            >
              {user ? 'Find a partner' : 'Sign in'}
            </button>
          )}
          {user && (
            <>
              <span className="muted">{user.email}</span>
              <button onClick={() => void signOutUser()}>Sign out</button>
            </>
          )}
        </nav>
      </header>

      <main>
        {/* The bank is public (DESIGN.md §2) — a signed-out visitor can browse
            and read, which is what makes the deployed site useful to one
            person rather than an empty room. */}
        {view.name === 'learn' && (
          <LearnPage onOpen={(topic) => setView({ name: 'lesson', topic })} />
        )}

        {view.name === 'lesson' && (
          <LessonPage
            topic={view.topic}
            onBack={() => setView({ name: 'learn' })}
            onPractise={(topic, difficulty) =>
              setView({ name: 'match', preset: { topic, difficulty } })
            }
          />
        )}

        {view.name === 'questions' && <QuestionsPage signedIn={Boolean(user)} />}

        {view.name === 'match' &&
          (user ? (
            <MatchPage
              preset={view.preset}
              active={active}
              onMatched={(session, question) => {
                setActive(session);
                setView({ name: 'session', session, question });
              }}
              onResume={(session) => void resume(session)}
            />
          ) : (
            <LoginPage />
          ))}

        {view.name === 'session' && user && (
          <SessionPage
            session={view.session}
            question={view.question}
            onEnded={(summary) => {
              setActive(null);
              setView({ name: 'summary', summary });
            }}
          />
        )}

        {view.name === 'summary' && (
          <SummaryPage summary={view.summary} onDone={() => setView({ name: 'learn' })} />
        )}
      </main>
    </>
  );
}
