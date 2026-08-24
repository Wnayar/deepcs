import { expect, test } from '@playwright/test';
import { freshUid, signIn } from './session';

test('a mark survives the page it was made on', async ({ page }) => {
  await signIn(page, freshUid('progress'));
  await page.goto('/topic/sample-processes');

  const tick = page.getByRole('button', { name: /^Mark What a sample process is/ });
  const written = page.waitForResponse(
    (res) =>
      res.url().endsWith('/api/me/progress/sample-processes-1') &&
      res.request().method() === 'PUT' &&
      res.status() === 200,
  );
  await tick.click();
  await written;

  // A reload throws away every byte of React state, so anything still on
  // screen came back out of D1.
  await page.reload();
  await expect(tick).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sample: Processes, 1 of 2 lessons done' })).toBeVisible();
});
