# Handover: finish the docs restructure

Temporary file. Delete it when Part 1 is done — Parts 2 and 3 are finished.

**Start here.** Only **Part 1** is left: `docs/phases/` and `docs/reviews/` still
exist and their still-true content has to move into `docs/system/`. Part 2
(Kubernetes) is built, measured and committed. Part 3 (closing the cloud
accounts) is a manual checklist for the human, not the agent.

Kubernetes landed on `build/kubernetes-locally`, branched off `main`. Check with
`git log --oneline -6` where you actually are. Nothing is half-edited; the tree
is consistent at every commit, and `pnpm lint`, `format:check`, `-r typecheck`
and all 140 tests pass as of that commit.

---

## Where things stand

The repo has been converted from a "still building, deploying later" state to a
"finished, runs locally" state.

**Done:**

- All deployment material removed. No cloud provider, no hosted anything.
  `docs/phases/0-cloud-setup.md`, `docs/learning/google-cloud-flow.md` and
  `infra/killswitch/` are deleted. Every Cloud Run / Neon / Upstash reference in
  code comments now cites what actually applies (Kubernetes, `docker stop`, a
  proxy, Redis, Postgres). The code itself did not change.
- `DESIGN.md` → `docs/system/00-overview.md`, retitled "How the system works",
  with the build-phase table and the "why the order changed" paragraphs removed.
- Its ADR section → `docs/adr/`, ten files, one decision each, no ADR-N
  numbering and no dates.
- `docs/cost.md` → `docs/future/cost.md`, reframed as an exploration of what
  deploying *would* cost rather than a plan.
- `docs/frontend.md` → `docs/system/07-frontend.md`.
- All 67 `DESIGN.md` citations across code and docs repointed.
- `CLAUDE.md` project context rewritten around the four folders; every mention
  of phases gone.
- `.dockerignore`, `.gitignore`, `.env.example` cleaned for local-only.
- Verified: `pnpm lint`, `pnpm format:check`, `pnpm -r typecheck`, and all 137
  tests pass.

**Two items above were overstated, found while building Part 2.** Fix them with
Part 1 rather than trusting the list:

- *"Every Cloud Run reference in code comments now cites what actually applies"*
  is not true. `services/stats/src/server.ts` still says the two entrypoints are
  "deployed in Cloud Run as one job and one service", and
  `packages/shared/src/service.ts` still explains `trustProxy` in terms of what
  sits "behind Cloud Run". Both are now answered by `k8s/`.
- *"every mention of phases gone"* was true of `CLAUDE.md` only. Still carrying
  `phase N` or dead links: `load/run.sh`, `docker-compose.yml`,
  `pnpm-workspace.yaml`, `.github/workflows/ci.yml`, `docs/system/07-frontend.md`,
  `docs/learning/the-code.md`, `docs/adr/10-hand-written-sql-for-now.md`, and
  `docs/system/00-overview.md:71` which links to `docs/phases/5b-roadmap.md`.

Note the verify grep at the end of Part 1 **misses `.sh` files**, which is why
`load/run.sh` survived. Widen it.

---

## Part 1 — Finish the docs (the remaining work)

`docs/phases/` and `docs/reviews/` still exist and still have to go. They hold
roughly 3,000 lines written as *"this phase built X, and here is the bug we hit
on the way"*. The still-true content has to move into per-service reference
pages first.

### Target

**`docs/` ends with exactly four folders and no loose files.** `phases/` and
`reviews/` are deleted once their still-true content has moved into `system/`.
If something does not belong in one of these four, it does not belong in the
repo.

```
docs/
  system/       ← the folder you read to understand the repo
    00-overview.md          done
    01-gateway.md           to write
    02-users.md             to write
    03-questions.md         to write
    04-matching.md          to write
    05-collab.md            to write
    06-events-and-stats.md  to write
    07-frontend.md          done, may want extending
    08-data.md              to write
    09-running-it.md        to write
  adr/          done
  learning/     docker.md, ci.md, the-code.md — keep; add kubernetes.md with Part 2
  future/       cost.md
```

