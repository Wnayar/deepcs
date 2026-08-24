import { expect, test } from '@playwright/test';
import { freshUid, signIn } from './session';

/** The promise behind the split between assets and the Worker: a backend
 * outage costs a reader their marks, not the site. */

const OUT = { status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' };

test('the free site still reads with every API call failing', async ({ page }) => {
  await signIn(page, freshUid('degraded'));
  await page.route('**/api/**', (route) => route.fulfill(OUT));

  await page.goto('/roadmap');
  await expect(page.getByRole('button', { name: /^Sample: Processes,/ })).toBeVisible();
  await expect(page.getByText('The roadmap could not be loaded')).toHaveCount(0);

  await page.goto('/step/sample-processes-1');
  await expect(page.getByRole('heading', { name: 'What a sample process is' })).toBeVisible();
  await expect(page.getByText('This step could not be loaded')).toHaveCount(0);
});

test('a write that fails puts the tick back', async ({ page }) => {
  await signIn(page, freshUid('degraded-write'));

  // Held open so the optimistic tick is observable before the failure
  // arrives; an immediate 503 would race the assertion.
  let fail!: () => void;
  const failed = new Promise<void>((resolve) => {
    fail = resolve;
  });
  await page.route('**/api/me/progress/**', async (route) => {
    await failed;
    await route.fulfill(OUT);
  });

  await page.goto('/topic/sample-processes');
  const tick = page.getByRole('button', { name: /^Mark What a sample process is/ });
  await tick.click();
  await expect(tick).toHaveAttribute('aria-pressed', 'true');

  fail();
  await expect(tick).toHaveAttribute('aria-pressed', 'false');
});
