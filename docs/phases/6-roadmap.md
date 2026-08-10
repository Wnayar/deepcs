# Phase 6 — The roadmap, and fixing content at the source

Phases 1 to 5 built a question bank and a way to solve one with a stranger.
What they did not build was a reason to be there before you could already
answer things. The bank was the front page, which put the drills in front of
the material, and the Learn section added afterwards sat beside it as a second
list of the same nine topics.

This phase merges them into one map. Topics are laid out by what makes what
easier to read, clicking one opens its three steps, and a step is a page
holding a lesson and the questions it prepares you for.

Most of the work is in the database, because most of the problem was there.

---

# The four things — read this page, then stop if you're short on time

## 1. Fix the source, not the view · ~10 min

Three separate things were being corrected in the browser at render time, and
each one was a symptom of stored data being in the wrong shape:

| Stored | Corrected in the browser | Now |
|---|---|---|
| `## Process vs thread?` | `numberReference()` rewrote headings to `1.` on every render | Stored as `### 1. Process vs thread?` |
| One lesson per topic, headed `Day 1`, `Day 2` | Nothing could fix this, so it just showed | One lesson per step, no day headings |
| Em dashes in every string | Nothing yet, and that is the point | Removed from the seed |

The argument against display-time fixes is not that they are slow. It is that
they have to be remembered at every place the text is displayed, and the place
that gets forgotten is the one nobody looks at. `numberReference` was applied
on the step page and in the session reveal, and would have needed applying
again anywhere else an answer appeared.

`repository.test.ts` asserts both properties against the database, so the
question is settled where the data is rather than where it is drawn.

## 2. The extraction cut in the wrong place, and published the answers · ~10 min

The lessons and the questions come from the same source files. Each file
teaches a topic and then ends with its drill questions *and their answers*,
which is where `reference_md` came from. Extracting a lesson means cutting each
file before that section, and the cut is the whole security boundary:
everything above it is public teaching material, everything below it is the
answer key the reveal rule exists to withhold.

The first pattern anchored the phrase to the start of a heading:

```js
/^#{1,3}\s*\**\s*(high-value interview questions|interview questions)/i
```

That matches the overview files, headed `# **High-Value Interview Questions to
Drill**`. It does not match the day files, headed `## Part 6 — The Interview
Questions, Answered`. Three topics' worth of answers went into a table served
on a route with no authentication.

Nothing about it was visible in review. The migration applied, the tests
passed, the pages rendered, and the leaked text sat below the fold of a long
lesson. What found it was asking the database a question nobody had asked:
does any slice of any answer appear in the lesson for its topic?

That question is now a test, and since a lesson and its answers are the same
row it is tighter than it was. Six slices from each of the 27 answers are
looked for in the lesson that teaches it. Slices containing `;{}()=` are
excluded, because the notes legitimately teach the code snippet they later
reference: the producer and consumer `pthread_cond_wait` example is in both,
correctly.

Put the old pattern back and the test names the topics that leak.

## 3. A lesson belongs to a step, not to a topic · ~5 min

The first version keyed lessons by topic, which gave nine rows and a 33KB
Operating Systems page covering all three question sets at once. Keying them by
step gives 27, each holding exactly the material for the questions beside it.

Five topics have one source file per step already, so they map straight across.
Four are a single file that the bank had itself split three ways, and their
sections line up with those three: Security's concepts 1 and 2 are
"Authentication, Authorization & Password Storage", 3 and 4 are "Sessions,
Tokens & HTTPS", 5 and 6 are "Common Attacks & Safe Defaults".

AI Tooling is the one that does not divide at a heading. Its glossary covers
both step 1 and step 2 in one list, so that split is by term: Prompt, Context,
Token and Context window go to step 1, RAG, Agent, Orchestration and
fine-tuning to step 2, Hallucination to step 3 with Responsible AI.

`step` and `difficulty` are separate columns holding the same information by
construction, and that is deliberate. They answer different questions: one is
"what do I read next", the other is "who can I be matched with". Collapsing
them would mean the reading order could not change without changing who gets
paired with whom.

## 4. Prerequisites are content, not layout · ~5 min

`depends_on`, `grid_x` and `grid_y` are seeded. The browser could have run a
layout algorithm over the dependency graph instead, and that would have been a
worse answer: where a topic sits is a claim about what to read first, which is
a judgement about the material and not something a spring simulation should be
deciding.

The one property worth enforcing is that the map flows downward, so a
prerequisite is always above what depends on it. A test checks it, because
seeded coordinates make it something a typo can break, and an arrow pointing
upward reads as a cycle.

The order, and why:

- **Operating Systems** and **Object-Oriented Programming** start it. Neither
  needs anything first and nearly everything else leans on one of them.
- **Networking**, **Databases** and **Debugging** follow. Indexes and
  transactions make far more sense after the memory and disk material.
- **Security** comes after Networking and Databases, because most of it is
  those two seen from the attacker's side.
- **System Design** is last, being mostly the earlier topics applied at scale.
- **AI Tooling** and **Behavioural** depend on nothing, so they sit apart
  rather than being given an invented prerequisite to justify a position.

---

# Read the code in this order

