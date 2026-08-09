# Phase 0 — prebuild decisions

Step 1 of the loop: the decisions this phase forces, before any code exists.
My call is stated on each. Push back on anything you disagree with — that is the
point of this step.

Phase 0 ships: monorepo, six hello-world Fastify services, docker-compose
(Postgres + Redis + Firebase Auth emulator), per-service CI, and the cloud
accounts with the billing guard tested. Demoable when `docker-compose up` runs.

---

## D1 — Workspace tooling

**Options:** pnpm workspaces alone · pnpm + Turborepo · Nx

**My call: pnpm workspaces alone, no task runner.**

CI is path-filtered per service (§7), so each pipeline builds exactly one
service. Turborepo's value is caching a big dependency graph you rebuild whole;
that isn't the shape here. It's also another config file with its own model to
learn while you're learning six other things. If CI ever gets slow, adding it
later is an afternoon.

---

## D2 — Dockerfile strategy · **the one worth arguing about**

**Options:** one shared multi-stage Dockerfile taking the service name as a
build arg · one Dockerfile per service

**My call: one shared, parameterised by `--build-arg SERVICE=questions`.**

Six near-identical Node services. Per-service Dockerfiles means the same fix
applied six times and drifting in five of them. The cost is a layer of
indirection, and that if one service ever needs a different base image you split
it back out — none here will.

