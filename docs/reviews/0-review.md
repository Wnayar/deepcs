# Phase 0 — review guide

Step 3 of the loop. Read the code to answer these, not to follow along. My
answers are at the bottom; don't read them first — the gap between your answer
and mine is the only signal this step produces.

Nothing is committed. `git status` shows the whole phase as untracked.

## What exists now

```
deepcs/
├── Dockerfile                    one file, six images, --build-arg SERVICE=<name>
├── docker-compose.yml            5 services + stats job + PG + Redis + Auth emulator
├── pnpm-workspace.yaml           workspace globs + dependency catalog
├── tsconfig.base.json
├── eslint.config.js  .prettierrc.json  .env.example
├── .github/workflows/ci.yml      path-filtered per service
├── docker/firebase-emulator/     Dockerfile + firebase.json
├── packages/shared/src/
│   ├── service.ts                createService(): logging, request-id, health, shutdown
│   ├── logger.ts                 createJobLogger(): the same shape, for the Stats job
│   └── services.ts               the six deployables and their local ports
└── services/
    ├── gateway|users|questions|matching|collab/   Fastify hello-world + 2 tests each
    └── stats/                                     a job: runs, logs, exits 0
```

## Verified locally

| Check | Result |
|---|---|
| `pnpm install` | 234 packages, clean |
| `pnpm typecheck` | clean across 7 packages |
| `pnpm test` | 10 tests pass (2 per HTTP service) |
| `pnpm lint` / `format:check` | clean |
| `pnpm build` | 6 bundles |
| Built bundle runs, serves `/health/ready`, propagates `x-request-id`, exits 0 on SIGTERM | yes |
| Stats bundle runs to completion and exits 0 | yes |
| `docker build --target runner` for a server and for the job | both build; run non-root; 248 MB |
| **`docker compose up`** | **all 9 containers healthy** |
| All five services answer `/health/ready` on their mapped ports | yes |
| Service-to-service DNS + Postgres/Redis/emulator reachable from inside a container | yes |
| Emulator mints a real ID token for a test user; UI serves on :4000 | yes |
| Hot reload: host edit → live in the container | 2 s |
| Stats shows `exited (0)` and reruns on `docker compose run --rm stats` | yes |

**The local half of phase 0 is done.** What remains is entirely cloud-side and
yours: the GCP/Firebase/Neon/Upstash accounts and the tested billing kill-switch.

## The bug worth reading about

`pnpm build` succeeded and produced artifacts that **could not run**:

```
Error: Dynamic require of "os" is not supported
    at .../services/users/dist/index.js:11
```

Cause: tsup externalises whatever is in the entry package's `dependencies` and
bundles everything else. `@deepcs/shared` is force-bundled on purpose
(`noExternal`), which dragged *its* dependencies — pino, and through the barrel
file, Fastify and avvio — into the bundle as inlined CommonJS. esbuild's
CJS-in-ESM shim turns their internal `require()` calls into a function that
throws at runtime.

Two things made it invisible: `tsup` exits 0, and `pnpm test` runs from source,
never touching `dist/`. The size was the tell — 144 KB for a service whose own
code is 8 lines, and 1.34 MB for the Stats job, which has no HTTP server in it
at all and had somehow bundled Fastify.

The fix was to delete the barrel `index.ts` and give `@deepcs/shared` subpath
exports, so Stats can import `@deepcs/shared/logger` without pulling in a web
framework, plus declaring the real runtime deps per service. Bundles went
144 KB → 2 KB and 1.34 MB → 765 B.

**Take the generalisable part, not the tsup trivia:** a green build is not a
working artifact, and the only check that would have caught this is running the
thing you actually ship. That's why `ci.yml` builds the image and then
`docker run`s it — the step that looks redundant next to typecheck+test is the
only one that would have failed here.

## The second bug worth reading about

First `docker compose up` failed like this:

```
firebase-auth   running   Up About a minute (unhealthy)
gateway         created   Created
dependency failed to start: container deepcs-firebase-auth-1 is unhealthy
```

The emulator's own logs said `✔ All emulators ready!`, and `curl
http://localhost:9099/` **from the host** returned 200. From inside the
container the identical request was refused.

Cause: inside that container `localhost` resolves to `::1` before `127.0.0.1`,
and the emulator binds IPv4 `0.0.0.0` only. Busybox wget tried the v6 address
and got ECONNREFUSED. So a perfectly healthy emulator failed its own
healthcheck, and `depends_on: condition: service_healthy` then refused to start
the Gateway — one wrong hostname in a healthcheck took down the service that
depends on it, while the thing being checked was fine the whole time.

Fix: probe `127.0.0.1` explicitly, and grep the response body for `ready`
rather than just checking that the port accepts a connection.

Note the shape, because it recurs: **the failure surfaced somewhere other than
where it was.** The alert was "gateway won't start"; the cause was a hostname in
an unrelated container's healthcheck.

## Questions

**1.** `docker-compose.yml` bind-mounts only `src/` directories, never the repo
root. What specifically breaks if you mount `.` to `/app` instead? Name the
mechanism, not just "node_modules problems".

