# The workspace: packages, the lockfile, and every config file

Everything in this repo that is not a service and not a lesson. The files you
have to understand before `pnpm install` makes sense: eleven `package.json`s,
one lockfile, five kinds of config, and the rules that keep them from drifting.

Nothing here is exotic. It is worth its own page because it is the part that has
no diagram, gets skipped, and is then the thing that breaks.

---

## 1. One repository, eleven packages, one lockfile

A **monorepo**: many independently buildable packages in one git repository,
installed together. pnpm calls the set of them a **workspace**.

```
deepcs/
├── package.json          the root package — tooling and scripts only, ships nothing
├── pnpm-workspace.yaml   which directories are packages, and the version catalog
├── pnpm-lock.yaml        the exact resolved dependency tree, for every package
├── .npmrc                two pnpm settings
│
├── services/             six deployables, one package each
│   ├── gateway/  users/  questions/  matching/  collab/  stats/
├── packages/
│   ├── shared/           imported by the six services, never deployed alone
│   └── db/               migrations and the runner, imported by nobody
├── frontend/             the React app — a package, but not a service
└── load/                 the k6 script — a package so it shares Yjs versions
```

**`packages/` versus `services/` is a rule, not a preference.** A directory
under `services/` is assumed by CI to be a Docker-buildable server with a
`/health/ready` endpoint, and the CI matrix builds an image for each one. A
directory under `packages/` is treated as shared code: touching it rebuilds
*every* service, because it is compiled into all of them.

That is exactly why `frontend/` and `load/` sit at the top level instead. The
frontend is a static bundle with no image and no health endpoint, and putting it
under `packages/` would make every UI tweak rebuild and smoke-test all six
backend services.

---

## 2. `pnpm-workspace.yaml` — three jobs in one file

### `packages:` — what counts as a package

```yaml
packages:
  - 'services/*'
  - 'packages/*'
  - 'frontend'
  - 'load'
```

A directory listed here and containing a `package.json` becomes part of the
workspace. `pnpm install` at the root then installs for all of them at once and
links them to each other.

### `catalog:` — one version of each dependency, named once

Without this, six services list `fastify` separately, drift onto six versions,
and the shared types in `packages/shared` stop matching some of them. The
catalog names each version once:

```yaml
catalog:
  fastify: ^5.6.0
  zod: ^4.1.5
```

and every package asks for it by reference:

```json
"dependencies": { "fastify": "catalog:", "zod": "catalog:" }
```

Upgrading Fastify is then one line in one file. `catalog:` is not a version
range pnpm invents — it is a pointer, resolved at install time to whatever the
catalog says.

### `allowBuilds:` — which packages may run install scripts

pnpm blocks dependency install scripts by default. That is a supply-chain
control: a compromised transitive package cannot run code on your machine merely
because you installed it.

`esbuild` is an explicit exception, because its postinstall is what puts the
platform-native binary in place, and both `tsup` and `vitest` are dead without
it. `@firebase/util` and `protobufjs` arrive with the Firebase SDK and are
declined — the list exists to make each answer deliberate rather than silent.

---

## 3. `package.json`, root and per-package

**The root one ships nothing.** It holds the tooling everyone shares (eslint,
prettier, typescript), the `packageManager` field that pins pnpm's version, and
scripts that fan out across the workspace.

**Every package here is `"private": true`** — none is published to npm, and the
flag is what stops an accidental `pnpm publish`. Every one is
`"type": "module"`, which tells Node to read `.ts`/`.js` files in that package as
ES modules (`import`) rather than CommonJS (`require`).

Three dependency notations appear, and they mean different things:

| Written as | Means |
|---|---|
| `"fastify": "catalog:"` | whatever version the catalog names |
| `"@deepcs/shared": "workspace:*"` | the copy in this repo, symlinked — never fetched from a registry |
| `"esbuild": "^0.25.0"` | a literal range, used only where a package is genuinely local to one place |

**The scripts are the same five names everywhere**, so `pnpm -r <name>` works
across the whole repo:

| Script | Does |
|---|---|
| `dev` | `tsx watch src/index.ts` — run from source, restart on save |
| `build` | `tsup` — bundle to `dist/` |
| `typecheck` | `tsc --noEmit` — types only, emits nothing |
| `test` | `vitest run` |
| `migrate` | `packages/db` only |

