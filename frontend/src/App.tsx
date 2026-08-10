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

/**
 * How often the shell asks whether a partner has turned up.
 *
 * Slower than the match screen's own poll, because this one runs while you are
 * doing something else and only exists to notice an event you would otherwise
 * miss entirely.
 */
const ACTIVE_SESSION_POLL_MS = 4_000;

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
  /** True when a session appeared while the user was somewhere else, so the
   * header can say a partner has arrived rather than inviting them back to a
   * room they have never been in. */
  const [arrived, setArrived] = useState(false);
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

  /**
   * Keep asking, until there is a session to be in.
   *
   * Being matched is something that happens *to* you. Whoever joins the queue
   * first is matched by the second person's request, and is usually not looking
   * at the match screen when it lands: they queued, got bored, and went to read
   * a lesson. The match screen polls, but it unmounts when you navigate away,
   * so that person ended up in a session nobody had told them about, while
   * their partner sat alone in the editor.
   *
   * Asking from the shell instead means it is noticed from any page. It stops
   * as soon as there is a session, so this is not a background timer for the
   * whole visit, and it is a primary-key lookup on an indexed column.
   */
  useEffect(() => {
    if (!user || active) return;
    const timer = setInterval(() => {
      void currentSession()
        .then((session) => {
          if (!session) return;
          setActive(session);
          setArrived(true);
        })
        .catch(() => {
          /* transient, and the next tick tries again */
        });
    }, ACTIVE_SESSION_POLL_MS);
    return () => clearInterval(timer);
  }, [user, active]);

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
            <SessionNavEntry
              sessionId={active.id}
              arrived={arrived}
              onSeen={() => setArrived(false)}
            />
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

/**
 * The header entry for a session in progress.
 *
 * Three states rather than two, and the third is the one worth having.
 * "Return to session" is the right words for somebody who stepped out of a room
 * they have been in. It is the wrong words for the person who queued, wandered
 * off, and was matched by their partner's request without ever seeing the room:
 * nothing has happened yet that they could return from. They are told a partner
 * turned up instead.
 */
function SessionNavEntry({
  sessionId,
  arrived,
  onSeen,
}: {
  sessionId: string;
  arrived: boolean;
  onSeen: () => void;
}) {
  const here = useLocation().pathname === `/session/${sessionId}`;

  useEffect(() => {
    if (here) onSeen();
  }, [here, onSeen]);

  if (here) return <span className="live">In session</span>;
  return (
    <NavLink className="navlink primary" to={`/session/${sessionId}`}>
      {arrived ? 'Partner found, join now' : 'Return to session'}
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
