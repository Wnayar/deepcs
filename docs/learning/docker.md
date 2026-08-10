# Reading the Docker setup

Everything you need to read [`Dockerfile`](../../Dockerfile) and
[`docker-compose.yml`](../../docker-compose.yml) without guessing. The companion to
[`the-code.md`](the-code.md), written after a session where the
question wasn't "what does this line do" but "what *is* the thing being built".

**The goal is bounded on purpose.** Not "learn Docker". The goal is that those
two files read as ordinary English by the end, and that the sentence *"one
Dockerfile, six images, nine containers"* stops being confusing. Between them
they use the entire Docker vocabulary this repo has.

**Don't read this front to back.** It's a reference as much as a primer, and most
of it is lookup material. Pick the path that matches why you're here:

| If you want to… | Read | Time |
|---|---|---|
| **understand it well enough to explain your work** | **Part 1**, then **"Explaining this in an interview"** at the end | **~20 min** |
| work in the repo day to day | Part 6 (what to rebuild when) | 5 min |
| debug a container that won't start | Part 7 | as needed |
| understand *why* the Dockerfile is shaped like that | Part 3 | 10 min |
| decode one specific line you're stuck on | Part 2 (instructions) or Part 5 (line-by-line) | lookup |
| know what phase 10 adds | Part 8 | 5 min |

Part 1 and the interview section are the only two that are worth reading straight
through. They're written to stand alone — Part 1 gives you the model, the
interview section gives you the nine "why" answers. Everything between them is
detail you can come back for when a specific line stops you.

---

# Part 1 — The whole thing in one page

**The big picture.** Almost every Docker misunderstanding comes from treating
*Dockerfile*, *image*, and *container* as three words for one thing. They're three
objects, produced at different times, usually on different machines. Separating
them is most of the battle — and it's the part that matters in an interview.

## The problem being solved

Your Gateway service needs Node 24, an exact set of dependency versions, and a
handful of environment variables. Your laptop has one setup; a CI runner has
another; a Google Cloud machine has a third. Install the app on each and you get
three subtly different environments — "works on my machine" as a bug category.

A **container** removes the variable. Instead of shipping your code and hoping the
destination has the right Node, you ship *a filesystem that already contains the
right Node* with your code inside it. The destination supplies only a Linux
kernel; everything above that came in the box, identical everywhere.

## The three objects

1. **Dockerfile** — a text file of instructions. Inert. A recipe, not a program;
   reading it does nothing. It is input to a command.
