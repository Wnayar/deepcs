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
