import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { currentSession, ensureProfile, type Question, type Session } from './api';
import { signOutUser, watchUser, type User } from './auth';
import { useTheme } from './theme';
import { clearQueued, nextDelayMs, readQueued } from './queue';
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
  /** True when a session appeared while the user was somewhere else, so the
   * header can say a partner has arrived rather than inviting them back to a
   * room they have never been in. */
  const [arrived, setArrived] = useState(false);
  /** Bumped when the queue is joined or left, purely to restart the watcher
   * below: the flag it reads lives in storage, which React cannot observe. */
  const [queuedAt, setQueuedAt] = useState(0);
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
   * Watch for a partner, from wherever the reader happens to be.
   *
   * Being matched is something that happens *to* you: whoever queues first is
   * matched by the second person's request. The match screen notices that, but
   * only while it is on screen, so somebody who queued and went to read a
   * lesson was put into a session nobody told them about.
   *
   * Three conditions guard it, and each one is a cost decision as much as a
   * correctness one:
   *
   *   - **Only while queued.** Watching whenever someone is signed in and has
   *     no session meant every reader polled forever. Neon suspends idle
   *     compute and Cloud Run scales to zero, and neither can happen while a
   *     request arrives every few seconds, so an idle tab was an always-on
   *     database and two always-on services billed all month.
   *   - **Only while the tab is in front.** A backgrounded tab has nobody to
   *     tell.
   *   - **Not forever, and not at a fixed rate.** A match is most likely in the
   *     first moments; after that the cost of asking is unchanged and the odds
   *     are not, so the gap widens and eventually it gives up.
   */
  useEffect(() => {
    if (!user || active) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;

      const queued = readQueued();
      if (!queued) return; // nothing to wait for, or waited long enough

      if (!document.hidden) {
        try {
          const session = await currentSession();
          if (session && !stopped) {
            clearQueued();
            setActive(session);
            setArrived(true);
            return;
          }
        } catch {
          /* transient, and the next tick tries again */
        }
      }

      if (!stopped) timer = setTimeout(() => void tick(), nextDelayMs(Date.now() - queued.since));
    };

    // An immediate check on returning to the tab, so someone who switches back
    // is not left staring at a stale header until the next gap elapses.
    const onVisible = () => {
      if (!document.hidden) void tick();
    };

    void tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user, active, queuedAt]);

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
            element={
              user ? (
                <MatchPage
                  active={active}
                  onJoined={setActive}
                  onQueueChanged={() => setQueuedAt(Date.now())}
                />
              ) : (
                <LoginPage />
              )
            }
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
