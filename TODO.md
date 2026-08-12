# Handover: closing the cloud accounts

Temporary file. Delete it when the list below is done.

Parts 1 and 2 of the original handover are finished. The docs restructure landed:
`docs/` is four folders and no loose files, `docs/phases/` and `docs/reviews/`
are gone, and their still-true content is in `docs/system/` as one page per
part. Kubernetes landed before it. What is left is this, and it is yours rather
than the agent's, because it deletes accounts.

Nothing here is urgent: as of 2026-08-12 none of it is billing. It is listed so
the accounts get closed deliberately rather than forgotten. **Do the local step
first**, because two of these are still referenced by your `.env`.

---

## 1. Local, before deleting anything

Your `.env` has `DATABASE_URL` pointing at Neon and `REDIS_URL` at Upstash.
Compose does not read those two lines — each service is given its own local URL
in `docker-compose.yml` — but any script that reads `.env` would, and after the
accounts are gone the failure would be confusing.

```bash
rm .env          # compose runs with no .env at all; every value has a local default
make up && make test
```

Keep `.env.example`; it is the committed template and mentions no provider.

## 2. Neon (Postgres)

Console → your project → Settings → Delete project. Free plan, so nothing is
owed and there is no notice period. The local stack uses the `postgres` container
in compose, so nothing in the repo depends on it.

## 3. Upstash (Redis)

Console → your database → Danger Zone → Delete. Same story: free tier, and the
local stack uses the `redis` container.

## 4. Google Cloud, project `deepcs-will`

What is actually in it:

| Thing | Cost at rest |
|---|---|
| Cloud Run service `stop-billing` (the kill switch) | none, it scales to zero and only runs when a budget alert fires |
| Artifact Registry repo `gcf-artifacts`, 79 MB | none, inside the 0.5 GB free storage. Cloud Functions created it when the kill switch deployed |
| Budget + alerts, enabled APIs | none |
| Firebase project (same project, used only for Auth) | none, and local dev uses the emulator |

So it is not costing anything today. The clean end is to delete the whole
project, which removes everything above in one action:

```bash
gcloud projects delete deepcs-will
```

Recoverable for 30 days, after which it is permanent.

**Three cautions:**

- **Do not close the billing account.** Your other projects (`mailsentry`,
  `vyralclipzzz`, and the two default ones) are attached to the same one.
- **Delete the project last**, after Neon and Upstash. Deleting it also removes
  the kill switch, and there is no reason to be without that while other cleanup
  is in flight.
- **When the free trial ends, do nothing.** If you never upgrade to a paid
  account, services simply stop; Google cannot charge the card during the trial.

## 5. A week later

Check the billing page shows no charges, and `gcloud projects list` no longer
shows `deepcs-will` (it appears as pending deletion first). If you decide to
keep the project after all, that is fine too — none of it bills while idle.
