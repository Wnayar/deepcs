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

## D5 — Region

Withdrawn. It asked which cloud region to deploy into, and the answer turned out
to be none: the system runs locally (the overview ADR-05), so there is no region to
pick, no managed database to place, and no latency-to-users tradeoff to make.

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
