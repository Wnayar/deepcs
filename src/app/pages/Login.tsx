import { useState } from 'react';
import { signInWithGithub, signInWithGoogle } from '../auth';

function GoogleGlyph() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 10.2v3.9h5.5c-.26 1.45-1.68 4.1-5.5 4.1a6.2 6.2 0 1 1 0-12.4c1.77 0 2.96.75 3.64 1.4l2.66-2.56C16.6 3.05 14.5 2.1 12 2.1a9.9 9.9 0 1 0 0 19.8c5.71 0 9.5-4.02 9.5-9.68 0-.65-.07-1.15-.16-1.64Z" />
    </svg>
  );
}

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

  const start = async (which: 'google' | 'github') => {
    setBusy(which);
    setError(null);
    try {
      await (which === 'google' ? signInWithGoogle() : signInWithGithub());
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown';
      // The same email on the other provider is the one predictable
      // failure; name the fix rather than showing the code.
      setError(
        code === 'auth/account-exists-with-different-credential'
          ? 'This email already signed in with the other provider. Use that button instead.'
          : code.replace(/^auth\//, '').replace(/-/g, ' '),
      );
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
