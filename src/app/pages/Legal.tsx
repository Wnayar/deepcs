/** The two documents live money requires. Both describe this system
 * specifically: what a template would get wrong here is that Stripe, not
 * the operator, is the seller, and that the database holds no email
 * address. DESIGN.md §5 and §8 are the facts these pages restate. */

/** Published identity: PDPA asks for the business contact information of
 * whoever is responsible for data protection, which a role address
 * satisfies. No personal name is published, and none is owed while Stripe
 * is merchant of record and carries the seller's contact duty. */

/** Shared with the sales page, where the promise actually reaches a buyer. */
export const REFUND_DAYS = 14;

export const CONTACT = 'support@deepcs.org';
const UPDATED = '24 August 2026';

export function PrivacyPage() {
  return (
    <div className="legal">
      <h2>Privacy</h2>
      <p className="faint">Last updated {UPDATED}</p>

      <p>
        DeepCS is run by one person and keeps as little about you as it can. This page says
        exactly what that is, in the order it matters.
      </p>

      <h3>What DeepCS stores</h3>
      <p>
        Signing in creates one row for each step you tick or star. A row holds the account id
        your sign-in provider issues (an opaque string, not your email), which step it refers
        to, whether it is done, whether it is starred, and when you last changed it.
      </p>
      <p>
        Buying Pro adds one more row: the same account id, the product name, the Stripe order
        and event references for that payment, and the dates it was bought and, if it ever is,
        refunded.
      </p>
      <p>That is the whole database.</p>

      <h3>What DeepCS never stores</h3>
      <p>
        No name, no email address, no postal address, no password, and nothing card shaped.
        None of it reaches this site. Your profile picture is fetched from Google or GitHub as
        the page draws it and is never copied here.
      </p>

      <h3>Who else handles your data</h3>
      <p>
        <strong>Sign-in: Firebase Authentication, by Google.</strong> Your account lives with
        them, including the email address and name your provider shares. DeepCS receives a
        signed token proving the account is yours and reads only the account id from it.
        Nothing here can create or alter that account.
      </p>
      <p>
        <strong>Payment: Stripe.</strong> Stripe is the seller of record for Pro, so they take
        the payment, hold the billing details and handle tax. No card details pass through
        DeepCS. What comes back is a reference number.
      </p>
      <p>
        <strong>Hosting: Cloudflare.</strong> They serve the site and keep the ordinary request
        logs any web host keeps.
      </p>

      <h3>Analytics</h3>
      <p>
        Cloudflare Web Analytics counts page views. It sets no cookies, does not fingerprint
        your browser, and cannot follow you to other sites. There is no advertising, no third
        party tracker, and nothing about you is sold or shared.
      </p>

      <h3>What your browser keeps</h3>
      <p>
        Two things, both local to your device: your light or dark choice, saved as{' '}
        <code>deepcs.theme.v2</code>, and your signed-in session, kept by the Firebase sign-in
        library so you are not asked to sign in every visit. Signing out clears the session.
        Clearing site data clears both.
      </p>

      <h3>How long it is kept</h3>
      <p>
        Progress rows stay until you ask for them to go. The purchase row stays while the
        unlock stands, because it is what unlocks the content. Stripe keeps its own record of
        the sale for as long as their rules require.
      </p>

      <h3>Getting your data, or deleting it</h3>
      <p>
        Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. Your rows can be sent to you,
        corrected, or deleted on request. The account itself is deleted with Google or GitHub, since it is
        theirs rather than ours. Deleting a purchase row also removes the access it granted.
      </p>

      <h3>Who runs DeepCS, and who to contact</h3>
      <p>
        DeepCS is a one person project, operated from Singapore and subject to Singapore's
        Personal Data Protection Act. Questions about this page, and anything you want done
        with your data, reach the person responsible at{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h3>Changes</h3>
      <p>If this page changes, the date at the top changes with it.</p>
    </div>
  );
}

export function TermsPage() {
  return (
    <div className="legal">
      <h2>Terms</h2>
      <p className="faint">Last updated {UPDATED}</p>

      <h3>What DeepCS is</h3>
      <p>
        Computer science revision notes: a roadmap, the lessons it orders, and the questions
        each lesson prepares you for, with reference answers. Some topics are free to read.
        The rest are unlocked by a single payment.
      </p>

      <h3>Your account</h3>
      <p>
        Sign-in is through Google or GitHub. One account is for one person. Access follows the
        account, so sharing it gives away what you paid for.
      </p>

      <h3>What you are buying</h3>
      <p>
        One payment unlocks every paid topic, including topics added later, for as long as
        DeepCS is online. Lifetime means the life of the product. It is not a promise that new
        lessons keep arriving, and not a guarantee that the site runs forever. If DeepCS shuts
        down, the unlock ends with it.
      </p>

      <h3>Who you are buying from</h3>
      <p>
        Stripe is the merchant of record for this purchase. The payment contract is with them:
        they charge you, they are responsible for any sales tax or VAT, their terms govern the
        payment itself, and your receipt comes from them. DeepCS supplies the content that the
        payment unlocks.
      </p>

      <h3>Price and tax</h3>
      <p>
        The price shown includes tax where tax applies. Prices can change. A later change never
        charges you again, and never affects what you already bought.
      </p>

      <h3>Refunds</h3>
      <p>
        Ask within {REFUND_DAYS} days of buying and you get your money back, no reason needed.
        Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>, or ask Stripe directly. A refund
        switches the unlock off, so the paid topics lock again.
      </p>

      <h3>What you may and may not do</h3>
      <p>
        The lessons are for your own use. Read them, quote a line the way you would quote any
        article, and use what you learn however you like. Do not republish, resell, share or
        upload the lesson text, in whole or in part, anywhere others can reach it, including as
        training data for a model.
      </p>

      <h3>The free tier</h3>
      <p>
        Reading the free topics, ticking steps off and starring them costs nothing and needs no
        purchase. That stays true.
      </p>

      <h3>Availability</h3>
      <p>
        This is one person's site on shared infrastructure, provided as it is, with no promise
        that it is reachable at any given moment or that every lesson is free of mistakes.
        Report a mistake to <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and it gets fixed at
        the source.
      </p>

      <h3>Liability</h3>
      <p>
        Nothing here is career advice and no interview outcome is promised. So far as the law
        allows, liability for any claim connected to DeepCS is limited to the amount you paid
        for it.
      </p>

      <h3>Changes to these terms</h3>
      <p>
        They can change, and the date at the top says when they last did. A change never
        retroactively removes an unlock you already bought.
      </p>

      <h3>Governing law</h3>
      <p>These terms are governed by the laws of Singapore.</p>

      <h3>Contact</h3>
      <p>
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
    </div>
  );
}
