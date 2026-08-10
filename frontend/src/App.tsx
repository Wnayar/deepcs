import { useEffect, useState } from 'react';
import {
  currentSession,
  ensureProfile,
  getQuestion,
  type Difficulty,
  type Question,
  type RoadmapTopic,
  type Session,
} from './api';
import { signOutUser, watchUser, type User } from './auth';
import { useTheme } from './theme';
import { RoadmapPage } from './pages/Roadmap';
import { TopicDialog } from './pages/TopicDialog';
import { StepPage } from './pages/Step';
import { LoginPage } from './pages/Login';
import { MatchPage } from './pages/Match';
import { SessionPage } from './pages/Session';
import { SummaryPage } from './pages/Summary';

/**
 * A `useState` switch rather than a router. There are six screens and no
 * deep-linking requirement in this phase, so react-router would be a
 * dependency and a concept for nothing. The one place it costs something is
 * noted on the session screen: a refresh mid-session drops you back to the
 * roadmap rather than rejoining.
 */
export type View =
  | { name: 'roadmap' }
  | { name: 'step'; stepId: string }
  | { name: 'signin' }
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
  const [view, setView] = useState<View>({ name: 'roadmap' });
  const [openTopic, setOpenTopic] = useState<RoadmapTopic | null>(null);
  const [theme, toggleTheme] = useTheme();

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
  // refuses a uid it has never seen, so this has to happen once per sign-in
  // before the user can reach anything that matters.
  //
  // Asking for the active session in the same pass is what stops the app lying
  // about where you are: navigating away from the editor closes the socket but
  // does not end anything, so without this the nav would keep offering to
  // find a partner while you were still in a room.
  useEffect(() => {
    if (!user) return setActive(null);
    void ensureProfile().catch(() => {});
    void currentSession()
      .then(setActive)
      .catch(() => setActive(null));
  }, [user]);

  /** Back into a session already in progress. The room is rebuilt from its
   * snapshot on the server, so this resumes rather than restarts. */
  const resume = async (session: Session) => {
    try {
      setView({ name: 'session', session, question: await getQuestion(session.questionId) });
    } catch {
      /* the nav entry stays, and trying again is harmless */
    }
  };

  const openStep = (stepId: string) => {
    setOpenTopic(null);
    setView({ name: 'step', stepId });
  };

  /** Signed out, anything that needs an account goes to the sign-in form
   * instead of to a dead end. */
  const guarded = (next: View): View => (user ? next : { name: 'signin' });

  if (!ready) return <main className="muted">Loading…</main>;

  const onRoadmap = view.name === 'roadmap' || view.name === 'step';

  return (
    <>
      <header>
        <h1>
          <button className="wordmark" onClick={() => setView({ name: 'roadmap' })}>
            deepcs
          </button>
        </h1>

        <nav>
          <button
            aria-current={onRoadmap ? 'page' : undefined}
            onClick={() => setView({ name: 'roadmap' })}
          >
            Roadmap
          </button>

          {/* Three states, not two. "Return to session" while you are already
              looking at it is a button that does nothing, so being in the room
              gets its own quiet marker and only leaving it turns into a call
              to go back. */}
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
              onClick={() => setView(guarded({ name: 'match' }))}
            >
              Find a partner
            </button>
          )}

          {/* Always present, signed in or out. Signed out it is the way in;
              signed in it is where you go to leave, and hiding it would mean
              the only account control appears and disappears depending on
              state the visitor cannot see. */}
          {user ? (
            <button className="quiet" onClick={() => void signOutUser()} title={user.email ?? ''}>
              Sign out
            </button>
          ) : (
            <button
              aria-current={view.name === 'signin' ? 'page' : undefined}
              onClick={() => setView({ name: 'signin' })}
            >
              Sign in
            </button>
          )}

          <button
            className="quiet"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </nav>
      </header>

      <main className={view.name === 'roadmap' ? 'wide' : undefined}>
        {view.name === 'roadmap' && <RoadmapPage onOpenTopic={setOpenTopic} />}

        {view.name === 'step' && (
          <StepPage
            stepId={view.stepId}
            signedIn={Boolean(user)}
            onOpenStep={openStep}
            onBack={() => setView({ name: 'roadmap' })}
            onPractise={(topic, difficulty) =>
              setView(guarded({ name: 'match', preset: { topic, difficulty } }))
            }
          />
        )}

        {view.name === 'signin' && <LoginPage />}

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
          <SummaryPage summary={view.summary} onDone={() => setView({ name: 'roadmap' })} />
        )}
      </main>

      {/* Over the roadmap rather than replacing it, so closing it puts you
          back exactly where you were on the map. */}
      {openTopic && view.name === 'roadmap' && (
        <TopicDialog topic={openTopic} onOpenStep={openStep} onClose={() => setOpenTopic(null)} />
      )}
    </>
  );
}