Two packages answer `build` and `typecheck` with an `echo` and `exit 0`.
`packages/shared` is consumed from source and bundled into each service, so it
has nothing of its own to build; `packages/db` is `.sql` files and one `.mjs`
script, so it has no TypeScript to check. Answering successfully keeps `pnpm -r
build` meaningful rather than requiring per-package exceptions.

### `@deepcs/shared` has no barrel, on purpose

```json
"exports": {
  "./service": "./src/service.ts",
  "./logger":  "./src/logger.ts",
  ...
}
```

So you import `@deepcs/shared/db`, never `@deepcs/shared`. The reason is at the
top of [`packages/shared/src/service.ts`](../../packages/shared/src/service.ts):
tsup inlines this package into every service bundle, and a barrel makes that
inlining all-or-nothing. Importing the barrel for a logger drags Fastify in too,
and Fastify's CommonJS dependencies cannot be tree-shaken back out. The Stats
job is not a server and must never import Fastify, which is what forced this.

Note what the `exports` map points at: `./src/service.ts`, a **TypeScript
source file**. Nothing compiles this package. Its consumers do.

---

## 4. `pnpm-lock.yaml` and `.npmrc`

**The lockfile is the exact resolved tree** — every package, every transitive
dependency, every version and integrity hash, for all eleven packages at once.
`package.json` says "Fastify 5.x"; the lockfile says "Fastify 5.11.0, and here
are the 40 packages that came with it".

- **It is committed**, so every machine and CI install byte-identically.
- **Never edit it by hand.** Change `package.json` or the catalog and run
  `pnpm install`.
- **CI and the Dockerfile use `--frozen-lockfile`**, which fails rather than
  silently updating the lockfile if it disagrees with the manifests. A build
  that quietly resolves a different tree than your laptop is a whole class of
  "works on my machine".

`.npmrc` is two settings:

```
strict-peer-dependencies=false
auto-install-peers=true
```

A **peer dependency** is a package that says "I need React, but I will not
install it — my host must". `auto-install-peers` installs those automatically;
`strict-peer-dependencies=false` downgrades a version mismatch from an install
failure to a warning. Both are pragmatism about the React and Yjs ecosystems,
which declare peers loosely.

---

## 5. Running things across the workspace

```bash
pnpm install                          # everything, from the root
pnpm -r test                          # every package that has a `test` script
pnpm --filter @deepcs/gateway dev     # one package, by name
pnpm --filter @deepcs/db migrate      # what `make migrate` runs
```

`-r` is recursive, `--filter` selects by the package's `name` field — which is
`@deepcs/<thing>`, not the directory path. Every name matches its folder except
one: the frontend is **`@deepcs/web`**, so `pnpm --filter @deepcs/frontend`
finds nothing.

The `Makefile` wraps the handful you actually use daily. It exists so that
"start the backend" is `make up` rather than a compose invocation to remember.

---

## 6. TypeScript: one base config, three overrides

`tsconfig.base.json` at the root holds every real setting. Each package's
`tsconfig.json` is two lines:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

The settings worth knowing:

| Option | Effect |
|---|---|
| `strict` | the whole family of strict checks, including `strictNullChecks` |
| `noUncheckedIndexedAccess` | `arr[0]` is typed `T \| undefined`, because indexing can miss. This is why `!` appears after array and row lookups |
| `verbatimModuleSyntax` | a type-only import must say `import type`, so nothing type-only survives into the emitted JavaScript |
| `moduleResolution: "Bundler"` | relative imports need no `.js` extension, because tsup bundles every service before it runs |
| `noEmit` (via `--noEmit`) | `tsc` here only ever checks types. tsup does the emitting |

**`frontend/tsconfig.json` is the one real override.** The base config targets
Node: no `jsx`, and a `lib` of ES2023 with no DOM. Without the three lines the
frontend adds, `document`, `window` and JSX are all unresolved.

`packages/db` and `load/` have no tsconfig at all. Both are plain JavaScript:
the migration runner is one `.mjs` file, and k6 runs its own runtime which
resolves neither `node_modules` nor TypeScript.

---

## 7. The four tools that turn source into something that runs