### Where the material comes from

| Write this | From |
|---|---|
| `01-gateway.md` | `phases/1-auth-and-gateway.md`, `services/gateway/src/` |
| `02-users.md` | the lazy-upsert half of `phases/1-auth-and-gateway.md`, `services/users/src/` |
| `03-questions.md` | `phases/2-questions-bank.md`, `phases/5b-roadmap.md`, `services/questions/src/` |
| `04-matching.md` | `phases/3-matching.md`, `services/matching/src/` |
| `05-collab.md` | `phases/4-collab.md`, `services/collab/src/` |
| `06-events-and-stats.md` | `phases/6-events.md`, `services/stats/src/`, `packages/shared/src/events.ts` |
| `07-frontend.md` | already written; fold in the reveal rule from `phases/5-frontend.md` |
| `08-data.md` | `packages/db/migrations/`, decision 9 in `docs/adr/`, the data parts of `phases/0-repo-tour.md` |
| `09-running-it.md` | `phases/7-load-and-soak.md`, the container and CI layers of `phases/0-repo-tour.md`, `Makefile`, `load/` |

Then `git rm -r docs/phases docs/reviews`, and update the index in `CLAUDE.md`
and any links that break.

### Rules for the rewrite

- **Present tense, current state.** No "we used to", no "this phase added", no
  dated corrections, no phase numbers anywhere. If a fact only makes sense as
  history, drop it; if it explains why the code is shaped as it is, it belongs
  in `docs/adr/`.
- **Keep the measured numbers**, they are the good part: p95 4 ms edit
  propagation at 250 sockets, 23 ms SSE delivery, the 42501 permission-denied
  tests, 258 MB peak memory. Keep the environment attached to each.
- **Keep the failure modes.** The reason each page is worth reading is what
  breaks and why, not a list of endpoints.
- Match the existing house style: plain sentences, no arrow-chain shorthand,
  a short comment with a concrete example above anything non-obvious. See
  `CLAUDE.md`.
- Do not reintroduce a cloud dependency in prose or in code.

### Also check these two files are still true

Both were edited during the restructure and both are easy to leave stale:

- **`CLAUDE.md`** — the project-context list must match the four folders, the
  "Running it" section must match the real `make` targets, and no convention in
  it should reference a phase, a deployment or a doc that moved. It is loaded
  into every session, so an error here propagates.
- **`Makefile`** — every target and every comment. `k8s-up` and `k8s-down`
  arrive with Part 2 and have to be documented in the header block alongside
  `up`, `web`, `test` and `load`, and `README.md` lists the same commands.

### Verify before committing

```bash
pnpm lint && pnpm format:check && pnpm -r typecheck
grep -rn "phase\|Cloud Run\|Neon\|Upstash" --include=*.md docs/ | grep -v future/cost.md
grep -rn "DESIGN\.md\|docs/phases\|docs/reviews" . --include=*.md --include=*.ts --include=*.yml | grep -v node_modules
```

The last one catches links to files that no longer exist, which is the most
likely thing to break during the move.

`docs/future/cost.md` is the one file allowed to discuss cloud pricing; it is
explicitly framed as the exploration that decided against deploying.

---

## Part 2 — Kubernetes, locally (the last build work)

**Done.** `k8s/` holds the manifests, `make k8s-up` / `k8s-check` / `k8s-down`
drive it, and the results are written up in `docs/system/09-running-it.md` and
`docs/learning/kubernetes.md`. What follows is the original brief, kept because
the two notes at the end record where reality differed from it.

### What to build

`k8s/` with raw YAML, no Helm:

- Deployment + Service per service (gateway, users, questions, matching, collab,
  stats-api), plus Postgres and Redis as in-cluster Deployments with no
  persistence, and the Auth emulator.