This is the kind of thing an interviewer picks at ("why not one per service —
isn't independent deployability the whole point?"), so have an answer ready. The
answer is that independent *deploy* is about the pipeline and the image tag, not
about the file the image is built from.

---

## D3 — Build output: `tsc` or a bundler

**My call: `tsup` (esbuild under the hood), bundling each service to one file.**

This is a real problem, not a preference. pnpm links workspace dependencies as
symlinks into a content-addressed store outside the project directory. The naive
Dockerfile — `COPY node_modules` from a build stage — copies dangling symlinks
and the image dies at import time. The three fixes are `pnpm deploy --prod`, a
`node-linker=hoisted` config, or bundling so shared `packages/*` code is inlined
and the runtime image needs no workspace resolution at all.

Bundling is the smallest of the three and makes the production image thin.

---

## D4 — Firebase Auth emulator in compose

Google publishes no official emulator image. Options: build a small one with
`firebase-tools`, or run it on the host outside compose.

**My call: build the image.** §7 claims "one command runs everything", and that
property is worth six lines of Dockerfile. Running it on the host means every
integration test has a setup step that isn't in the compose file, which is how
CI and local quietly diverge.

---

## D5 — Region · **needs your answer**

The doc commits to `asia-southeast1` (Singapore) throughout. That string ends up
in every deploy command, plus the Neon and Upstash region pickers you'll set
during account signup today.

Cheap to change now, annoying at phase 6. **Where are you physically?** If you're
not in Southeast Asia, tell me and I'll update the doc before you create the
accounts.

---

## A hole in §7 that has to be resolved now

The cost table contradicts itself:

- **Layer 1** (the kill-switch) is a billing budget → Pub/Sub → Cloud Function
  that calls `projects.updateBillingInfo` to detach billing.
- **Layer 3** says enable only five APIs: Cloud Run, Artifact Registry, Secret
  Manager, Cloud Storage, Cloud Scheduler.

A gen2 Cloud Function needs `cloudfunctions`, `cloudbuild`, `eventarc`,
`pubsub`, and `logging` enabled, and the detach call needs `cloudbilling`. None
of those are on the layer-3 list. **As written, layer 3 forbids layer 1.**

**My call:** add those six to the enabled list and note in the doc *why* the
allowlist has an exception — the kill-switch is the one thing with no recovery
path, so it wins over the minimal-API-surface principle. I'll make that edit to
DESIGN.md as part of phase 0 unless you'd rather host the kill-switch elsewhere.

Second-order note on the same layer: gen2 functions execute on Cloud Run, so
your kill-switch shares a service with the thing it exists to kill. That's fine
— it's invoked by Eventarc, not by public traffic — but worth knowing when you
set `--max-instances` project-wide.

---

## Your homework, in this order

### 1. Tooling (none of it is installed on this machine)

```bash
# gcloud
curl -sSL https://sdk.cloud.google.com | bash && exec -l $SHELL

# gh
(type -p wget >/dev/null || sudo apt install wget -y) \
  && sudo mkdir -p -m 755 /etc/apt/keyrings \
  && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
     | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
  && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
     | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && sudo apt update && sudo apt install gh -y
```

**Docker** is the one that isn't a one-liner. On WSL2 the low-friction path is
Docker Desktop for Windows with WSL integration enabled for this distro
(Settings → Resources → WSL Integration). Installing the engine directly inside
WSL also works and avoids Docker Desktop's licence terms, but you then manage
the daemon yourself. Your call; Desktop unless you have a reason.

Anything interactive (`gcloud auth login`, `gh auth login`) — run it with a `!`
prefix in this session so the output lands in our conversation.

### 2. Accounts

1. **GCP** account + free trial. Card required; during the trial Google cannot
   charge it — services stop when credits run out. **The 90 days start today**
   (see the scheduling note below).
2. **Test the kill-switch on a throwaway project with a $0.01 budget** before
   deploying anything real. Two things the doc already warns about and that this
   test is for: it fails *silently* unless the function's service account has
   Billing Account Administrator **on the billing account**, not on the project;
   and detaching billing deletes resources rather than pausing them.
3. **Firebase** project — create it inside the same GCP project, so IAM and
   billing stay in one place.
4. **Neon** (free tier) — region per D5.
5. **Upstash** (free tier) — region per D5.
6. **GitHub repo public** — Actions minutes are free for public repos, which
   §7's per-service CI assumes.

Don't paste any secret into this conversation. Put them in `.env` locally; I'll
provide `.env.example` with the key names.

---

## Scheduling: decide the GKE sprint now

Repeating the hole from before because it's actionable today, not at day 85: the
trial is $300 **and 90 calendar days from the account you create in step 2**.
Phase 9's GKE sprint is specified to run on trial credits but sits second-to-last
in the build, and it isn't first in the stated drop order (10 → 9 → 8).

Three ways out. Pick one before you create the account:

| Option | Consequence |
|---|---|
| Move the GKE sprint to right after phase 6 | Earliest it *can* run — the app is containerised and deployed by then. Interrupts the build once. |
| Leave it at phase 9, accept self-funding | GKE Autopilot for ~2 days is a few dollars. Requires upgrading off the trial. |
| Drop phase 9 | Cheapest. Costs the one orchestration story on the resume. |

My call: **move it to after phase 6.** It's the only option where the doc's own
claim ("during the trial") stays true.

---

## What I'll build while you do that

Nothing below needs Docker running or a cloud account:

- pnpm workspace: `services/{gateway,users,questions,matching,collab,stats}`,
  `packages/{shared,eventlog}`, `apps/web`
- Six hello-world Fastify services with `/health/live` and `/health/ready`
- Shared tsconfig base, tsup config, lint setup
- `docker-compose.yml`: Postgres, Redis, Firebase Auth emulator, six services
- Shared multi-stage Dockerfile (D2) + emulator Dockerfile (D4)
- `.github/workflows/`: path-filtered per-service lint → test → build
- `.env.example`

Verification (`docker-compose up` actually coming up green) blocks on your Docker
install. That's the phase-0 demo, so it's the last thing we do.

---

## Three of the questions you'll be asked at review

So you know what you're reading for, not just reading:

1. Why does compose run the Firebase Auth emulator at all, when Firebase Auth is
   free and reachable from your laptop?
2. Under pnpm, what exactly breaks if the Dockerfile copies `node_modules` out of
   the build stage — and why does bundling avoid it?
3. Why is CI path-filtered per service rather than building the whole repo? What
   would you lose, concretely, if it built everything on every push?

Phase 0 has no race in it, so there's no step-4 break-it exercise. The first one
is phase 1's rate limiter.