**`tsx`** runs TypeScript directly, no build step. It is what `dev` uses, and
what compose runs inside the `dev` image so an edit reloads without a rebuild.

**`tsup`** (esbuild underneath) bundles a service to one file in `dist/` for the
production image. Each service's `tsup.config.ts` is six lines, and one is
load-bearing:

```ts
noExternal: [/^@deepcs\//],
```

tsup externalises everything in `dependencies` by default — it assumes
`node_modules` will be there at runtime. `@deepcs/shared` resolves through a
pnpm symlink into a content-addressed store *outside* the project directory,
which does not exist inside the runtime image, so externalising it produces an
image that dies on its first import. `noExternal` inlines that code instead.

`services/stats/tsup.config.ts` is the only one with two entries, because that
image has two entrypoints: `index.ts` drains the event log and exits,
`server.ts` answers reads.

**`vite`** builds the frontend. Its config carries two things worth knowing: the
Content-Security-Policy injected on build only (the dev server needs inline
scripts for hot reload, and a policy loose enough to allow those is not worth
shipping), and a two-line alias working around Monaco 0.56's `exports` map. Both
are commented in [`frontend/vite.config.ts`](../../frontend/vite.config.ts).

**`vitest`** runs the tests, sharing Vite's transform pipeline so there is no
second TypeScript setup to keep in step. There is no `vitest.config.ts` anywhere
— the defaults are enough, and the environment variables the suites need come
from the `Makefile` instead.

---

## 8. Lint and format

`eslint.config.js` is **flat config** — a plain array of blocks, each optionally
scoped by `files:`. It replaced the older `.eslintrc` format, and mixing the two
is a common source of "my plugin will not load".

Four blocks, three of them scoped:

- **everything:** the recommended JS and TypeScript rules, plus
  `consistent-type-imports` (which `verbatimModuleSyntax` requires) and
  `no-unused-vars` with an `^_` escape hatch.
- **`frontend/**`:** the two React hooks rules. Not style — the class of bug they
  catch is an effect closing over a stale value, and the session page runs a
  WebSocket, a Yjs document and an editor out of a single effect.
- **`packages/db/**/*.mjs`:** plain Node JS that never goes through TypeScript,
  so the Node globals have to be declared.
- **`load/**/*.js`:** k6's runtime, which provides `__ENV` and timers but no
  `process` and no `require`.

`.prettierrc.json` is three lines, and the interesting file is
`.prettierignore`: **`docs/` is excluded**, because Prettier pads markdown table
cells to align columns, so editing one row rewrites the whole block and the diff
stops being readable.

---

## 9. The three ignore files, which are not interchangeable

| File | Answers |
|---|---|
| `.gitignore` | what is never committed |
| `.dockerignore` | what is never sent to the Docker daemon as build context |
| `.prettierignore` | what is never reformatted |

`.dockerignore` is the one with a performance argument attached. The Dockerfile
does `COPY . .`, and Docker invalidates that layer whenever *any* file in the
context changes. So `docs/`, `frontend/` and `k8s/` are excluded not because
they are secret but because without those lines, editing a doc would rebuild all
six service images. It also excludes `.env`, because `COPY . .` would otherwise
put your local secrets inside an image.

---

## 10. Adding a seventh service: the checklist

Every step here is a place something silently does not happen if you skip it.

1. `services/<name>/` with a `package.json` named `@deepcs/<name>`, the five
   standard scripts, and `"@deepcs/shared": "workspace:*"`.
2. A two-line `tsconfig.json` extending the base.
3. A `tsup.config.ts` with `noExternal: [/^@deepcs\//]` — copy an existing one.
4. Add the port to `SERVICES` in
   [`packages/shared/src/services.ts`](../../packages/shared/src/services.ts).
5. Add its `package.json` to the `manifests` stage of the `Dockerfile`. That
   stage copies each one **by name**, and forgetting yours means "module not
   found" for that one service only.
6. Add a compose service, a `k8s/` Deployment and Service, and a Gateway route
   prefix if a browser has to reach it.
7. `pnpm install` at the root, so the lockfile and the symlinks catch up.

Then run `pnpm -r typecheck && pnpm lint && make up && make test`. Steps 4 and 5
are the two that fail late rather than immediately.
