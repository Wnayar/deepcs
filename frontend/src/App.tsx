import { useEffect, useState } from 'react';
import { ensureProfile, type Question, type Session } from './api';
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

  // Users creates the profile row lazily on this call, and `/match/join`
  // refuses a uid it has never seen — so this has to happen once per sign-in,
  // before the user can reach anything that matters.
  useEffect(() => {
    if (user) void ensureProfile().catch(() => {});
  }, [user]);

  if (!ready) return <main className="muted">Loading…</main>;

  return (
    <>
      <header>
        <h1>deepcs</h1>
        <nav>
          <button onClick={() => setView({ name: 'questions' })}>Questions</button>
          {user && <button onClick={() => setView({ name: 'match' })}>Find a partner</button>}
          {user ? (
            <>
              <span className="muted">{user.email}</span>
              <button onClick={() => void signOutUser()}>Sign out</button>
            </>
          ) : (
            <span className="muted">signed out</span>
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
              onMatched={(session, question) => setView({ name: 'session', session, question })}
            />
          ) : (
            <LoginPage />
          ))}

        {view.name === 'session' && user && (
          <SessionPage
            session={view.session}
            question={view.question}
            displayName={user.email ?? user.uid}
            onEnded={(summary) => setView({ name: 'summary', summary })}
          />
        )}

        {view.name === 'summary' && (
          <SummaryPage summary={view.summary} onDone={() => setView({ name: 'questions' })} />
        )}
      </main>
    </>
  );
}