**2.** In `Dockerfile`, the `manifests` stage copies eight `package.json` files
by name rather than doing `COPY . .`. What does that buy, and what is the
maintenance cost you've just accepted?

**3.** `createService()` registers its SIGTERM handler inside `start()` rather
than next to the other setup. Why? (The tests are the clue.)

**4.** `/health/live` and `/health/ready` return the same thing today. Describe
a concrete situation in phase 1 where they must return different things, and
what goes wrong if the orchestrator only has one of them.

**5.** `ci.yml` rebuilds all six services when `packages/shared/**` changes, but
only one when `services/questions/**` changes. Why isn't the shared-package case
also filtered down to "just the services that import it"?

**6.** Stats appears in `docker-compose.yml` but has no `ports:` and shows as
`exited (0)` seconds after startup. Explain why that's correct rather than a
misconfiguration — and what a reviewer should conclude if it showed
`exited (1)`.

**7.** `.env.example` sets `FIREBASE_AUTH_EMULATOR_HOST`. DESIGN.md §7 says that
flag "must be impossible to set in prod". Nothing in the repo currently enforces
that. Where should the enforcement live, and what does the failure look like if
it's missing?

**8.** `pnpm-workspace.yaml` has `allowBuilds: esbuild: true`. What is pnpm
defending against by blocking install scripts by default, and what did you give
up by adding that line?

---

## Answers

**1.** Two mechanisms. First, a bind mount over `/app` *replaces* the directory,
so the container's `/app/node_modules` — installed inside the image for
linux/arm64 or linux/amd64 — is shadowed by the host's, which contains binaries
compiled for the host platform. Native modules then fail to load. Second, pnpm
stores real packages under `node_modules/.pnpm` and symlinks into it; the host's
symlinks point at host paths that don't exist in the container. Mounting only
`src/` touches no dependency tree at all.

**2.** It buys layer caching. Docker invalidates a layer when any file it copies
changes, so `COPY . . && pnpm install` reinstalls every dependency whenever you
edit a `.ts` file. Copying manifests alone means the install layer is keyed on
dependency changes only. The cost: a seventh service means editing the
Dockerfile, and forgetting to means a confusing "module not found" for that
service alone.

**3.** `process.on('SIGTERM', …)` is process-global, not app-local. The test
file constructs two apps in one process; registering at construction leaves two
listeners behind, and a test suite that built eleven would trip Node's
max-listeners warning. Registering inside `start()` ties the handler's lifetime
to something that only happens once per process. (`process.once` rather than
`process.on` is belt-and-braces for the same reason.)

**4.** Phase 1 gives Users a Postgres pool and the Gateway a JWKS cache. During
the seconds after boot, the process is alive but cannot serve a request that
needs either — live yes, ready no. If you only have liveness, the orchestrator
routes traffic into a service that 500s. If you only have readiness, a process
that has wedged permanently is never restarted, because nothing distinguishes
"still starting" from "hung". Cloud Run only consumes readiness; the split still
matters because phase 8 puts these same containers on Kubernetes, which uses
both, and because a readiness probe that checks dependencies can take a whole
instance out of rotation when its database blips.

**5.** It could be, and at a larger scale it should be. It isn't here because
computing "which services import `@deepcs/shared`" means resolving the workspace
dependency graph in the filter step, and the answer today is *all six*. The
honest version of this is that the current rule is right for the wrong reason —
it'll stay right until some package in `packages/` is imported by only a subset,
at which point the filter needs the graph. Worth knowing the tools that do it
(`pnpm --filter '...[origin/main]'` resolves exactly this), and worth not
pretending the current line is more principled than it is.

**6.** Stats is a job (DESIGN.md §5). Its trigger is time, not a request, and a
scale-to-zero Cloud Run *service* has no running process for a timer to fire
inside — so it cannot be a server. Locally it does what Cloud Scheduler will
make it do every 5 minutes: run, drain, exit. `exited (0)` is the success case.
`exited (1)` would mean the run failed, which in production makes the Cloud Run
job retryable — the exit code is the entire contract between the job and its
scheduler.

**7.** It belongs in the Gateway's startup validation in phase 1: refuse to boot
if `NODE_ENV=production` and `FIREBASE_AUTH_EMULATOR_HOST` is set. Crash-on-boot
rather than log-and-continue, because a partial deploy is recoverable and an
open door is not. The failure if it's missing: the emulator issues *unsigned*
tokens, so a Gateway in emulator mode accepts a token anyone can forge with a
text editor — a total authentication bypass, silent, with valid-looking logs.

**8.** A dependency's `postinstall` script runs arbitrary code on your machine
and in CI, with your credentials, before any of your code executes — a
compromised transitive package is the classic supply-chain vector. pnpm blocks
them by default. The line gives esbuild an exception because its postinstall is
what puts the platform-native binary in place. What you gave up: esbuild's
install script now runs unchecked on every install, so an esbuild compromise
reaches you. The mitigation is that it's one named package rather than a blanket
`enable-pre-post-scripts=true`, and the lockfile pins which version.
