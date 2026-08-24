import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { getEntitlement, startCheckout } from '../api';
import { REFUND_DAYS } from './Legal';

/** Display prices only, set at build time beside the Firebase values. The
 * charge is whatever the Stripe price says, and Stripe shows that again
 * before paying, so drift here embarrasses rather than overcharges.
 * ANCHOR is the list price PRICE is discounted from; leave it unset unless
 * it is a price you genuinely intend to charge, because an invented one is
 * exactly the scam signal the rest of the site avoids. */
const PRICE = import.meta.env.VITE_PRICE_DISPLAY as string | undefined;
const ANCHOR = import.meta.env.VITE_PRICE_ANCHOR as string | undefined;

/** The plan card's contents, shared by the buy button and the sign-in
 * link. Spans, not a list: the card renders inside a button, where only
 * phrasing content is valid. */
function PlanInner({ busy }: { busy: boolean }) {
  return (
    <>
      <span className="plan-name">
        <span className="support-heart" aria-hidden="true">
          ♥
        </span>
        Lifetime
      </span>
      <span className="plan-pricerow">
        <span className="plan-price">{PRICE ?? 'One payment'}</span>
        {PRICE && ANCHOR && <s className="plan-anchor">{ANCHOR}</s>}
      </span>
      {/* Only while the redirect is being fetched: the card otherwise has
          nothing to say here that the ticks do not. */}
      {busy && <span className="plan-sub">Opening checkout…</span>}
      <span className="plan-points">
        <span className="plan-point">One-time payment</span>
        <span className="plan-point">The whole roadmap, forever</span>
        <span className="plan-point">Every future topic included</span>
        <span className="plan-point">{REFUND_DAYS} day refund, no questions</span>
      </span>
    </>
  );
}

/** The sales page. It only states the offer and starts the redirect; price
 * and product live in Stripe, so nothing here is worth tampering with. */
export function UpgradePage({ signedIn, entitled }: { signedIn: boolean; entitled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // buy() leaves `busy` set once the redirect is underway, because the tab
  // is on its way to Stripe. The back/forward cache restores this page with
  // that state intact, so without this the button stays disabled until a
  // reload. Stripe's own back control lands on cancel_url and reloads.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);

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
        <Link className="navlink primary" to="/roadmap">
          Back to the roadmap
        </Link>
      </div>
    );

  return (
    <div className="upgrade centered">
      <p className="kicker">DeepCS Pro</p>
      <h2>Interviews are changing. Fundamentals are the new edge.</h2>

      {signedIn ? (
        <button className="plan" onClick={() => void buy()} disabled={busy}>
          <PlanInner busy={busy} />
        </button>
      ) : (
        <>
          <NavLink className="plan" to="/signin" state={{ from: '/upgrade' }}>
            <PlanInner busy={false} />
          </NavLink>
          <p className="muted">Sign in first.</p>
        </>
      )}

      <p className="trust">
        Secure checkout by Stripe. <Link to="/terms">{REFUND_DAYS} day refund</Link>, no
        questions.
      </p>

      {error && <p className="error">{error}</p>}

      <p className="support">
        <span className="support-heart" aria-hidden="true">
          ♥
        </span>
        Thank you for supporting DeepCS. It helps cover the ongoing costs of the site, and I hope
        to see your success.
      </p>
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
          <h2>Thanks! Confirming your purchase…</h2>
          <p className="muted">This usually takes a few seconds.</p>
        </>
      )}
      {state === 'unlocked' && (
        <>
          <h2>Everything is unlocked</h2>
          <p className="muted">The whole roadmap and every future addition is yours.</p>
          <p className="support">
            <span className="support-heart" aria-hidden="true">
              ♥
            </span>
            Thank you for the support.
          </p>
          <Link className="navlink primary" to="/roadmap">
            Back to the roadmap
          </Link>
        </>
      )}
      {state === 'pending' && (
        <>
          <h2>Payment received, unlock in progress</h2>
          <p className="muted">
            The confirmation is taking longer than usual. It lands on its own; refresh in a minute
            and the lock will be gone. Nothing is lost either way.
          </p>
          <Link className="navlink" to="/roadmap">
            Back to the roadmap
          </Link>
        </>
      )}
    </div>
  );
}
