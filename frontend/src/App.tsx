import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { currentSession, ensureProfile, type Question, type Session } from './api';
import { signOutUser, watchUser, type User } from './auth';
import { useTheme } from './theme';
import { RoadmapPage } from './pages/Roadmap';
import { StepPage } from './pages/Step';
import { LoginPage } from './pages/Login';
import { MatchPage } from './pages/Match';
import { SessionRoute } from './pages/Session';
import { SummaryPage } from './pages/Summary';

export interface SessionSummary {
  question: Question;
  startedAt: string;
  endedAt: string;
  revealed: boolean;
}

/**
 * The shell: the header, and which screen is on the page.
 *
 * Screens are URLs rather than a `useState` switch. That switch was fine at
 * three screens and stopped being fine at six: the whole site lived at one
 * address, so the browser held a single history entry for it, Back left the
 * site entirely, refreshing lost your place, and no lesson could be linked to.
 *
 * A URL is a promise that the page can be rebuilt from it, and every route here
 * keeps that promise by refetching rather than relying on state it was handed.
 * The one exception is the summary, which is why it has no URL of its own.
 */
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<Session | null>(null);
  const [theme, toggleTheme] = useTheme();

  useEffect(
    () =>
      watchUser((next) => {
        setUser(next);
        setReady(true);
      }),
    [],
  );

  // Users creates the profile row lazily on this call, and `/match/join`
  // refuses a uid it has never seen, so this has to happen once per sign-in
  // before the user can reach anything that matters.
  //
  // Asking for the active session in the same pass is what stops the app lying
  // about where you are: navigating away from the editor closes the socket but
  // does not end anything, so without this the header would keep offering to
  // find a partner while you were still in a room.
  useEffect(() => {
    if (!user) return setActive(null);
    void ensureProfile().catch(() => {});
    void currentSession()
      .then(setActive)
      .catch(() => setActive(null));
  }, [user]);

  if (!ready) return <main className="muted">Loading…</main>;

  return (
    <>
      <header>
        <h1>
          <Link className="wordmark" to="/">
            deepcs
          </Link>
        </h1>

        <nav>
          {/* Links, not buttons that navigate. A `<button>` inside an `<a>` is
              invalid markup and behaves unpredictably, and a link is what these
              actually are: middle-click and open-in-new-tab work for free.
              `.navlink` gives them the look of the buttons beside them, and
              NavLink marks the current route itself so the highlight cannot
              drift out of step with what is on screen. */}
          <NavLink className="navlink" to="/">
            Roadmap
          </NavLink>

          {/* Three states, not two. "Return to session" while you are already
              looking at it is a link that goes nowhere, so being in the room
              gets its own quiet marker and only leaving it turns into a call to
              go back. */}
          {active ? (
            <SessionNavEntry sessionId={active.id} />
          ) : (
            <NavLink className="navlink" to="/match">
              Find a partner
            </NavLink>
          )}

          {/* Always present, signed in or out. Signed out it is the way in;
              signed in it is where you go to leave, and hiding it would mean
              the only account control appears and disappears depending on state
              the visitor cannot see. */}
          {user ? (
            <button className="quiet" onClick={() => void signOutUser()} title={user.email ?? ''}>
              Sign out
            </button>
          ) : (
            <NavLink className="navlink" to="/signin">
              Sign in
            </NavLink>
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

      <Routes>
        {/* The roadmap and an open topic are the same screen: the panel sits
            over the map, so giving it its own URL is what makes Back close it
            rather than leave the site. */}
        <Route path="/" element={<Wide />}>
          <Route index element={<RoadmapPage />} />
          <Route path="topic/:topic" element={<RoadmapPage />} />
        </Route>

        <Route element={<Narrow />}>
          <Route path="/step/:id" element={<StepPage signedIn={Boolean(user)} />} />
          <Route path="/signin" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route
            path="/match"
            element={user ? <MatchPage active={active} onJoined={setActive} /> : <LoginPage />}
          />
          <Route
            path="/session/:id"
            element={
              user ? (
                <SessionRoute onEnded={() => setActive(null)} />
              ) : (
                <Navigate to="/signin" replace />
              )
            }
          />
          <Route path="/summary" element={<SummaryPage />} />
          {/* Anything else is a typo or a stale link, and the roadmap is the
              one page that always makes sense to land on. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}

/** The header entry for a session in progress. Separate so it can ask the
 * router whether the session page is the one currently open. */
function SessionNavEntry({ sessionId }: { sessionId: string }) {
  const here = useLocation().pathname === `/session/${sessionId}`;
  if (here) return <span className="live">In session</span>;
  return (
    <NavLink className="navlink primary" to={`/session/${sessionId}`}>
      Return to session
    </NavLink>
  );
}

/** The roadmap is a canvas and fills the window; every other screen is a
 * document and gets a reading width. Two layouts, one place each. */
function Wide() {
  return (
    <main className="wide">
      <Outlet />
    </main>
  );
}

function Narrow() {
  return (
    <main>
      <Outlet />
    </main>
  );
}
