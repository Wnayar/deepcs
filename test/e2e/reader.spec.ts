import { expect, test } from '@playwright/test';

/** The anonymous reader: everything the free tier promises a stranger, and
 * the one thing it must refuse. */

const PAID_BODY = 'the entitlement check passed';

test('a free lesson reads from the map through to its key summary', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Sample: Processes,/ }).click();
  await expect(page).toHaveURL(/\/topic\/sample-processes$/);

  const topic = page.getByRole('dialog', { name: 'Sample: Processes' });
  await topic.getByRole('button', { name: 'What a sample process is' }).click();
  await expect(page).toHaveURL(/\/step\/sample-processes-1$/);
  await expect(page.getByRole('heading', { name: 'What a sample process is' })).toBeVisible();

  await page.getByRole('button', { name: /^Next:/ }).click();
  await expect(page).toHaveURL(/\?s=2$/);
  await expect(page.getByRole('heading', { name: 'Why the fixture has a code fence' })).toBeVisible();

  await page.getByRole('button', { name: /^Key summary/ }).click();
  await expect(page.getByText("1. What is this repository's sample content for?")).toBeVisible();
  await page.getByRole('button', { name: 'Show answer' }).first().click();
  await expect(page.getByText('It makes the app fully runnable from the public repo')).toBeVisible();
});

test('a deep link into a lesson section rebuilds that screen cold', async ({ page }) => {
  const response = await page.goto('/step/sample-processes-1?s=2');

  // The SPA fallback, from a browser rather than a fetch: an unknown path
  // is the app at a 200, not a 404, and the route refetches its own data.
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Why the fixture has a code fence' })).toBeVisible();
});

test('a signed-out reader is refused paid content, on the page and in the bytes', async ({
  page,
  request,
}) => {
  await page.goto('/topic/sample-premium');

  const topic = page.getByRole('dialog', { name: 'Sample: The paid tier' });
  await expect(topic.getByText('Part of DeepCS Pro')).toBeVisible();
  await topic.getByRole('button', { name: 'A sample locked lesson' }).click();

  await expect(page).toHaveURL(/\/step\/sample-premium-1$/);
  await expect(page.getByRole('heading', { name: 'Part of DeepCS Pro' })).toBeVisible();
  await expect(page.getByText(PAID_BODY)).toHaveCount(0);

  // The gate is the Worker, not the screen: the file itself must refuse.
  const raw = await request.get('/content/paid/lessons/sample-premium-1.md');
  expect(raw.status()).toBe(401);
  expect(await raw.text()).not.toContain(PAID_BODY);
});
