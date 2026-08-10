import { useEffect, useState } from 'react';
import { currentSession, ensureProfile, getQuestion, type Question, type Session } from './api';
import { signOutUser, watchUser, type User } from './auth';
import { LoginPage } from './pages/Login';
import { QuestionsPage } from './pages/Questions';
import { MatchPage } from './pages/Match';
import { SessionPage } from './pages/Session';
import { SummaryPage } from './pages/Summary';

/**
 * A `useState` switch rather than a router. There are five screens and no
 * deep-linking requirement in this phase, so react-router would be a
 * dependency and a concept for nothing. The one place it costs something is
 * noted on the session screen: a refresh mid-session drops you back to the
 * question list rather than rejoining.
 */
export type View =
  | { name: 'questions' }
  | { name: 'match' }
  | { name: 'session'; session: Session; question: Question }
  | { name: 'summary'; summary: SessionSummary };

export interface SessionSummary {
  question: Question;
  partnerUid: string;
  startedAt: string;
  endedAt: string;
  revealed: boolean;
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>({ name: 'questions' });

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
          <button
            onClick={() => setView({ name: 'questions' })}
            style={{
              border: 0,
              background: 'none',
              padding: 0,
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            deepcs
          </button>
        </h1>
        <nav>
          <button onClick={() => setView({ name: 'questions' })}>Questions</button>
          {/* Shown signed out too, and it has to be: the match view falls back
              to the sign-in form, so this is the only route to it. Hiding it
              until you are signed in leaves a signed-out visitor with no way
              to sign in at all. */}
          {active ? (
            <button className="primary" onClick={() => void resume(active)}>
              Return to session
            </button>
          ) : (
            <button onClick={() => setView({ name: 'match' })}>
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
        {view.name === 'questions' && <QuestionsPage signedIn={Boolean(user)} />}

        {view.name === 'match' &&
          (user ? (
            <MatchPage
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
          <SummaryPage summary={view.summary} onDone={() => setView({ name: 'questions' })} />
        )}
      </main>
    </>
  );
}
