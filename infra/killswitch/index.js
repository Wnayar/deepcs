/**
 * Layer 1 of the cost ceiling (DESIGN.md §7): detach the billing account from
 * the project when spend passes the budget.
 *
 * This is a BACKSTOP, not a cap. Three properties to keep in mind, all of them
 * stated in DESIGN.md and none of them fixable here:
 *
 *   1. Budget data lags. Delay is hours, not minutes, so a genuine runaway can
 *      overshoot the number before this ever fires.
 *   2. Detaching billing is DESTRUCTIVE, not a pause. Resources can be deleted
 *      rather than suspended.
 *   3. It fails SILENTLY unless this function's service account holds
 *      roles/billing.admin on the BILLING ACCOUNT — not on the project.
 *
 * The real day-to-day control is layer 2: --max-instances on Cloud Run.
 *
 * Deliberately not in the pnpm workspace: Cloud Functions installs from this
 * package.json at deploy time, and nothing else in the repo imports it.
 */
import { cloudEvent } from '@google-cloud/functions-framework';
import { GoogleAuth } from 'google-auth-library';

const BILLING_API = 'https://cloudbilling.googleapis.com/v1';

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

cloudEvent('stopBilling', async (event) => {
  const targetProject = process.env.TARGET_PROJECT_ID;
  if (!targetProject) {
    throw new Error('TARGET_PROJECT_ID is not set — refusing to guess which project to disable');
  }

  const raw = event.data?.message?.data;
  if (!raw) {
    console.log('no Pub/Sub payload; ignoring');
    return;
  }

  const budget = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  const cost = Number(budget.costAmount ?? 0);
  const limit = Number(budget.budgetAmount ?? 0);

  console.log(
    JSON.stringify({
      message: 'budget notification received',
      budget: budget.budgetDisplayName,
      cost,
      limit,
      project: targetProject,
    }),
  );

  // Budgets fire on every threshold (50%, 90%, 100%), so most invocations are
  // informational. Only the ones over the limit are supposed to do anything.
  if (cost <= limit) {
    console.log(`under budget (${cost} <= ${limit}); no action`);
    return;
  }

  const client = await auth.getClient();
  const name = `projects/${targetProject}`;

  const current = await client.request({ url: `${BILLING_API}/${name}/billingInfo` });
  if (!current.data.billingAccountName) {
    console.log('billing already detached; nothing to do');
    return;
  }

  // Idempotent by construction: an empty billingAccountName detaches, and
  // detaching an already-detached project is a no-op. Budget notifications are
  // at-least-once, so this has to be safe to run twice.
  await client.request({
    url: `${BILLING_API}/${name}/billingInfo`,
    method: 'PUT',
    data: { billingAccountName: '' },
  });

  console.error(
    `BILLING DETACHED from ${targetProject}: cost ${cost} exceeded budget ${limit}. ` +
      `Resources may now be deleted, not merely suspended.`,
  );
});