- The Stats job as a CronJob.
- ConfigMap for plain values, Secret for credentials, mirroring `.env.example`.
- Ingress in front of the Gateway only. Everything else stays ClusterIP, which
  is half of what makes `X-User-Id` unforgeable — see `packages/shared/src/headers.ts`.
- Probes pointed at the existing `/health/live` and `/health/ready`.
- `make k8s-up` / `make k8s-down`, using `kind load docker-image` so the cluster
  runs locally built images with no registry.

### What it has to demonstrate

These two claims are the whole point, and both are measured with the existing
k6 script in `load/` (`make load`, pointed at the cluster):

1. **Zero dropped requests during a rolling update.** `kubectl apply` while load
   is running. The mechanism is the readiness probe: a pod that fails
   `/health/ready` is removed from the Service endpoints.
2. **A killed pod interrupts nobody.** `kubectl delete pod` during the same run.
   Collab snapshots its documents on SIGTERM, so no edits are lost.

Write `docs/system/09-running-it.md` and `docs/learning/kubernetes.md` from what
actually happens, not from what should happen. If a claim does not survive the
run, the doc says so.

### Where reality differed from this brief

Two things, both written up in `09-running-it.md`:

1. **The k6 script cannot measure dropped requests.** `load/collab.js` sends its
   HTTP in `setup()` and `teardown()` and holds WebSockets in between, so during
   a rolling update there are no requests in flight to drop. Counting them needed
   a separate prober, which is `k8s/disruption-check.sh` (`make k8s-check`). The
   k6 run still answers the other half, what a disruption does to a live socket.
2. **"A killed pod interrupts nobody" is too strong.** The edits survive — this
   was verified directly, by killing the pod holding a room seconds after a write
   and reading the marker back. The socket does not: it closes, and the client
   reconnects. The claim written down is "a reconnect, not any edits".

Also worth knowing: `edit_latency` from the k6 script is only meaningful against
a *single* Collab instance. With two, a cross-instance state reply re-delivers
the whole document and the script counts old markers as fresh edits, which puts
p95 at 18.72s against a 5ms median. Not a defect; the reasoning is in §6 of
`09-running-it.md`.

### Afterwards

Nothing. `~/deepcs-resume-bullets.txt` has been deleted on purpose — it was a
scratch file, and its planned upgrade text ("zero dropped requests during a
rolling update and a pod kill, verified with the same k6 script") was wrong on
both counts. If a CV bullet is written later, take the numbers and the wording
from `docs/system/09-running-it.md` §4 and §5: "a reconnect, not any edits"
rather than "interrupts nobody", and the machine attached to any latency figure.

---

## Part 3 — Closing the cloud accounts (do this yourself, not the agent)

Nothing here is urgent: as of 2026-08-12 none of it is billing. It is listed so
the accounts get closed deliberately rather than forgotten. **Do the local step
first**, because two of these are still referenced by your `.env`.

### 1. Local, before deleting anything

Your `.env` has `DATABASE_URL` pointing at Neon and `REDIS_URL` at Upstash.
Compose does not read those two lines — each service is given its own local URL
in `docker-compose.yml` — but any script that reads `.env` would, and after the
accounts are gone the failure would be confusing.

```bash
rm .env          # compose runs with no .env at all; every value has a local default
make up && make test
```

Keep `.env.example`; it is the committed template and mentions no provider.

### 2. Neon (Postgres)

Console → your project → Settings → Delete project. Free plan, so nothing is
owed and there is no notice period. The local stack uses the `postgres` container
in compose, so nothing in the repo depends on it.

### 3. Upstash (Redis)

Console → your database → Danger Zone → Delete. Same story: free tier, and the
local stack uses the `redis` container.

### 4. Google Cloud, project `deepcs-will`

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

### 5. A week later

Check the billing page shows no charges, and `gcloud projects list` no longer
shows `deepcs-will` (it appears as pending deletion first). If you decide to
keep the project after all, that is fine too — none of it bills while idle.
