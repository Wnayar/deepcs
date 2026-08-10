# Phase 6 — Learn: the material the questions were drawn from

Phases 1–5 built a question bank and a way to solve one with a stranger. What
they did not build is a reason to be there before you can already answer things.
The bank was the front page, which put the drills in front of the material.

This phase seeds nine lessons — one per topic, extracted from the same notes the
question bank came from — and makes Learn the landing page. The loop it closes
is **read a topic → drill it → pair on it**, where the last step already existed
and the first two now lead into it.

---

# The three things — read this page, then stop if you're short on time

## 1. The extraction cut in the wrong place, and published the answers · ~10 min

The lessons and the questions come from the same source files. Each file teaches
a topic and then ends with its drill questions *and their answers* — which is
where the bank's `reference_md` came from in the first place. So extracting a
lesson means cutting each file before that section, and the cut is the whole
security boundary: everything above it is public teaching material, everything
below it is the answer key that the reveal rule exists to withhold.

The first pattern anchored the phrase to the start of a heading:

```js
/^#{1,3}\s*\**\s*(high-value interview questions|interview questions)/i
```

That matches the overview files, which head their drills
`# **High-Value Interview Questions to Drill**`. It does **not** match the day
files, which head theirs `## Part 6 — The Interview Questions, Answered`. Three
topics' worth of answers went into `questions.lessons`, a table served by a route
with no authentication at all.

Nothing about this was visible in review. The migration applied, the tests
passed, the pages rendered, and the leaked text sat below the fold of a 40KB
lesson body. What found it was asking the database a question no one had asked
before — does any slice of any answer appear in the lesson for its topic?

`repository.test.ts` now asks exactly that, and it is worth reading for the shape
rather than the specifics: six 70-character slices from each of the 27 answers,
searched for inside their own topic's lesson. Slices containing `;{}()=` are
excluded, because the notes legitimately teach the same code snippet they later
reference in an answer — the producer/consumer `pthread_cond_wait` example is in
both, correctly.

Put the old pattern back and the test names the three topics that leak.

## 2. A lesson belongs to a topic, not to a question · ~5 min

The obvious model is one lesson per question row, since there are 27 of each. It
is wrong twice.

The notes are written as a body of material per topic with drills at the end —
there is no per-difficulty teaching text to attach. And four topics (security,
ai-tooling, debugging, behavioural) are a *single* source file that the bank
already split three ways along difficulty; there is no way to split their prose
to match without inventing boundaries the author never wrote.

So: nine lessons, keyed by `topic`. The join to the drills is that `topic` is the
same string the bank already carries in `tags[1]`, which means listing the three
questions for what you just read is one filtered query and no join table.

The multi-day topics concatenate their overview and three day files into one
lesson, each file's `# Day 1 — …` demoted to `##` so the lesson's own title can
be the `h1`.

## 3. `/lessons` is its own Gateway prefix · ~3 min

The Gateway proxies a fixed list of prefixes and does no filtering on what
follows, so a new route is only browser-reachable if its prefix is on that list.
Lessons are served by the Questions service, so `/questions/lessons` would have
worked with no Gateway change at all — and is the wrong shape. Everything else
under `/questions/` takes a uuid as its next segment, and `/questions/:id/…` is
where the *answer* routes live. A prefix meaning "read the material" should not
be nested inside one meaning "read a question".

`/lessons` is therefore added to `ROUTES` in the Gateway, pointing at the same
service. Two prefixes, one upstream.

---

# Read the code in this order

| File | Why |
|---|---|
| `packages/db/migrations/009_lessons.sql` | The table and the nine seeded bodies. |
| `services/questions/src/repository.ts` | `listLessons` omits `body_md`; `getLesson` returns it. |
| `services/questions/src/index.ts` | The two routes, and why only one is cached. |
| `services/gateway/src/index.ts` | `ROUTES` — the prefix that makes them reachable. |
| `frontend/src/pages/Learn.tsx` | Nine tiles. |
| `frontend/src/pages/Lesson.tsx` | Markdown, then the three drills, then "find a partner". |
| `services/questions/src/repository.test.ts` | The `contains no reference answer text` guard. |

---

# Part 1 — Why `listLessons` does not select the body

`SUMMARY_COLUMNS` in the same file omits `reference_md` for secrecy. `listLessons`
omits `body_md` for a different reason: the nine bodies are about 160KB together
and the index page renders none of it. Same technique, unrelated motive — worth
noticing so the pattern is not read as "omitting a column is always a security
measure."

The list is cached for 60 seconds; a single lesson is not. Caching a 40KB body
read once per visit trades a Postgres primary-key lookup for holding the whole
corpus in Redis.

---

# Part 2 — Rendering markdown in a page with a strict CSP

`marked` is not a sanitizer, and does not need to be here: lesson bodies are
seeded by a migration from a fixed set of files, no route writes them, and the
page's CSP forbids inline script regardless of what any renderer emits. The
`dangerouslySetInnerHTML` call in `Lesson.tsx` carries that reasoning in a
comment, because the day lessons start accepting submissions is the day that
line needs a sanitizer in front of it — and by then why it was safe will not be
obvious from looking at it.

---

# Part 3 — What this phase deliberately did not build

- **No lesson search.** Nine topics fit on one screen.
- **No progress tracking.** There is no "completed" state and nothing to store it
  in; it would need a table, a route, and an opinion about what finishing means.
- **No per-difficulty lessons.** See thing 2 — the source material does not have
  them.
- **No history of your own past sessions.** The data exists (`matching.sessions`
  plus `collab.snapshots`) but nothing reads it back, and a page for it needs an
  endpoint on each of two services because no role may read the other's schema.

---

# Part 4 — Demonstrating the claims

## Claim 1 — no answer text is reachable without consent

```bash
pnpm --filter @deepcs/questions test -t "contains no reference answer text"
```

Then break it on purpose: change the `DRILLS` pattern used to build
`009_lessons.sql` back to one anchored at the start of a heading, re-seed, and
the same test names three leaking topics.

## Claim 2 — a lesson exists for every topic that has drills

```bash
pnpm --filter @deepcs/questions test -t "one lesson per topic"
```

The two are joined by a bare string, so a typo in either seed produces a page
that loads correctly and lists nothing. This is the test that catches it.

## Claim 3 — the routes are reachable, and shaped as documented

```bash
curl -s http://localhost:8080/lessons | head -c 120
# {"items":[{"topic":"ai-tooling","title":"AI Tooling"}, …

curl -s http://localhost:8080/lessons/os | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["title"], len(d["bodyMd"]), "bytes")'
# Operating Systems 33098 bytes

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/lessons/nope
# 404
```
