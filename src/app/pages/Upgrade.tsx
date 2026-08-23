import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { getEntitlement, startCheckout } from '../api';

/** The sales page. It only states the offer and starts the redirect; price
 * and product live in Stripe, so nothing here is worth tampering with. */
export function UpgradePage({ signedIn, entitled }: { signedIn: boolean; entitled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buy = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await startCheckout();
      // Full navigation; Stripe returns to /upgrade/thanks when done.
      window.location.href = url;
    } catch {
      setError('The checkout could not be started. Try again in a moment.');
      setBusy(false);
    }
  };

  if (entitled)
    return (
      <div className="gate">
        <h2>You already have everything</h2>
        <p className="muted">Every topic, lesson, question and answer is unlocked. Enjoy.</p>
        <Link className="navlink primary" to="/">
          Back to the roadmap
        </Link>
      </div>
    );

  return (
    <div className="upgrade">
      <h2>Unlock the whole roadmap</h2>
      <p className="muted">
        The first three topics are free, forever. One payment unlocks the other seven: every
        lesson, every question, every reference answer.
      </p>

      <ul className="upgrade-points">
        <li>All ten topics, read in the order the map recommends</li>
        <li>Reference answers for every question, self-serve</li>
        <li>Lifetime access: pay once, keep everything the site ever adds</li>
        <li>Progress tracking stays free for everyone either way</li>
      </ul>

      {signedIn ? (
        <button className="primary" onClick={() => void buy()} disabled={busy}>
          {busy ? 'Opening checkout…' : 'Unlock everything'}
        </button>
      ) : (
        <>
          <p className="muted">Buying needs an account, so the purchase has somewhere to live.</p>
          <NavLink className="navlink primary" to="/signin">
            Sign in first
          </NavLink>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** The post-purchase entitlement poll: bounded on both sides. */
const POLL_TRIES = 8;
const POLL_MS = 2_000;

/** Where Stripe's success URL lands. The webhook usually beats the
 * redirect, but not always, so this asks a few times before saying
 * "refresh in a minute". */
export function UpgradeThanksPage() {
  const [state, setState] = useState<'checking' | 'unlocked' | 'pending'>('checking');

  useEffect(() => {
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;

    const ask = async () => {
      if (stopped) return;
      tries += 1;
      try {
        const { entitled } = await getEntitlement();
        if (stopped) return;
        if (entitled) return setState('unlocked');
      } catch {
        // A failed check is not a failed purchase; the next try is soon.
      }
      if (tries >= POLL_TRIES) return setState('pending');
      timer = setTimeout(() => void ask(), POLL_MS);
    };

    void ask();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="gate">
      {state === 'checking' && (
        <>
          <h2>Thanks — confirming your purchase…</h2>
          <p className="muted">This usually takes a few seconds.</p>
        </>
      )}
      {state === 'unlocked' && (
        <>
          <h2>Everything is unlocked</h2>
          <p className="muted">All ten topics are yours. Pick up where the map left off.</p>
          <Link className="navlink primary" to="/">
            Back to the roadmap
          </Link>
        </>
      )}
      {state === 'pending' && (
        <>
          <h2>Payment received — unlock in progress</h2>
          <p className="muted">
            The confirmation is taking longer than usual. It lands on its own; refresh in a minute
            and the lock will be gone. Nothing is lost either way.
          </p>
          <Link className="navlink" to="/">
            Back to the roadmap
          </Link>
        </>
      )}
    </div>
  );
}
