import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, Route, Routes } from 'react-router';
import { signOutUser, watchUser, type User } from './auth';
import { useTheme } from './theme';
import { useProgress } from './progress';
import { RoadmapPage } from './pages/Roadmap';
import { StepPage } from './pages/Step';
import { LoginPage } from './pages/Login';
import { UpgradePage, UpgradeThanksPage } from './pages/Upgrade';
import { AdvicePage } from './pages/Advice';

/** The wordmark glyph: a three-node path, the roadmap in miniature. Inline
 * SVG so it takes the theme's accent and follows theme switches. */
function Mark() {
  return (
    <svg className="mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M7 6 L16.5 12 L8 18.5" />
      <circle cx="7" cy="6" r="3.1" />
      <circle cx="16.5" cy="12" r="3.1" opacity="0.72" />
      <circle cx="8" cy="18.5" r="3.1" opacity="0.45" />
    </svg>
  );
}

/** A map pin, "you are here": the roadmap's own glyph, distinct from the
 * wordmark's node path so the brand mark stays unique to the brand. */
function PinIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fillRule="evenodd"
        d="M8 1.5a5.2 5.2 0 0 0-5.2 5.2C2.8 10.3 8 14.8 8 14.8s5.2-4.5 5.2-8.1A5.2 5.2 0 0 0 8 1.5Zm0 7a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8Z"
      />
    </svg>
  );
}

/** A heart for the paid tier: buying Pro is backing the site, and the
 * upgrade page says so in words. */
function HeartIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 13.9 3.1 9.1a3.4 3.4 0 0 1 4.7-4.9l.2.2.2-.2a3.4 3.4 0 0 1 4.7 4.9Z" />
    </svg>
  );
}

/** The shell: the header, and which screen is on the page. Every route
 * refetches rather than trusting handed state, so any URL rebuilds. */
export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [theme, toggleTheme] = useTheme();

  // Shared here because the header, the map, and the topic panel read it.
  const progress = useProgress(Boolean(user));

  useEffect(
    () =>
      watchUser((next) => {
        setUser(next);
        setReady(true);
      }),
    [],
  );

  if (!ready) return <main className="muted">Loading…</main>;

  return (
    <>
      <header>
        <h1>
          <Link className="wordmark" to="/">
            <Mark />
            deepcs
          </Link>
        </h1>

        <nav className="nav-primary">
          <NavLink className="navlink with-icon" to="/">
            <PinIcon />
            Roadmap
          </NavLink>
          <NavLink className="navlink" to="/advice">
            Start here
          </NavLink>
        </nav>

        <div className="nav-utility">
          {/* Top right, where paid tiers live on every dev tool; hidden once
              entitled, because the page it links to has nothing left to
              sell. */}
          {!progress.entitled && (
            <NavLink className="navlink primary with-icon" to="/upgrade">
              <HeartIcon />
              Pro
            </NavLink>
          )}

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
        </div>
      </header>

      <Routes>
        {/* An open topic is the same screen as the map; its own URL makes
            Back close the panel rather than leave the site. */}
        <Route path="/" element={<Wide />}>
          <Route index element={<RoadmapPage signedIn={Boolean(user)} progress={progress} />} />
          <Route
            path="topic/:topic"
            element={<RoadmapPage signedIn={Boolean(user)} progress={progress} />}
          />
        </Route>

        <Route element={<Narrow />}>
          <Route path="/step/:id" element={<StepPage signedIn={Boolean(user)} />} />
          <Route path="/signin" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
          <Route
            path="/upgrade"
            element={<UpgradePage signedIn={Boolean(user)} entitled={progress.entitled} />}
          />
          <Route path="/upgrade/thanks" element={<UpgradeThanksPage />} />
          <Route path="/advice" element={<AdvicePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}

/** The map fills the window; every other screen gets a reading width. */
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
