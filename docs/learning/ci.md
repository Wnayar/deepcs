# Reading the CI pipeline

Everything you need to read [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
without guessing. Companion to [`docker.md`](docker.md) — the Docker-build-and-smoke-test
step this file runs is the same one that doc explains from the Docker side.

**The goal is bounded on purpose.** Not "learn GitHub Actions". The goal is that
this one file, 166 lines, reads as ordinary English, and that "does CI stop a bad
push" stops being a guess.

---

## The big picture — what CI does for this repo, in one sentence

**On every push and every pull request, GitHub starts fresh machines that install
the repo, lint it, and — for whichever of the six services actually changed —
typecheck, test, build, Docker-build, and boot the image to prove it works; the
result shows up as a green check or a red X.**

Three things worth being precise about, because they're the part that's easy to
get wrong:

- **CI never stops a `git push`.** Pushing is a git operation; it always succeeds
  or fails on git's own terms, before CI even starts. CI runs *after*, as a
  separate process reporting a result.
- **A red X does not undo anything.** If you push straight to `main`, the commit
  is already there by the time CI finishes and tells you it's broken.
- **Whether a red X blocks a PR merge is a GitHub *repo setting*
  ("branch protection" → "require status checks"), not anything in this file.**
  With it off, CI is purely advisory — informational, not a gate. This repo's
  setting isn't visible from `ci.yml` itself; that's a separate thing to check in
  GitHub's settings if it matters to you.

Everything below is *how* it does that one sentence.

---

## The syntax — how small it is

GitHub Actions' own vocabulary, used in this file, is about ten keywords:

- **`on`** — what triggers a run: `push`, `pull_request`, etc.
- **`jobs`** — a run is one or more jobs. Each gets its own fresh virtual machine.
- **`runs-on`** — which machine image for that job (`ubuntu-latest` here, every time).
- **`steps`** — the ordered list of things a job does.
- **`uses`** — run someone else's packaged step (an "action") instead of writing
  the shell yourself, e.g. `actions/checkout@v4`.
- **`run`** — run a shell command directly.
- **`with`** — arguments passed to a `uses` action.
- **`needs`** — this job waits for that job, and can read its outputs.
- **`if`** — skip this job/step unless the condition holds.
- **`strategy: matrix`** — run the same steps once per item in a list, in parallel.

`${{ ... }}` is GitHub Actions' own template syntax — evaluated by GitHub before
any shell runs, not by bash. `${{ github.workflow }}` reads a fact about the run
itself; `${{ needs.changes.outputs.services }}` reads a value another job produced.

That's the whole surface. The rest of the file is either plain YAML (lists, maps)
or plain bash inside `run:` blocks.

---

## Reading `ci.yml` top to bottom

### Triggers and concurrency — [lines 3–10](../../.github/workflows/ci.yml#L3)

```yaml
on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

Two triggers: a push landing on `main`, or any pull request (opened against any
branch). `pull_request` with no filter under it means "every PR, targeting
anything."

`concurrency` says: group runs by workflow name + branch, and if a new run starts
in that group, cancel whichever one was still going. Push three commits to the
same PR in a minute and only the last run finishes — the first two are killed
before wasting more machine time.

### Job 1 — `changes`: which of the six services actually changed? — [lines 21–82](../../.github/workflows/ci.yml#L21)

```yaml
changes:
  runs-on: ubuntu-latest
  outputs:
    services: ${{ steps.detect.outputs.services }}
    count: ${{ steps.detect.outputs.count }}
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
```

`actions/checkout@v4` is the standard first step of almost any job: the runner
starts with an empty disk, so this pulls the repo onto it. `fetch-depth: 0` asks
for full git history (not just the latest commit), because the next step needs to
diff against an older commit — that's impossible with a shallow clone.

`outputs:` at the job level exposes values so a *later* job (`service`, via
`needs:`) can read them. That's the mechanism the matrix step below depends on.

```bash
if [ "${{ github.event_name }}" = "pull_request" ]; then
  base=$(git merge-base "origin/${{ github.base_ref }}" HEAD)
elif [ "${{ github.event.before }}" != "0000...0" ]; then
  base="${{ github.event.before }}"
else
  base=""   # first push on a branch: no diff base, build everything
fi
```

Figures out what to diff *against*. For a PR, that's the point where the PR's
branch forked from its base — not the base's latest commit, which would include
commits landed on `main` after the fork. For a direct push, it's simply the
commit before this one. The empty-string case is a brand-new branch with no prior
commit to compare to.

```bash
if [ -z "$base" ]; then
  echo "services=$ALL" >> "$GITHUB_OUTPUT"
  ...
if echo "$changed" | grep -qE '^(package\.json|...|packages/|\.github/workflows/)'; then
  echo "services=$ALL" >> "$GITHUB_OUTPUT"
```

Two "build everything" escape hatches. No diff base — build all six, since there's
nothing to compare against. Or a **shared** file changed — the lockfile, root
config, `Dockerfile`, anything under `packages/` — build all six, because that
code is compiled into every image; skipping a service here is how a broken shared
change reaches production untested (that's the comment at
[line 55](../../.github/workflows/ci.yml#L55) in full).

```bash
selected=$(echo "$changed" \
  | { grep -oE '^services/[^/]+' || true; } \
  | cut -d/ -f2 | sort -u | jq -R . | jq -sc .)
```

Otherwise: pull out every changed path starting `services/<name>`, keep just
`<name>`, dedupe, and turn the result into a JSON array (`jq -R .` quotes each
line as a JSON string, `jq -sc .` slurps all of them into one compact array). A
change under `services/questions/` alone produces `["questions"]`.

The `|| true` on the `grep` — and only the `grep` — is deliberate, not
decoration: `grep` exits `1` when it matches nothing, which is exactly what a
docs-only commit looks like. Under `set -e` (line 34) that exit code would kill
the step right there, before the `[ "$selected" = "" ]` guard on the next line
ever runs. Braced onto `grep` alone, `|| true` swallows only *that* expected
"found nothing" case — a real failure in `cut`/`jq` downstream still stops the
step, because `pipefail` (also line 34) makes the pipeline's exit code the
*last* command that actually failed.

**`echo "x=y" >> "$GITHUB_OUTPUT"`**, seen throughout — this is how a step
publishes a value under a name (`services`, `count`) that `outputs:` above then
re-exposes at the job level, and `needs.changes.outputs.services` reads from
elsewhere in the file. It's a file GitHub Actions gives each step to write
key=value lines into.

### Job 2 — `lint`: repo-wide, once — [lines 85–96](../../.github/workflows/ci.yml#L85)

```yaml
lint:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 24
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm lint
    - run: pnpm format:check
```

No `needs:`, so this starts immediately, in parallel with `changes`. It doesn't
care which services changed — lint and format rules apply repo-wide, so running
it once here instead of once per service (inside the matrix below) avoids doing
the same check six times.

`setup-node` with `cache: pnpm` caches downloaded packages between runs so
`pnpm install` doesn't refetch everything from the network every time — separate
from, and faster than, a cold install.

### Job 3 — `service`: the actual per-service work — [lines 99–165](../../.github/workflows/ci.yml#L99)

```yaml
service:
  needs: changes
  if: needs.changes.outputs.count != '0'
  strategy:
    fail-fast: false
    matrix:
      service: ${{ fromJSON(needs.changes.outputs.services) }}
```

`needs: changes` — wait for that job, and unlock its `outputs`. `if:` — skip this
whole job on a docs-only commit where nothing under `services/` or shared files
changed (`count` is `"0"`).

`fromJSON(...)` turns the string `'["questions"]'` back into a real JSON array,
which `strategy: matrix` then fans out over — **one parallel run of every step
below per service in that array.** `fail-fast: false` means if `questions` fails,
`matching` keeps running to completion anyway, so you see every failure at once
instead of only the first.

```yaml
- run: pnpm --filter "@deepcs/${{ matrix.service }}" typecheck
- run: pnpm --filter "@deepcs/${{ matrix.service }}" test
- run: pnpm --filter "@deepcs/${{ matrix.service }}" build
```

`${{ matrix.service }}` is that run's item from the array — `questions`, say.
`pnpm --filter` scopes the command to one workspace package. Three checks, in
order, each stopping the job on failure before the next runs.

```yaml
- name: build image
  uses: docker/build-push-action@v6
  with:
    target: runner
    build-args: SERVICE=${{ matrix.service }}
    push: false
    load: true
    tags: deepcs/${{ matrix.service }}:ci
```

The same `docker build --target runner --build-arg SERVICE=...` from
[`docker.md`](docker.md#building-images-directly), run by an action instead of a
raw `run:` line. `push: false` — never uploaded anywhere; `load: true` — keep the
built image on this runner's local Docker so the next step can start it. This is
not redundant with typecheck/test/build above: those prove the *code* compiles,
this proves the *image* actually assembles — a service can pass all three and
still produce a dead image if, say, a package was left external and its symlink
doesn't resolve at runtime (`docker.md` Part 5 walks that exact failure).

```bash
if [ "${{ matrix.service }}" = "stats" ]; then
  docker run --rm deepcs/stats:ci
else
  docker run -d --name smoke -p 8080:8080 -e PORT=8080 deepcs/${{ matrix.service }}:ci
  for i in $(seq 1 30); do
    if curl -fsS http://localhost:8080/health/ready; then ok=1; break; fi
    sleep 1
  done
  docker logs smoke
  docker rm -f smoke
  [ "${ok:-0}" = "1" ]
fi
```

Proves the image actually **starts**, not just that it built. `stats` is a job —
runs once and exits — so success there just means "exit code 0", the same
contract from `docker.md`. The other five are long-running servers, so this
starts one, polls `/health/ready` for up to 30 seconds, dumps its logs either
way (useful in the failure case), tears the container down, then fails the step
if `ok` was never set to `1`.

---

## What a failure actually looks like

Tying back to the big picture at the top, now with the specific jobs in view:

| What failed | What you see | What it stops |
|---|---|---|
| `lint` | red X on `lint` only | nothing else — `changes` and `service` are independent jobs |
| `changes` (the detect script itself breaks) | red X on `changes` | `service` never starts at all — it's gated on `needs: changes` succeeding |
| one service in the matrix, e.g. `questions` typecheck | red X on `questions` only | nothing for the other changed services — `fail-fast: false` |
| any of the above | a red X on the commit / PR checks list | **the merge button, only if branch protection requires this check — otherwise nothing** |

---

## What to skip for now

- **Reusable workflows / composite actions** — calling one workflow from another.
  Not used here; every job in this file is defined inline.
- **Secrets and `GITHUB_TOKEN` permissions** — this file needs none yet, because
  it never pushes an image or deploys anything. Phase 6 will add both.
- **Self-hosted runners** — `ubuntu-latest` (GitHub's own machines) is the right
  choice for a long time.
- **Caching beyond what's here** — `cache: pnpm` and the Docker action's
  `cache-from`/`cache-to: type=gha` cover this repo's needs already.

## Where to go after this

**The GitHub Actions docs' "Understanding GitHub Actions" page** — short, and
covers the `on`/`jobs`/`steps` model this file uses end to end.

**`docker/build-push-action`'s own README** — the action doing the heaviest
lifting in the `service` job; worth five minutes if `cache-from`/`cache-to`
looks unfamiliar.

**One honest note.** None of this is CI/CD theory or an interview topic on its
own — it's closer to reading `docker.md`: once "job", "step", "matrix", and
"this file only reports, it doesn't gate" click, the rest is bash you already
know how to read.
