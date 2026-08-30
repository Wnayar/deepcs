import { useState } from 'react';
import { signInWithGithub, signInWithGoogle } from '../auth';

/* The official four-colour G; brand colours are content, not theme, so
 * they live on the paths rather than in the stylesheet's tokens. */
function GoogleGlyph() {
  return (
    <svg className="icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 12.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

/** GitHub's Octocat mark, single-colour so it takes the button's text colour. */
function GithubGlyph() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** Two doors, no passwords: the provider owns credentials entirely, and
 * this page only starts the popup and shows what went wrong. */
export function LoginPage() {
  const [busy, setBusy] = useState<'google' | 'github' | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Opens one provider's popup, and turns whatever comes back into a
   * message the reader can act on. */
  const start = async (which: 'google' | 'github') => {
    setBusy(which);
    setError(null);

    try {
      if (which === 'google') {
        await signInWithGoogle();
      } else {
        await signInWithGithub();
      }
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown';

      // Closing the popup is a decision, not a failure: no red text for it.
      const cancelled =
        code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';

      if (cancelled) {
        return;
      }

      // The same email on the other provider is the one predictable
      // failure; name the fix rather than showing the code.
      if (code === 'auth/account-exists-with-different-credential') {
        setError('This email already signed in with the other provider. Use that button instead.');
      } else {
        setError(code.replace(/^auth\//, '').replace(/-/g, ' '));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="auth">
      <h2>Sign in to DeepCS to track your progress</h2>
      <p className="muted">Free account. Your progress syncs across devices.</p>

      <button className="provider" onClick={() => void start('google')} disabled={busy !== null}>
        <GoogleGlyph />
        {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
      </button>
      <button className="provider" onClick={() => void start('github')} disabled={busy !== null}>
        <GithubGlyph />
        {busy === 'github' ? 'Opening GitHub…' : 'Continue with GitHub'}
      </button>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