| File | Why |
|---|---|
| `packages/db/migrations/009_roadmap.sql` | The topics, their prerequisites and positions, and 27 lessons. |
| `services/questions/src/repository.ts` | `getRoadmap` and `getStep`: one query per screen. |
| `services/questions/src/index.ts` | The two routes, and which one is cached. |
| `services/gateway/src/index.ts` | `ROUTES`: three prefixes reach Questions, one per screen. |
| `frontend/src/pages/Roadmap.tsx` | Pan, zoom and the edge curves. |
| `frontend/src/pages/Step.tsx` | Questions, then lesson, then the answer. |
| `frontend/src/styles.css` | The tokens both themes are built from. |
| `services/questions/src/repository.test.ts` | The guards for all of the above. |

---

# Part 1 — One query per screen

`getRoadmap` returns nine topics each carrying its three steps, and `getStep`
returns one step with its lesson, its questions and its sibling steps. Each is
a single request because each is a single screen, and both use a lateral
subquery rather than a join plus grouping in JavaScript.

The roadmap is one call rather than nine for a reason beyond convenience: the
screen draws arrows between topics, so a partly loaded roadmap is a wrong
roadmap rather than a short one. There is nothing sensible to render from half
the graph.

The roadmap is cached for 60 seconds and a step is not. The lesson bodies are
around 400KB together and each is read once per visit, so caching them would
trade a primary key lookup for holding the whole corpus in Redis.

---

# Part 2 — Pan and zoom without a library

Nodes never move. The whole interaction is one `translate` and one `scale`
applied to a single SVG group, which is why there is no graph library here: a
node editor solves a problem this screen does not have, at the cost of a
dependency and a large API to review.

The one part worth reading is the zoom. Scaling towards the origin makes the
map slide away as it grows, which feels like the zoom is fighting you. Scaling
towards the pointer keeps whatever is under the cursor under the cursor, and
the correction is three lines:

```js
const ratio = scale / v.scale;
x: pointer.x - (pointer.x - v.x) * ratio,
y: pointer.y - (pointer.y - v.y) * ratio,
```

Edges leave the bottom of one box and arrive at the top of another rather than
running centre to centre, which would draw the line through the boxes
themselves. Control points sit directly above and below those ends, so every
arrow reads as travelling downward even when two topics are far apart sideways.

---

# Part 3 — Themes as tokens

Every colour is a custom property defined once on `:root` and redefined once
under `[data-theme='dark']`. No component names a colour, so a theme is a list
of variables rather than a second copy of the stylesheet, and there is no rule
that can be updated for one theme and forgotten for the other.

An explicit choice is stored and wins. With no choice made the system setting
is followed and *keeps* being followed, which is what makes the app go dark at
sunset along with everything else on the machine. `localStorage` is wrapped in
a try/catch because private browsing can refuse it outright, and losing the
preference between visits is a smaller problem than the page failing to render.

---

# Part 4 — What this phase deliberately did not build

- **No progress tracking.** There is no completed state and nothing to store it
  in. It needs a table, a route, and an opinion about what finishing means.
- **No deep links.** The app is still a `useState` switch, so a step has no URL
  of its own and cannot be shared or bookmarked. This is the first change that
  makes a router worth its weight, and the first thing to add if the app grows.
- **No search.** Nine topics fit on one screen.
- **No history of your own past sessions.** The data exists in
  `matching.sessions` and `collab.snapshots`, but nothing reads it back, and a
  page for it needs an endpoint on each of two services because neither role
  may read the other's schema.

---

# Part 5 — Demonstrating the claims

## Claim 1 — no answer text sits in a lesson

```bash
pnpm --filter @deepcs/questions test -t "keeps the answers out of the lessons"
```

Then break it deliberately: anchor the `DRILLS` pattern used to build
`009_roadmap.sql` at the start of a heading, re-seed, and the same test names
the topics that leak.

## Claim 2 — the map flows downward and every arrow lands somewhere

```bash
pnpm --filter @deepcs/questions test -t "points every arrow downward"
pnpm --filter @deepcs/questions test -t "gives every topic three steps"
```

## Claim 3 — the content is fixed in the database, not in the browser

```bash
pnpm --filter @deepcs/questions test -t "holds no em dashes"

docker compose exec postgres psql -U deepcs -d deepcs -At \
  -c "SELECT left(reference_md, 25) FROM questions.bank WHERE title = 'Processes & Threads';"
# ### 1. Process vs thread?
```

The numbering is in the stored text. Nothing in `frontend/` rewrites it, and
`grep -r numberReference frontend/` finds nothing, because the module that did
was deleted rather than left unused.

## Claim 4 — the two routes are shaped as documented

```bash
curl -s http://localhost:8080/roadmap | head -c 90
# {"topics":[{"topic":"os","title":"Operating Systems", …

curl -s "http://localhost:8080/steps/$STEP_ID" | python3 -c \
  'import json,sys; d=json.load(sys.stdin); print(d["topicTitle"], "step", d["step"], "|", len(d["parts"]), "questions |", len(d["lessonMd"]), "bytes |", "referenceMd" in d)'
# Operating Systems step 1 | 6 questions | 10416 bytes | False

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/steps/not-a-uuid
# 400
```

The `False` is the point: a step is public and carries no answer. The answer
has its own route, which checks who is asking.
