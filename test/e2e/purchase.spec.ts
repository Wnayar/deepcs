import { expect, test } from '@playwright/test';
import { completedEvent, stripeSignature } from '../integration/helpers';
import { freshUid, signIn } from './session';

test('a paid webhook unlocks the buyer, and only from the offer onward', async ({
  page,
  request,
}) => {
  const uid = freshUid('purchase');
  await signIn(page, uid);

  await page.goto('/topic/sample-premium');
  const topic = page.getByRole('dialog', { name: 'Sample: The paid tier' });
  await expect(topic.getByText('Part of DeepCS Pro')).toBeVisible();

  // Signed in and unpaid, opening a Pro lesson lands on the offer rather
  // than an error: the reader did nothing wrong.
  await topic.getByRole('button', { name: 'A sample locked lesson' }).click();
  await expect(page).toHaveURL(/\/upgrade$/);

  // Stripe's hosted checkout cannot be driven offline, so the journey
  // resumes where the money actually lands: the event Stripe posts back,
  // signed here the way Stripe signs it.
  const event = completedEvent(uid, { eventId: `evt_${uid}`, paymentIntent: `pi_${uid}` });
  const delivered = await request.post('/api/webhooks/stripe', {
    headers: { 'stripe-signature': await stripeSignature(event) },
    data: event,
  });
  expect(delivered.status()).toBe(200);

  await page.goto('/upgrade/thanks');
  await expect(page.getByRole('heading', { name: 'Everything is unlocked' })).toBeVisible();

  await page.goto('/step/sample-premium-1');
  await expect(page.getByRole('heading', { name: 'A sample locked lesson' })).toBeVisible();
  await expect(page.getByText('the entitlement check passed')).toBeVisible();
});

/**
 * Backing out of Stripe with the browser's back button, which restores this
 * page from the back/forward cache rather than reloading it. Stripe's own
 * back control is unaffected: it navigates to `cancel_url`, a fresh load.
 */
test('a back/forward cache restore leaves the buy button usable', async ({ page }) => {
  await signIn(page, freshUid('backout'));

  // A fragment, so the redirect leaves the page mounted with the state the
  // real one leaves behind. Stripe is unreachable offline (DESIGN.md §11).
  await page.route('**/api/checkout', (route) => route.fulfill({ json: { url: '#stripe' } }));

  await page.goto('/upgrade');
  const buy = page.getByRole('button', { name: /Lifetime/ });
  await buy.click();
  await expect(buy).toBeDisabled();

  // Dispatched rather than driven: headless Chromium under Playwright never
  // serves a history navigation from the cache, so a real back button here
  // would reload the page and prove nothing.
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );

  await expect(buy).toBeEnabled();
  await expect(page.getByText('Opening checkout')).toHaveCount(0);
});