2. **Image** — what `docker build` produces from that recipe: a **frozen
   filesystem** (Node's binaries, your `dist/`, your `node_modules`) plus
   **metadata** (which command to run, the working directory, env vars, which
   user). Still inert — no processes, no memory, no IP address. This is the thing
   that gets shipped between machines.
3. **Container** — what `docker run` (or `docker compose up`) produces from an
   image. Docker takes that frozen filesystem, adds a thin writable layer so the
   process can create temp files, isolates it in its own process and network
   space, and executes the recorded command.

**The relationship that matters:** *one image, many containers.* Start the same
image five times and you get five containers sharing zero memory and zero
filesystem changes. That's the "disposable copies sharing no memory" property from
[`the-code.md`](the-code.md) — this is where it comes from.

**The confusion to kill early:** *building* and *running* are separate acts, on
separate machines, often days apart.

## Two more nouns

**Registry** — a server that stores images so other machines can download them.
`docker pull postgres:17-alpine` fetches from Docker Hub, the public default.
Google's equivalent is **Artifact Registry**. Storage only; it never runs
anything.

**Build context** — the directory you point `docker build` at. `docker build`
doesn't build in your shell; it hands the work to the **Docker daemon**, a
background service, so the CLI first bundles the context directory and ships it
over. Two consequences: `COPY` can only reference files *inside* the context (it
cannot reach `../elsewhere`), and everything in the context is shipped every
build whether copied or not — which is what [`.dockerignore`](../../.dockerignore)
exists to prevent. Its own comment notes `node_modules` alone is 116 MB.

## So: one Dockerfile, six images, nine containers

**One Dockerfile**, because the six services are near-identical Node processes
([`Dockerfile:5-9`](../../Dockerfile#L5) has the reasoning). Six copies would mean
fixing the same bug six times.

**Six images**, because `docker build` is run against that one file **six separate
times**, each with a different service name:

```
docker build --build-arg SERVICE=gateway   ...  →  the gateway image
docker build --build-arg SERVICE=users     ...  →  the users image
docker build --build-arg SERVICE=questions ...  →  the questions image
   ...and so on, six times
```

`SERVICE` is substituted into the instructions, so the gateway build only ever
compiles and copies gateway's code. The six images are fully independent
afterwards — nothing links them.

**Nine containers**, locally: the 5 servers + the Stats job + Postgres + Redis +
the Firebase Auth emulator. Seven come from images built here — the five servers,
Stats, and the Firebase Auth emulator; two are downloaded ready-made — Postgres
and Redis.

## Where Google Cloud fits — the sentence that matters

**Images are built once, on GitHub's machines, and merely started on Google
Cloud.** Google never reads your Dockerfile, never runs `pnpm install`, never sees
your TypeScript.

The intended chain, once phase 10 exists:

1. You push code. **CI builds** the six images on GitHub's runners.
2. CI **pushes** them to **Artifact Registry**. Storage; nothing executes there.
3. `gcloud run deploy` tells **Cloud Run**: *here is an image on that shelf, start
   it.* Cloud Run pulls it and runs containers from it.

So "is it rebuilt on Google Cloud?" — no. The image is a finished artifact that
already contains Node and every dependency. Cloud Run's job is to pull it and
start it, and to start *more copies* when traffic rises — which works precisely
because containers from one image share nothing.

## Two environments, two halves of one file

The Dockerfile has several **stages**, and local and production use different
ones:

| | Local development | Production (phase 10) |
|---|---|---|
| Started by | `docker compose up` | Cloud Run |
| Dockerfile stage | `dev` | `runner` |
| Contains | all source, pnpm, tsup, dev deps | only compiled `dist/` + prod deps |
| Size (measured) | 583 MB | 251 MB |
| Code updates | `src/` mounted live; `tsx watch` restarts on save | never — the image is immutable |
| Postgres / Redis | containers on your laptop | managed (Neon / Upstash) |
| Auth | Firebase emulator container | real Firebase |

`docker-compose.yml` and the `dev` stage are local-only, forever. Only `runner`
ships — which is why the Dockerfile ends with a stage that throws away the
compiler and keeps just the output.

## Where this repo actually is right now

CI builds all six images and smoke-tests that each starts and answers
`/health/ready` — or for Stats, that it exits 0. Then it stops. **Nothing is
pushed anywhere and nothing is deployed yet**; steps 2 and 3 above are phase 10,
deferred until there's a GCP project with a tested billing guard in front of it.
Today you're looking at the "build it and prove it boots" half only.

## How small the syntax actually is

**Instructions** — 8 keywords. `FROM`, `ARG`, `ENV`, `RUN`, `WORKDIR`, `COPY`,
`CMD`, `USER`. The Firebase emulator Dockerfile adds `EXPOSE`. That's the entire
Docker instruction set used anywhere in this repo, out of roughly eighteen.

**Compose keys** — about twelve: `image`, `build`, `ports`, `volumes`,
`environment`, `depends_on`, `healthcheck`, `restart`, plus `context` /
`dockerfile` / `target` / `args` inside `build`.

**Not Docker at all** — `x-service: &service` and `<<: *service` are plain YAML.
`${LOG_LEVEL:-info}` is substitution Compose does before Docker sees the file.

So the syntax is small; the model above is the hard part. Everything after this is
detail you can look up.

---

# Part 2 — The nine instructions

**The big picture.** Instructions split cleanly into two groups, and mixing them
up is the single most common Dockerfile error. Some instructions **do something
now, at build time**, and their result is frozen into the image. Others **only
record a note** for later, when a container eventually starts. `RUN` is the first
kind. `CMD` is the second.

## `FROM` — where the filesystem starts

```dockerfile
FROM node:24-alpine
```

Start from an existing image rather than an empty disk. `node:24-alpine` already
contains a Linux userland and a working `node` binary, so you don't install
either.

The `name:tag` shape is universal: `postgres:17-alpine`, `redis:7-alpine`. The
part after the colon is a **tag** — a label pointing at a specific version.

`FROM ... AS name` labels a stage, which is Part 3.

## `WORKDIR` — set the current directory

```dockerfile
WORKDIR /app
```

Creates the directory if needed, and makes it the default for every later
`COPY`, `RUN`, and `CMD`. So after this line, a `COPY` to `packages/shared/`
really means `/app/packages/shared/`.

## `COPY` — host → image

```dockerfile
COPY <source> <destination>
```

Two arguments. Source is a path in the build context (your repo). Destination is
a path **inside the image being built** — a different filesystem that starts out
containing only what `FROM` provided.

```dockerfile
COPY packages/shared/package.json      packages/shared/
```

Source: that one file, from your repo. Destination: `/app/packages/shared/`
(relative to `WORKDIR`). The trailing `/` means "this is a directory — put the
file inside it under its original name", and Docker creates the directory since
it doesn't exist in the image yet. Result: `/app/packages/shared/package.json`
exists in the image, and nothing else from that folder does.

**The rule to internalise:** the image contains *only* what an instruction put
there. After the manifests block, `/app/packages/shared/` holds one file — no
`src/`, no `tsconfig.json`. They arrive later, in a different stage.

`COPY --from=<stage>` copies from another build stage instead of from the host.
Part 3.

## `RUN` — execute now, at build time

```dockerfile
RUN corepack enable
RUN pnpm install --frozen-lockfile
```

Runs the command *during the build*, inside a temporary container made from
whatever the image looks like at that point. Whatever the command changed on disk
becomes part of the image permanently.

So `RUN pnpm install` doesn't mean "install when the container starts". It means
the finished image already has a populated `node_modules` baked in, and starting
a container never installs anything.

## `CMD` — record what to run *later*

```dockerfile
CMD ["sh", "-c", "node services/${SERVICE}/dist/index.js"]
```

`CMD` executes **nothing at build time**. It writes a note into the image's
metadata: *when a container starts from me, run this.* You can have many `RUN`s;
the last `CMD` wins, and there's normally one.

**Two forms, and the difference is load-bearing:**

```dockerfile
CMD node dist/index.js              # shell form — wrapped in /bin/sh -c for you
CMD ["node", "dist/index.js"]       # exec form  — run directly, no shell
```

Exec form is normally preferred: no shell process in the way. But no shell also
means **no variable substitution** — `["node", "dist/${SERVICE}.js"]` would look
for a file literally named `${SERVICE}.js`.

This repo needs substitution, so it uses exec form and invokes the shell
deliberately: `["sh", "-c", "node services/${SERVICE}/dist/index.js"]`. The
`${SERVICE}` is expanded by `sh` **when the container starts**, reading it from
the environment — which is why the next instruction exists.

## `ARG` vs `ENV` — the distinction that explains a duplicated line

```dockerfile
ARG SERVICE            # build-time only. Gone from the finished image.
ENV SERVICE=${SERVICE} # runtime. Visible to the process inside the container.
```

`ARG` declares a variable you can pass in with `--build-arg`. It exists only
while building. `ENV` sets a real environment variable that persists into the
image and is visible to your Node process via `process.env`.

**Why both appear at [`Dockerfile:52-53`](../../Dockerfile#L52) and again at
[`73`/`86`](../../Dockerfile#L73):** the `CMD` above expands `${SERVICE}` at
*container start*, long after build-time `ARG`s have evaporated. Without the
`ENV` line, `sh` would expand it to an empty string and the container would try
to run `node services//dist/index.js`. The apparent duplication is the bridge
from build time to runtime.

**`ARG` is scoped per stage.** That's why `ARG SERVICE` appears three separate
times — lines 52, 59, and 73 — once in each stage that uses it. Declaring it once
at the top would not carry over. `ARG NODE_VERSION` at
[line 18](../../Dockerfile#L18) sits before any `FROM`, which is the one special
case: it's usable in `FROM` lines, and this repo only uses it there.

## `USER` — stop being root

```dockerfile
USER node
```

Everything before this ran as root. Everything after — including the container's
eventual `CMD` — runs as the `node` user, which the official Node images ship for
exactly this purpose.

**Why:** a container running as root that gets compromised has root over its
filesystem, and root inside a container is a much better starting point for
escaping it. Note the placement in this repo: it comes *after* the `COPY` lines,
so the copied files stay root-owned and the app can read but not modify its own
code.

## `EXPOSE` — documentation only

```dockerfile
EXPOSE 9099 4000
```

In [`docker/firebase-emulator/Dockerfile:16`](../../docker/firebase-emulator/Dockerfile#L16).
This is worth knowing precisely because it looks more powerful than it is:
`EXPOSE` **does not open or publish anything**. It records "this image intends to
serve on these ports" for humans and tooling. Actually making a port reachable
from your laptop is `ports:` in Compose, or `-p` on `docker run`.

## `# syntax=docker/dockerfile:1`

[Line 1](../../Dockerfile#L1), and it must be the first line to work. It selects
which version of the Dockerfile parser to use, letting Docker fetch a newer one
than your local install ships. It's what makes `RUN --mount=type=cache` in Part 3
legal.

## One you'll see elsewhere but not here

`ENTRYPOINT` — the same idea as `CMD` but harder to override, and the two
interact in a fiddly way when both are present. This repo uses only `CMD`. When
you meet a Dockerfile with both, read `ENTRYPOINT` as the fixed program and
`CMD` as its default arguments.

---

# Part 3 — Layers, the cache, and multi-stage builds

**The big picture.** An image isn't one blob — it's a stack of **layers**, one
per instruction. That single design decision explains the whole shape of this
repo's Dockerfile: why manifests are copied before source, why `package.json`
files are listed one by one instead of `COPY . .`, and why there are seven stages
where you'd expect one.

## Layers

Each instruction that changes the filesystem — `COPY`, `RUN` — produces a layer:
a record of the difference it made. Instructions that only change metadata
(`ENV`, `WORKDIR`, `CMD`, `USER`, `ARG`) produce a layer too, but with no file
content in it.

The final image is those layers stacked in order. Layers are shared: if two of
your six images start from the same `node:24-alpine` layers, that content is
stored once, not twice.

## The build cache, and the one rule that matters

Docker keeps the layer from last time and reuses it if the inputs haven't
changed. The rules differ by instruction:

- **`COPY`** — the cache key includes a checksum of the files being copied.
  Change a copied file, and the layer is rebuilt.
- **`RUN`** — the cache key is *the command string itself*, plus the layer
  beneath it. Docker does **not** inspect what the command did. `RUN pnpm
  install` with an unchanged parent layer is reused even if new package versions
  were published upstream. (This is a feature here: the lockfile is what decides
  versions, not the timing of your build.)

**The rule to internalise: once a layer is invalidated, every layer after it is
invalidated too.** Nothing downstream can be reused, because its starting point
changed.

That single rule is the entire reason for
[`Dockerfile:27-40`](../../Dockerfile#L27):

```dockerfile
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json      packages/shared/
COPY services/gateway/package.json     services/gateway/
...
```

**The naive version:**

```dockerfile
COPY . .
RUN pnpm install --frozen-lockfile
```

**Why it fails:** `COPY . .` is checksummed over your whole repo. Fix a typo in a
comment in one `.ts` file and that layer is invalidated — so the `RUN pnpm
install` beneath it is too, and every build reinstalls every dependency from
scratch. On a monorepo that's minutes, every time, forever.

**The fix:** copy only the files `pnpm install` actually reads — the eight
`package.json` files, the lockfile, the workspace file, `.npmrc` — and run the
install against just those. Now editing a `.ts` file doesn't touch this layer at
all, and the cached install is reused. Source code arrives later, in a stage
*after* the install.

The trade is that the list is manual: add a seventh service and you must add a
`COPY` line, or its dependencies silently won't install.

## Cache mounts

```dockerfile
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
```

A different kind of cache. `--mount=type=cache` attaches a directory that
**persists on the build machine between builds but is never part of the image**.
Here it's pnpm's store — the pool of downloaded package tarballs. So even when
the install layer *is* invalidated, pnpm re-links from a local store instead of
re-downloading from the network, and none of that store bloats the final image.

`id=pnpm` names the cache, which is how the `deps` and `prod-deps` stages share
one.

Worth following through, because it's a fair "wait, does that work?": if
`node_modules` were just links into `/pnpm/store`, and the store isn't in the
image, the image would be broken. It isn't, because the cache mount is a separate
filesystem — pnpm can't hardlink across it and copies the real files into
`node_modules` instead. The store is an optimisation for the *download*, not the
contents of the image.

The `PNPM_HOME=/pnpm` and `PATH` lines at
[`Dockerfile:22-23`](../../Dockerfile#L22) are what put the store at `/pnpm/store`
so the mount target matches. `RUN corepack enable` on line 24 turns on the `pnpm`
command — Node ships corepack for this, so there's no `npm install -g pnpm`.

## Multi-stage builds

```dockerfile
FROM node:${NODE_VERSION} AS base
FROM base AS manifests
FROM manifests AS deps
```

`FROM ... AS <name>` names a stage. A later stage can do one of two things with
an earlier one:

**Build on top of it** — `FROM deps AS build` starts with everything `deps` had
and keeps going.

**Steal files from it** — `COPY --from=deps /app/node_modules ./node_modules`
reaches into that stage and copies files out, *without* inheriting any of its
other content.

That second one is the point. It lets the final image take only the outputs and
leave behind the tooling that produced them.

**In this repo:** the `build` stage has the full toolchain — pnpm, tsup,
TypeScript, dev dependencies, all your source. The `runner` stage
([`Dockerfile:72`](../../Dockerfile#L72)) starts from a *fresh* `node:24-alpine` —
note it does **not** say `FROM base`, because it doesn't need pnpm at all — and
copies in exactly three things: the production `node_modules`, the service's
`node_modules`, and the compiled `dist/`. No source, no TypeScript, no bundler,
no dev dependencies.

**Measured on this repo**, gateway, same machine:

| Image | Size |
|---|---|
| `node:24-alpine` (the bare base) | 234 MB |
| `dev` stage — what Compose runs | 583 MB |
| `runner` stage — what ships | 251 MB |

The `runner` image adds **17 MB** on top of the base — that's your entire
application and its production dependencies. The `dev` stage adds 349 MB, almost
all of it tooling that only ever runs at build time. Cloud Run pulls the image on
a cold start, so that difference is startup latency a user waits through.

**Only the stages you need get built.** `docker build --target runner` builds
`base → manifests → deps → build`, plus `prod-deps`, then `runner`. The `dev`
stage is never built. Conversely `--target dev` (what Compose uses) never builds
`build`, `prod-deps`, or `runner`.

---

# Part 4 — Compose

**The big picture.** A Dockerfile describes one image. Compose describes a whole
*system*: which containers exist, how they reach each other, what's plugged into
them, and what order they may start in. It exists because "run nine containers on
a shared network with the right dependencies and env vars" is not something you
want to type by hand.

Compose is for local development here. Nothing in
[`docker-compose.yml`](../../docker-compose.yml) runs in production — Cloud Run
takes that role in phase 10.

## `services:` — each key is one container

```yaml
services:
  postgres:
    image: postgres:17-alpine
  gateway:
    build:
      context: .
```

The key (`postgres`, `gateway`) is the service's name, and it matters more than
it looks — see networking below.

**`image:` vs `build:`** is the whole choice per service. `image:` downloads a
ready-made image from a registry. `build:` builds one from a Dockerfile now.
Postgres and Redis are downloaded; the six services and the Firebase emulator are
built.

```yaml
    build:
      context: .              # the build context — Part 1
      dockerfile: Dockerfile  # which recipe inside that context
      target: dev             # stop at this stage — Part 3
      args:
        SERVICE: gateway      # fills in ARG SERVICE
```

That block is `docker build --target dev --build-arg SERVICE=gateway .` written
as YAML. Six services means six of these blocks, differing only in the service
name — which is the same "one recipe, N images" pattern from Part 1.

## Networking — this is the one to actually learn

Compose creates a private network for the project and puts every container on it.
Inside that network, **each container is reachable at its service name as a
hostname**.

That's the entire explanation for [line 17](../../docker-compose.yml#L17):

```yaml
DATABASE_URL: postgresql://deepcs:deepcs@postgres:5432/deepcs
REDIS_URL: redis://redis:6379
FIREBASE_AUTH_EMULATOR_HOST: firebase-auth:9099
```

`postgres`, `redis`, and `firebase-auth` are not domains anyone registered.
They're the service keys under `services:`, and Docker's internal DNS resolves
them to whichever container is currently running for that service. Rename the
service and every one of these URLs breaks.

## `ports:` — punching a hole to your laptop

```yaml
ports:
  - '5432:5432'
```

`HOST:CONTAINER`. The left number is the port on *your machine*, the right is the
port inside the container.

**The distinction that catches everyone:** service-to-service traffic does not
need `ports:` at all. Gateway can reach `postgres:5432` purely over the Compose
network. `ports:` exists so *you* — a browser, `curl`, a database GUI running on
your laptop — can get in. Which is why `stats` has no `ports:`: nothing outside
ever calls it.

This is also where [`0.0.0.0` from `the-code.md` Part 4](the-code.md)
pays off. Publishing port 8080 forwards to the container's port 8080, but if the
process inside bound only to loopback, there's nothing listening on the interface
the forward arrives on, and you get connection refused from a perfectly healthy
process.

## `volumes:` — two different things sharing one key

```yaml
    volumes:
      - pgdata:/var/lib/postgresql/data                                  # named volume
      - ./services/gateway/src:/app/services/gateway/src:ro              # bind mount
```

**Named volume** (`pgdata:...`) — storage Docker manages somewhere on its own. It
**survives** the container being deleted, which is why your local database isn't
wiped by `docker compose down`. It has to be declared at the bottom of the file
too ([line 175](../../docker-compose.yml#L175)) — that's what the trailing `volumes:`
block is.

**Bind mount** (`./path:...`) — a directory on *your machine* mapped into the
container. Not a copy: the same files. Edit `src/index.ts` in your editor and the
file inside the container changes instantly. `:ro` makes it read-only from the
container's side.

**Why the six services use bind mounts:** the `dev` stage runs `tsx watch`, which
restarts on file change. Mount your `src/` in and editing code restarts the
service, with no rebuild. Without the mount you'd rebuild an image for every
keystroke.

Verified on this repo — appending one comment line to
`services/collab/src/index.ts` **on the host**, then reading the container's logs:

```
collab-1  | 4:20:29 PM [tsx] change in ./src/index.ts Restarting...
collab-1  | {"severity":"INFO",...,"signal":"SIGTERM","message":"shutting down"}
collab-1  | {"severity":"INFO",...,"message":"Server listening at http://172.18.0.6:8084"}
```

Worth reading all three lines. `tsx` saw a host-side edit through the mount; the
restart went through `SIGTERM`, so the graceful-shutdown handler from
`the-code.md` Part 3 ran; and it came back listening on `172.18.0.6` —
the container's address on the Compose network, which it only has because the
process binds `0.0.0.0` rather than loopback.

**The failure mode the Dockerfile warns about**
([`Dockerfile:48-50`](../../Dockerfile#L48)): only `src/` directories are mounted,
never `/app`. Mounting `/app` would put your host directory over the *whole*
working directory, and your host directory has no `node_modules` in it — that's
excluded by `.dockerignore` and lives only inside the image. The container's
`node_modules` would vanish behind the mount and nothing would resolve.

## `environment:` and interpolation

```yaml
    environment:
      LOG_LEVEL: ${LOG_LEVEL:-info}
```

Sets environment variables inside the container, readable as `process.env.X`.

`${LOG_LEVEL:-info}` is substituted **by Compose, before Docker sees it**: use
the value from your shell or a `.env` file in this directory, and if it's unset or
empty, use `info`. That's what makes `docker compose up` work with no `.env` file
at all, as [`.env.example`](../../.env.example) promises.

## `depends_on` and `healthcheck` — start order

```yaml
    depends_on:
      postgres:
        condition: service_healthy
```

Plain `depends_on: [postgres]` only waits for the container to be **started** —
which for a database means the process exists but is very likely still
initialising and rejecting connections.

`condition: service_healthy` waits for it to be *ready*, and readiness is defined
by that service's own `healthcheck`:

```yaml
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U deepcs -d deepcs']
      interval: 5s
      timeout: 3s
      retries: 10
```

Docker runs `test` inside the container every `interval`. Exit code 0 means
healthy. After `retries` consecutive failures it's marked unhealthy.

Two forms: `['CMD', 'redis-cli', 'ping']` runs a binary directly.
`['CMD-SHELL', '...']` runs the string through a shell, which you need for pipes
— `wget -qO- ... | grep -q ready` on
[line 74](../../docker-compose.yml#L74) only works because of `CMD-SHELL`.

**Why it matters**, per the comment at
[`docker-compose.yml:41-43`](../../docker-compose.yml#L41): without the healthcheck,
the services start before Postgres accepts connections and crash-loop on boot.
`depends_on` alone would look correct and fail anyway.

The Firebase healthcheck at [line 65](../../docker-compose.yml#L65) is worth reading
in full — it documents two separate real bugs. It uses `127.0.0.1` rather than
`localhost` because `localhost` can resolve to IPv6 `::1` first while the
emulator binds IPv4 only, so a healthy emulator reports as refused. And it greps
the response body rather than just checking the port, because the port opens
before the emulator can actually mint tokens.

## `restart:`

```yaml
    restart: unless-stopped   # the five servers
    restart: 'no'             # stats
```

`unless-stopped` restarts the container if it crashes, and on Docker daemon
startup, unless you explicitly stopped it.

Stats overrides it to `no` because Stats is a **job**: it runs, does its work,
exits 0, and that's success — per `the-code.md` Part 3, the exit code is
its entire contract. Restarting it forever would be wrong. So `docker compose ps`
showing `stats  exited (0)` is the correct outcome, not a failure.

Note the quotes on `'no'`. YAML reads a bare `no` as the boolean `false`. This is
a genuine footgun in YAML generally, not a Docker thing.

## The YAML bits that aren't Docker

```yaml
x-service: &service
  environment:
    ...

services:
  gateway:
    <<: *service
```

Three separate YAML features:

- **`x-` prefix** — Compose ignores any top-level key starting with `x-`. It's a
  sanctioned place to park reusable blocks.
- **`&service`** — defines an *anchor*, naming this block.
- **`<<: *service`** — a *merge key*: inline the anchored block's keys here. Keys
  written alongside it win.

So the six services each inherit the same `environment`, `depends_on`, and
`restart` without repeating them. Pure deduplication — you could expand it by
hand and the behaviour would be identical.

The comment at [line 7](../../docker-compose.yml#L7) explains what's deliberately
*not* in the anchor: `build` and `volumes`, because every service overrides both
anyway, and putting them in the anchor would falsely suggest they were shared.

---

# Part 5 — Read your own files

**The big picture.** Nothing new appears from here. This is Parts 1–4 applied to
the two real files, in order. If a line stops you, the concept it uses is above.

## `Dockerfile`

```dockerfile
ARG NODE_VERSION=24-alpine
```

Before any `FROM`, so it's usable in `FROM` lines. One place to change the Node
version for the whole file, overridable with `--build-arg` without editing
anything.

```dockerfile
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
```

The shared foundation. `PNPM_HOME` puts pnpm's store at a fixed path so the cache
mounts later can target it; adding it to `PATH` makes globally-installed binaries
findable. `corepack enable` activates the `pnpm` command. Every subsequent stage
except `runner` builds on this.

```dockerfile
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json      packages/shared/
COPY services/gateway/package.json     services/gateway/
...
```

Part 3's cache split. Eight `package.json` files plus the lockfile and workspace
file — everything `pnpm install` reads, and nothing else. After this stage the
image contains ten small files and zero lines of your code.

Both halves are needed: the lockfile supplies exact versions, and each
`package.json` is what makes pnpm treat that directory as a workspace package at
all. Drop one and pnpm installs nothing for that service without erroring.

```dockerfile
FROM manifests AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile
```

The expensive step, isolated so it can be cached. `--frozen-lockfile` means: fail
rather than update the lockfile if it disagrees with the manifests. A build must
never quietly resolve different versions than the ones committed.

```dockerfile
FROM deps AS dev
ARG SERVICE
ENV SERVICE=${SERVICE}
COPY . .
CMD ["sh", "-c", "pnpm --filter @deepcs/${SERVICE} dev"]
```

What Compose builds. `COPY . .` brings in all the source — fine here, because
this stage is last in its chain so there's nothing downstream to invalidate. The
`ARG`/`ENV` pair is the build-time-to-runtime bridge from Part 2. The `CMD` runs
that service's `dev` script, which is `tsx watch src/index.ts` — and Compose
mounts your `src/` over the copied one so the watch sees your edits.

```dockerfile
FROM deps AS build
ARG SERVICE
COPY . .
RUN pnpm --filter "@deepcs/${SERVICE}" build
```

Compiles one service. No `ENV SERVICE` here — nothing in this stage runs at
container start, so build-time `ARG` alone is enough. `pnpm --filter` is what
selects one workspace package, and it works because that service's
`package.json` declares both its name and its `build` script.

`build` is `tsup`, configured per service. The load-bearing line is
`noExternal: [/^@deepcs\//]` in
[`services/gateway/tsup.config.ts`](../../services/gateway/tsup.config.ts): it
inlines `@deepcs/shared` into the output instead of leaving it as an import. Its
comment spells out the failure — the shared package resolves through a pnpm
symlink into a store that won't exist in the runtime image, so leaving it
external produces an image that dies on its first import.

```dockerfile
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod
```

A second install, from `manifests` rather than `deps`, with `--prod` so
`devDependencies` — tsup, tsx, typescript, vitest — are skipped. Same cache mount
id, so it reuses downloads from the first install.

```dockerfile
FROM node:${NODE_VERSION} AS runner
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps /app/node_modules                     ./node_modules
COPY --from=prod-deps /app/services/${SERVICE}/node_modules ./services/${SERVICE}/node_modules
COPY --from=build     /app/services/${SERVICE}/dist         ./services/${SERVICE}/dist
```

The production image, and the payoff for all the staging. `FROM node:...`, not
`FROM base` — no pnpm needed, since nothing here installs anything. Three
`COPY --from` lines pull outputs from two different stages, and everything else
those stages contained is discarded.

The comment at [line 64](../../Dockerfile#L64) covers the subtle part: pnpm's
symlinks are relative and point inside `/app`, so copying both trees to the same
paths keeps them resolvable. And [line 81](../../Dockerfile#L81) notes that
`@deepcs/shared` is deliberately absent — tsup inlined it, so the dangling
workspace symlink left behind is never followed.

```dockerfile
USER node
ENV SERVICE=${SERVICE}
CMD ["sh", "-c", "node services/${SERVICE}/dist/index.js"]
```

Drop root, bridge `SERVICE` into the runtime environment, and record the start
command. `node` runs `dist/`, never source — TypeScript isn't in this image.

**A question worth resolving, because it silently breaks graceful shutdown when
the answer goes the other way.** The command runs through `sh -c`. If that shell
stayed alive as PID 1 with `node` as its child, `SIGTERM` would go to the *shell*
— and busybox `sh` does not forward signals to children. The handler in
`service.ts` would never run, Docker would wait 10 seconds, then `SIGKILL`, and
every in-flight request would be dropped on every deploy. The symptom would be
intermittent and would look like a network problem.

**Verified on this setup: `node` is PID 1, and the handler runs.** Alpine's
busybox `sh` `exec`s a single simple command, replacing itself rather than
forking — and it still does so with `${SERVICE}` expansion in the string. Built
an image with this repo's exact `CMD` shape and a SIGTERM handler:

```
$ docker exec <container> ps -o pid,args
PID   COMMAND
    1 {MainThread} node services/gateway/dist/index.js    ← node, not sh

$ docker stop <container>          # took 0s, not the 10s SIGKILL timeout
$ docker logs <container>
started, pid=1
GOT SIGTERM - graceful shutdown ran
$ docker inspect -f '{{.State.ExitCode}}' <container>
0
```

So this `CMD` is correct as written. Two things to carry forward: if the command
ever grows a second command, a pipe, or a redirection, `sh` stops `exec`ing and
starts staying alive as PID 1 — at which point the fix is an explicit
`exec node ...` inside the string. And the one-liner above is how you re-check it:
if `ps` ever shows `sh` at PID 1, graceful shutdown is broken.

## `docker-compose.yml`

```yaml
name: deepcs
```

The project name. Compose prefixes the network, volumes, and container names with
it, so this project's containers don't collide with another project's.

```yaml
x-service: &service
  environment:
    LOG_LEVEL: ${LOG_LEVEL:-info}
    NODE_ENV: development
    DATABASE_URL: postgresql://deepcs:deepcs@postgres:5432/deepcs
    REDIS_URL: redis://redis:6379
    FIREBASE_PROJECT_ID: ${FIREBASE_PROJECT_ID:-demo-deepcs}
    FIREBASE_AUTH_EMULATOR_HOST: firebase-auth:9099
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
  restart: unless-stopped
```

The block all six services merge in. Every hostname here — `postgres`, `redis`,
`firebase-auth` — is a service key resolved by Compose's DNS. Credentials are
hardcoded because this database only ever exists on your laptop; the real ones
arrive as Cloud Run secrets in phase 10.

```yaml
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: deepcs
      POSTGRES_PASSWORD: deepcs
      POSTGRES_DB: deepcs
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data
```

Downloaded, not built. Those three `POSTGRES_*` variables aren't Docker
conventions — the Postgres image's own startup script reads them to create the
user and database on first run. `ports:` is here so you can connect a GUI from
your laptop; the services wouldn't need it. `pgdata` is the named volume that
makes your data survive `docker compose down`.

```yaml
  firebase-auth:
    build:
      context: ./docker/firebase-emulator
    ports:
      - '9099:9099'
      - '4000:4000'
```

Note it does **not** merge `*service` — it isn't one of the six and has no use for
`DATABASE_URL`. Its context is its own subdirectory, so its Dockerfile's `COPY
firebase.json ./` picks up
[`docker/firebase-emulator/firebase.json`](../../docker/firebase-emulator/firebase.json)
— which binds both the emulator and its UI to `0.0.0.0`, for the reason in Part 4.

```yaml
  gateway:
    <<: *service
    build:
      context: .
      dockerfile: Dockerfile
      target: dev
      args:
        SERVICE: gateway
    ports:
      - '8080:8080'
    volumes:
      - ./packages/shared/src:/app/packages/shared/src:ro
      - ./services/gateway/src:/app/services/gateway/src:ro
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      firebase-auth:
        condition: service_healthy
```

The full pattern. Merge the shared block; build the `dev` stage with
`SERVICE=gateway`; publish 8080 so you can `curl` it; mount two `src/`
directories read-only so `tsx watch` sees your edits — the service's own, plus
`shared`, because a change there should restart the service too.

Gateway re-declares `depends_on` rather than inheriting it, because it needs a
third dependency (`firebase-auth`) and a merge key replaces the whole key rather
than adding to it. The other four services are identical to this minus that
override and with their own port and paths.

```yaml
  stats:
    <<: *service
    build:
      ...
      args:
        SERVICE: stats
    volumes:
      - ./packages/shared/src:/app/packages/shared/src:ro
      - ./services/stats/src:/app/services/stats/src:ro
    restart: 'no'
```

No `ports:` — nothing calls it. `restart: 'no'` because exiting is success. The
comment above it tells you how to run it on demand:
`docker compose run --rm stats`.

```yaml
volumes:
  pgdata:
```

Declares the named volume referenced above. Required — Compose won't invent it.

---

# Part 6 — Using it day to day

**The big picture.** Two command families, matching the two files. `docker` acts
on one image or container. `docker compose` acts on the whole system described by
`docker-compose.yml`, and must be run from the directory containing it.

But the question that actually comes up isn't "what commands exist" — it's *"I
changed something, do I need to rebuild?"* That's the first section, because
getting it wrong is the most common way to waste ten minutes debugging a change
that was never applied.

## The four commands that cover most days

```
docker compose up -d --build       # start it all, rebuilding what changed
docker compose logs -f gateway     # what is it doing / why did it die
docker compose exec gateway sh     # get inside and look around
docker compose down                # stop it all
```

## "I changed X — do I need to rebuild?"

The rule underneath the table: **your source is bind-mounted, your
`node_modules` is not.** Only `src/` directories are mounted, so edits to code
appear instantly, while anything that changes what's *installed* requires the
image to be rebuilt.

| What you changed | What to run | Why |
|---|---|---|
| a `.ts` file under `src/` | **nothing** | mounted live; `tsx watch` restarts the service on save |
| added/removed a dependency in a `package.json` | `docker compose up -d --build <service>` | `node_modules` was installed at the `deps` layer and lives *in the image*; the mount only covers `src/` |
| `pnpm-lock.yaml` | `docker compose up -d --build` | invalidates the install layer for every image |
| `Dockerfile` | `docker compose up -d --build` | all six images are built from it |
| `docker-compose.yml` | `docker compose up -d` | Compose re-reads it and recreates changed containers — no image rebuild needed |
| `.env` | `docker compose up -d` | env vars are applied when a container is created |
| a `tsup.config.ts` | nothing for local dev | only affects `build`/`runner`, which Compose never builds |
| added a whole new service | see below | three files, and missing one fails quietly |

**Adding a seventh service** is the one worth spelling out, because the failure is
silent rather than loud:

1. `Dockerfile` — add a `COPY services/<name>/package.json services/<name>/` line
   to the `manifests` stage. Miss this and `pnpm install` never sees the service,
   so it gets no `node_modules` and no error.
2. `docker-compose.yml` — add a service block with its `SERVICE` build arg, port,
   and `src/` mounts.
3. `.github/workflows/ci.yml` — add it to the `ALL` array, or CI silently never
   builds or tests it.

## Compose — day-to-day

```
docker compose up                  # build if needed, start everything, stream logs
docker compose up -d               # same, detached (returns your terminal)
docker compose up --build          # force a rebuild first
docker compose up gateway          # just this one, plus what it depends_on

docker compose ps                  # what's running, and health status
docker compose logs -f gateway     # follow one service's logs
docker compose exec gateway sh     # a shell inside a running container
docker compose run --rm stats      # one-off run of a service, then delete it

docker compose down                # stop and remove containers + network
docker compose down -v             # ...and delete named volumes (wipes Postgres)
```

`exec` is your main debugging tool. When something is broken, `docker compose exec
gateway sh` and then `ls /app/node_modules` answers "is the file actually there"
directly, instead of by inference.

`down` vs `down -v` is the one to be careful with: `-v` deletes `pgdata`.

## Building images directly

```
docker build --target runner --build-arg SERVICE=gateway -t deepcs/gateway:ci .
```

- `--target runner` — stop at that stage (Part 3)
- `--build-arg SERVICE=gateway` — fills in `ARG SERVICE` (Part 2)
- `-t deepcs/gateway:ci` — tag the result `name:tag`, so you can refer to it later
- `.` — **the build context** (Part 1). Easy to forget; it's required.

Run six of those with different `SERVICE` values and you have the six images. CI
does exactly this in a matrix — [`.github/workflows/ci.yml:129`](../../.github/workflows/ci.yml#L129)
passes `build-args: SERVICE=${{ matrix.service }}`.

## Inspecting

```
docker images                      # images on this machine, and their sizes
docker ps                          # running containers
docker ps -a                       # including exited ones
docker run --rm -p 8080:8080 -e PORT=8080 deepcs/gateway:ci
docker logs <container>
```

`--rm` deletes the container when it exits, which you almost always want for
one-offs. `-e` sets one environment variable. `-p` is `ports:` in flag form.

`docker images` is the fastest way to see whether the multi-stage work paid off —
compare a `runner` image against a `dev` one.

## Cleanup

```
docker system df                   # how much disk Docker is using
docker system prune                # remove stopped containers, unused networks
docker builder prune               # remove build cache
```

Worth knowing early. Layer caches and old images accumulate to tens of gigabytes
without complaining.

---

# Part 7 — When it breaks

**The big picture.** Container problems feel opaque because the thing that failed
is behind a wall. It mostly isn't: you can get a shell inside any running
container, and almost every mystery resolves into one of four questions — is it
running, did the app say why, is the file actually there, are the env vars what I
think. The ladder below is ordered so each rung rules out a layer.

Resist guessing and rebuilding. `--build` is a slow way to test a hypothesis;
`exec` is a fast one.

## The debugging ladder

**1. Is it even running, and how did it fail?**

```
docker compose ps -a
```

Read `STATUS` precisely — these are four different problems:

- `Exited (0)` — ran to completion successfully. For `stats` this is the correct
  outcome, not a bug.
- `Exited (1)` — the app crashed. Go to step 2.
- `Restarting` — crash-looping. It's starting, dying, and `restart:
  unless-stopped` is bringing it back. Step 2, and read the *earliest* logs.
- `Up (unhealthy)` — the process is alive but its `healthcheck` fails. Suspect
  the check itself as much as the app.
- `Created` — never started, because a `depends_on` condition isn't satisfied.
  Look at what it depends on, not at it.

**2. What did the app itself say?**

```
docker compose logs gateway          # all of it
docker compose logs --tail=50 gateway
docker compose logs -f gateway       # follow live
```

Most answers are here. For a crash loop, scroll to the *top* — the first failure
is the real one; everything after is the same error repeating.

**3. Is it a "won't start" problem or a "can't reach it" problem?**

This split saves the most time. Get inside and try locally:

```
docker compose exec gateway sh
# then, inside:
curl localhost:8080/health/live
```

- **Works inside, fails from your laptop** → networking. Missing `ports:`, wrong
  host:container mapping, or the process bound loopback instead of `0.0.0.0`.
- **Fails inside too** → the application. Back to step 2.

**4. Is the file actually there?**

```
docker compose exec gateway ls /app/services/gateway
docker compose exec gateway ls /app/node_modules | head
```

This kills a whole category of guessing about `COPY` paths and mounts in one
command. If `node_modules` is missing or thin, the install layer or a
`package.json` is the problem — not your code.

**5. Are the environment variables what you think?**

```
docker compose exec gateway env | sort
```

Checks `SERVICE`, `DATABASE_URL`, and `PORT` in one go. An empty `${VAR}` that
silently became `""` shows up here.

**6. What did Compose actually resolve?**

```
docker compose config
```

Prints the file *after* `${VAR}` interpolation and `<<: *service` merging — the
real input Docker received. This is the only reliable way to see what an anchor
merge produced, and it catches unset variables that quietly defaulted to empty.

## Symptom → cause → fix

| Symptom | Likely cause | Fix |
|---|---|---|
| `connection refused` from your laptop, container is `Up` | app bound loopback, or no `ports:` entry | listen on `0.0.0.0`; check the `HOST:CONTAINER` mapping |
| service crash-loops immediately on `up` | started before Postgres accepted connections | `depends_on` with `condition: service_healthy` |
| `Cannot find module` for a dependency you just added | `node_modules` lives in the image, not the bind mount | `docker compose up -d --build <service>` |
| `Cannot find module '@deepcs/shared'` in a `runner` image | tsup left it external; the pnpm symlink doesn't resolve there | `noExternal: [/^@deepcs\//]` in that service's `tsup.config.ts` |
| every build reinstalls everything | source copied before the install step | manifests-first ordering (Part 3) |
| `no projects matched the filters` | that service's `package.json` isn't in the image | add its `COPY` line to the `manifests` stage |
| `COPY failed: file not found` | path is outside the build context, or `.dockerignore`d | check both — `.dockerignore` is easy to forget |
| container `unhealthy` but the app answers fine | healthcheck probes `localhost` (may resolve IPv6 first), or checks before real readiness | use `127.0.0.1`; assert on the response body |
| edits to `.ts` files do nothing | that `src/` path isn't mounted, or you edited a path the mount doesn't cover | check the service's `volumes:` |
| `node_modules` vanished inside the container | a bind mount was placed over `/app` | mount only `src/` directories |
| `stats` shows `Exited (0)` | that is success — it's a job | nothing |
| Docker eating tens of GB | accumulated layer cache and old images | `docker system df`, then `docker system prune` / `docker builder prune` |

## Watching the cache work

The single best way to make Part 3 concrete:

```
docker build --progress=plain --target runner --build-arg SERVICE=gateway -t x .
```

Every step prints, with `CACHED` where a layer was reused. Edit a `.ts` file,
rebuild, and confirm the `pnpm install` step still says `CACHED`. Then edit any
`package.json` and watch it stop saying that — along with everything after it.
That's the invalidation rule from Part 3, visible.

---

# Part 8 — What's coming

**The big picture.** None of this is in the repo yet. It exists so that when
phase 10 adds the deploy step, you recognise the shape. The key thing to
understand now is the split: **images are built once, in CI, and merely started
on Google Cloud.** Google Cloud never reads your Dockerfile.

## The chain, end to end

Currently [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) does the
first half only. It builds each changed service's `runner` image with
`push: false`, then `docker run`s it and checks `/health/ready` answers — or for
Stats, that it exits 0. Then it stops. The comment at the bottom of that file is
explicit that the rest is deliberately absent until there's a GCP project with a
tested billing guard in front of it.

The full chain will be:

1. **Build**, in CI, on GitHub's machines. Six images. This part exists.
2. **Tag** each one with its registry address and the commit SHA:
   `asia-southeast1-docker.pkg.dev/<project>/deepcs/gateway:<sha>`. The registry
   host is part of the image name — that's how `docker push` knows where to send
   it.
3. **Push** to **Artifact Registry**. Storage only; nothing runs.
4. **Deploy**: `gcloud run deploy gateway --image <that address>`. Cloud Run
   pulls the image and starts containers from it.

So the answer to "is it rebuilt on Google Cloud" is no. It's built once, shipped
as a finished artifact, and started. That portability is the entire reason
containers exist — the cloud needs to know nothing about Node, pnpm, or your repo
layout, only "start this image".

## What Cloud Run does to your container

Three things, and `the-code.md` Part 3 already covered the code side of
each:

- **Injects `PORT`** and expects you to listen on it. Hence
  `process.env.PORT ? Number(...) : port` — the `SERVICES` value is only a local
  default.
- **Sends `SIGTERM`** before shutting an instance down, on deploys and on
  scale-in. The handler in `service.ts` is what turns that into a clean shutdown
  instead of dropped connections — and the PID 1 check at the end of Part 5 is
  what confirms the signal actually reaches it.
- **Reads the exit code** for Jobs. Stats runs as a Cloud Run Job, and 0 versus
  non-zero is what decides whether it retries.

## What replaces Compose

Nothing, directly — and that's the thing to notice. Compose's jobs get taken over
by different pieces: the network becomes service URLs and IAM; `environment:`
becomes Cloud Run env vars and Secret Manager; `depends_on` has no equivalent at
all, because Postgres and Redis become managed services (Neon, Upstash) that are
simply already running. Health checks become Cloud Run's own probes against the
same `/health/live` and `/health/ready` routes.

The `dev` stage and `docker-compose.yml` stay local-only, forever. Only `runner`
ships.

---

# Explaining this in an interview

**The big picture.** Nobody will ask you to recite `COPY` syntax. What gets asked
is *why* — and every "why" here has a real answer, because each was a decision with
a failure mode behind it. These are the nine worth being able to say out loud. Each
is 2–3 sentences; that's the right length for an answer.

**"Why containers at all?"**
The service needs a specific Node version and exact dependency versions. My
laptop, CI, and Cloud Run are three different machines — installing on each gives
three subtly different environments. A container ships the filesystem *with* the
app, so the same bits that passed CI are the bits that run in production.

**"You have six services but one Dockerfile — why?"**
They're near-identical Node processes, so six copies would mean applying every fix
six times and drifting in five. Independent deployability doesn't live in the
file — it lives in the pipeline and the image tag. CI builds six *separate* images
from that one file, each with a different `SERVICE` build arg, and deploys them
independently.

**"Walk me through your multi-stage build."**
The build stage needs pnpm, tsup, TypeScript and every dev dependency; the runtime
needs none of that. So the final stage starts from a clean base and copies in only
the compiled `dist/` and production `node_modules`. Measured on my repo: the dev
image is 583 MB, the shipping image is 251 MB — only 17 MB above the bare
`node:24-alpine` base. That difference is cold-start latency on Cloud Run.

**"Why copy the `package.json` files before the source code?"**
Docker caches per layer, and invalidating one invalidates everything after it. If
I copied source before `pnpm install`, then editing a single comment in a `.ts`
file would invalidate the install layer and reinstall every dependency on every
build. Copying just the manifests and the lockfile first means a code edit reuses
the cached install.

**"Why not build the image on Google Cloud?"**
There's no reason to. The image is a finished, portable artifact — it already
contains Node and every dependency. CI builds it once and pushes it to Artifact
Registry; Cloud Run pulls it and starts it. Building in two places would mean the
thing I tested and the thing that ships were built separately, which defeats the
point.

**"How do you handle a deploy without dropping requests?"**
Cloud Run sends `SIGTERM` before stopping an instance. The service catches it,
stops accepting new connections, and lets in-flight requests finish before
exiting. The subtlety is that the signal has to actually reach Node — if a shell
sat in front of it as PID 1, busybox wouldn't forward the signal and the handler
would never run. I verified `node` is PID 1 in the running container.

**"Why does the container run as a non-root user?"**
Blast radius. Root inside a container is a much better starting point for
escaping it, so the final stage switches to the `node` user. The `COPY` steps run
before that switch, so the application code stays root-owned — the process can
read its own code but not modify it.

**"Why healthchecks instead of just `depends_on`?"**
`depends_on` alone only waits for the container to have *started*, and a Postgres
container accepts connections well after that. The services would start, fail to
connect, and crash-loop. `condition: service_healthy` plus a `pg_isready` check
makes "ready" mean ready. Separately, live and ready are two different questions:
live means "is this process wedged, restart it", ready means "may traffic be
routed here" — a service still connecting to Postgres is live but not ready.

**"How do you develop against this locally?"**
One `docker compose up` brings up nine containers: five services, the Stats job,
Postgres, Redis, and a Firebase Auth emulator. Source directories are
bind-mounted, so `tsx watch` picks up edits without a rebuild. The emulator means
local dev and CI need no cloud account and no credentials — and the project id is
prefixed `demo-`, which makes the emulator refuse to contact real Google services.

**The two numbers worth memorising:** 583 MB → 251 MB (multi-stage payoff), and
9 containers / 6 images / 1 Dockerfile.

---

# What to skip for now

Real parts of Docker this project won't make you learn. Skipping them is a
decision, not an omission.

- **`ENTRYPOINT` vs `CMD`** interaction rules. This repo uses only `CMD`.
- **`ADD`** — like `COPY` but also fetches URLs and auto-extracts archives. That
  implicit behaviour is why `COPY` is preferred; just use `COPY`.
- **`HEALTHCHECK` in a Dockerfile** — this repo puts health checks in Compose
  instead, where they're visible next to `depends_on`.
- **`VOLUME`** in a Dockerfile. Compose's `volumes:` covers everything here.
- **Writing your own base image** from `FROM scratch`, and **distroless** images.
  `node:24-alpine` is the right trade for a long time.
- **Multi-architecture builds** (`buildx`, `--platform`), unless you hit an
  arm64-vs-amd64 mismatch between an Apple laptop and Cloud Run. Then it becomes
  urgent and the fix is one flag.
- **`docker network`, `docker volume`** as manual commands. Compose creates and
  names both for you.
- **Kubernetes, Helm, Swarm.** Cloud Run is deliberately the thing that means you
  don't need them.
- **Layer-squashing and image-size micro-optimisation.** The multi-stage split
  already got the large win.

# Where to go after this

**The Dockerfile reference** — genuinely a reference, not a tutorial. Look up one
instruction at a time; the `COPY` and `ARG` pages resolve most real confusion.

**The Compose file reference** — same shape. The `depends_on` and `volumes`
sections are the ones worth reading properly.

**`docker build --progress=plain`** — the most useful learning tool here. It
prints every step with `CACHED` markers, so you can watch the Part 3 cache rules
happen. Edit a `.ts` file, rebuild, and confirm the install layer says `CACHED`.
Then edit a `package.json` and watch it not.

For video, search "docker multi-stage build" and "docker compose networking"
specifically. Skip anything titled as a full Docker course — Parts 1–4 are the
whole surface this repo uses.

**One honest note.** Docker does show up in system-design interviews, but only at
the level of Part 1: image versus container, why the same artifact runs
everywhere, why you'd split a build stage from a runtime stage. The instruction
syntax never comes up. Part 1 is the part worth being able to explain out loud.
