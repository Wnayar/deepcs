# Questions

Owns the teaching material and the answer keys: ten topics with their positions
on the roadmap, thirty question sets, the lesson that prepares you for
each, and the `reference_md` behind each. It is the only read-heavy service here,
the only one with a cache, and the only one holding anything worth withholding.

There is **no write path**. Question authoring is out of scope for the whole
project, so the bank is seeded by migration and nothing serves a route that
writes a row.

Code: [`services/questions/src/`](../../services/questions/src/) —
`repository.ts`, `cache.ts`, `index.ts`.

---

## 1. The shape of the data

[`004_questions_bank.sql`](../../packages/db/migrations/004_questions_bank.sql) ·
[`009_roadmap.sql`](../../packages/db/migrations/009_roadmap.sql)

```sql
questions.topics                        questions.bank
  topic       text PK                     id            uuid PK
  title       text                        title         text
  summary     text                        difficulty    easy | medium | hard
  depends_on  text[]                      parts         jsonb
  grid_x      int                         reference_md  text
  grid_y      int                         lesson_md     text
                                          step          int
                                          tags          text[]  -- GIN indexed
```

**No `topic` column on a question.** Filtering is entirely through `tags`, and a
question's topic is just its first, most general tag — `os`, `networking`,
`databases`, `oop`, `design-patterns`, `system-design`, `security`, `debugging`,
`ai-tooling`, `behavioural`. One mechanism instead of two overlapping ones. `tags[1] = t.topic`
is how the two tables join.

**`parts` is `jsonb`, not `text[]`.** Each entry is a short prompt string, and
Collab seeds one numbered line per entry in array order
([`05-collab.md`](05-collab.md) §3). `jsonb` round-trips as a plain JS array
through `pg`'s driver with no extra parsing.

**`step` and `difficulty` hold the same information by construction, and are
separate columns anyway.** They answer different questions: one is "what do I
read next", the other is "who can I be matched with". Collapsing them would mean
the reading order could not change without changing who gets paired with whom.

**`depends_on` is a recommendation, not a dependency graph.** Nothing is locked
and nothing is checked; a line on the roadmap says "this is the order I would
read them in". The name is slightly stronger than what the column means, and the
screen is careful not to repeat the overstatement.

The positions are seeded rather than computed in the browser. A layout algorithm
over the graph would have been the obvious move and the wrong one: where a topic
sits is a claim about what to read first, which is a judgement about the
material, not something a spring simulation should decide.

```
                        Operating Systems
                       /                 \
              Networking          Object-Oriented Programming
              /         \                        |
      Databases      Security                Debugging
              \          |                   /
                    System Design
                   /             \
            AI Tooling        Behavioural
```

Operating Systems is the root because nearly everything below leans on knowing
what a process, a thread and memory are. It splits into a machine side and a code
side, widens to three, and converges on System Design, which is mostly everything
above it applied at scale. AI Tooling and Behavioural close it out, and that
placement is honest about something: neither actually requires anything above it.
They are last because they are the two you can pick up whenever you like, not
because they are hard.

The one property worth enforcing is that every arrow points downward, so a topic
always sits below whatever precedes it. A test checks it, because seeded
coordinates make it something a typo can break and an upward line reads as a
cycle.

---

## 2. The column list is the whole guarantee

```ts
const SUMMARY_COLUMNS = 'id, title, difficulty, parts, tags, created_at';
```

Every query on the public read path selects exactly this list. `reference_md` is
not filtered out after the fact — it is **never fetched from Postgres in the
first place**, so there is no row shape a route handler could accidentally
forward it from.

**The failure this prevents:** the answer key sits in the same table row as the
public fields. Some future endpoint does `SELECT *` for a quick feature, ships
it, and every visitor can read the answer to a question meant to be worked
through with a partner first. The safe way to keep a column off the wire is not
to remember to strip it in the handler; it is never to select it.

`getReferenceMd` is the only function in this service that touches the column,
and it has exactly two callers, both in §4.

---

## 3. Reading the bank

**Cursor pagination, not `OFFSET`.** `WHERE id > $last ORDER BY id LIMIT n`.
Postgres jumps straight to the cursor through the primary-key index and reads
nothing it then discards — and because the cursor is a *value* rather than a
position, rows shifting elsewhere in the table cannot change what "the next 20"
means. `OFFSET 40 LIMIT 20` re-reads and throws away forty rows every time, and
silently skips or repeats a row if the bank changes mid-pagination.

`LIMIT` asks for one row more than requested. If the extra row shows up, its id
becomes `nextCursor` and it is trimmed from the page: no separate `COUNT`, no
"is there a next page" flag to keep in sync by hand.

**Search covers titles or an exact tag**, and the second half is the part worth
knowing. Searching titles alone made the finer tags (`fork`, `deadlock`, `mvcc`)
dead weight: carried on every row, indexed, and matched by nothing, since the
only tag anything ever filtered on was the topic. Now typing "deadlock" finds the
synchronisation lesson whose title never says it.

Tags match a whole element rather than a substring, with `@>`. That is both the
right meaning — they are lowercase single words — and the only form the GIN index
can serve. The equivalent `$1 = ANY (tags)` reads more naturally and has no index
path at all; `EXPLAIN` picks a sequential scan even with `seqscan` priced
absurdly high.

**`ILIKE` rather than a full-text index**, because the bank is 27 rows. A
`tsvector` GIN index is the right answer at scale and solves a problem this
dataset does not have. Worth revisiting if the bank ever grows past a few
hundred.

**One query per screen.** `getRoadmap` returns ten topics each carrying its
three steps; `getStep` returns one step with its lesson, its questions and its
siblings. Both use a lateral subquery rather than a join plus grouping in
JavaScript. The roadmap is one call rather than nine for a reason beyond
convenience: the screen draws arrows between topics, so a partly loaded roadmap
is a *wrong* roadmap rather than a short one, and there is nothing sensible to
render from half a graph.

---

## 4. Three routes touch the answer, and they are not the same route

| Route | Caller | Check |
|---|---|---|
| `GET /steps/:id` | anyone | none — public, and carries **no** `reference_md` |
| `GET /questions/:id/reference` | a signed-in browser | `X-User-Id` present |
| `GET /internal/questions/:id/reference` | Matching | not routable from outside |

The third is the reveal rule's half of this service
([`../adr/06-answers-never-enter-the-shared-doc.md`](../adr/06-answers-never-enter-the-shared-doc.md)):
Questions holds the answer and has no idea who is in a session; Matching knows
exactly who consented and never stores the answer. Neither can release it alone.

**The `/internal` prefix is the access control.** The natural name would be
`GET /questions/:id/reference`, and the Gateway proxies the `/questions` prefix
wholesale with no filtering on what follows, so that route would have been
readable by anyone with a browser. Nothing proxies `/internal`, so this one is
reachable from inside the network and nowhere else. When a proxy forwards a
prefix rather than a route list, the URL is a security decision.

**The second route is a deliberate narrowing of what the reveal rule claims.**
Being signed in is the whole check, because secrecy is not what it can be about:
the lesson for a question teaches the same material and is public. What mutual
consent still buys is coordination *inside a session* — the answer does not
appear on a shared screen until both people say they are done attempting it.
Whether you look something up on your own is your business. Anonymous callers get
nothing, so the bank stays browsable signed out without the answer key coming
with it.

Neither answer route is cached. Putting answer text into a shared Redis key is a
second copy of the thing this service works hardest not to hand out.

---

## 5. The cache, and why it needs none of the rate limiter's rigour

[`cache.ts`](../../services/questions/src/cache.ts) is a read-through cache,
and the whole point is what happens when it fails:

```ts
try { const hit = await redis.get(key); if (hit !== null) return { value: JSON.parse(hit), hit: true }; }
catch { /* fall through to Postgres */ }
const value = await compute();
try { await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds); } catch { /* best-effort */ }
```

The contrast worth having ready: the Gateway's rate limiter needs a Lua script
because *correctness* depends on atomicity, and two instances racing one bucket
is a real bug. This needs nothing like that. The bank is read-heavy and
essentially never written, so a stale or missing entry costs one extra trip to
Postgres, not a wrong answer. A Redis outage degrades this endpoint to "no
cache", not "broken", which is also why Redis is reported by `/health/deps` but
is **not** part of readiness here.

Ask what happens on a miss — one extra query here, an unenforced limit there —
and match the mechanism to the cost of being wrong.

**What is cached and what is not.** `GET /questions` and `GET /roadmap`, both for
60 seconds. `GET /steps/:id` is not: the lesson bodies are around 400KB together
and each is read once per visit, so caching them would trade a primary-key lookup
for holding the whole corpus in Redis. `GET /questions/:id` is a single indexed
lookup and cheap enough not to bother.

The cache key for a list is the filter set, so two requests with the same
tags/difficulty/search/cursor/limit hit the same key. `X-Cache: HIT|MISS` is set
on every cached response, which is what makes a cache hit observable rather than
merely faster.

**One consequence to remember when editing a seed:** the roadmap is cached for a
minute, so re-running a migration and immediately curling the API shows the old
content. `redis-cli DEL questions:roadmap`, or wait.

---

## 6. Where the content comes from

The material is adapted from a personal CS-fundamentals study repo, which comes in
two shapes. Five topics (OS, Networking, Databases, OOP, System Design) are
three-day curricula, one source file per step. Four more (Security, Debugging, AI
Tooling, Behavioural) are single overview files, split three ways along seams the
notes already have.

**Design Patterns is the exception, and was written here rather than adapted**
([`012_design_patterns.sql`](../../packages/db/migrations/012_design_patterns.sql)).
It started inside OOP, where lesson 2 was SOLID *plus* the creational and
structural patterns and lesson 3 was the behavioural ones *plus* composition over
inheritance. Two subjects sharing a lesson meant neither had room, and the
roadmap could not show that patterns were a thing you had finished. Splitting it
out left OOP with three coherent lessons (the pillars, SOLID, composition) and
gave the catalogue its own topic, in Python, with worked examples rather than
shape-and-animal ones. Its snippets are Python where OOP's are Java, which is the
one place the language mix is a choice rather than the subject's own language.

Both shapes end the same way: a section pairing question headers with
full-paragraph answers. That maps directly onto the row shape — **the questions
become `parts[]`, the answers become `reference_md`**, and everything above the
cut becomes `lesson_md`. Thirty rows across ten topics.

**`difficulty` is a row's position within its own topic, not an absolute
rating** — first easy, second medium, third hard. The notes are a curriculum
where the later material assumes the earlier, so that is what the source encodes,
and it reads correctly to someone working through one topic. It does mean the
labels are not comparable *across* topics: databases' "hard" (NoSQL and CAP) is
not claimed to be harder than its own "medium" (transactions and MVCC) in any
absolute sense, only later in the sequence.

The reason it matters is downstream. Matching pairs on topic **and** difficulty
and refuses the match when nothing fits, so a combination with no question behind
it is a pair of users who can never be matched — a dead end they meet only after
choosing. Ten topics × three lands exactly on the grid, one question per cell,
and
[`clients.test.ts`](../../services/matching/src/clients.test.ts) walks all
thirty combinations, because the failure is invisible until a user picks
the one that is not there. An earlier ad-hoc assignment of difficulties left five
cells empty.

**Behavioural is shaped differently, on purpose.** The other nine topics have a
reference answer because the source notes have one. Behavioural is a *story
scaffold*: the answers are the author's own experiences and the slots are
deliberately blank, so there is nothing to import and inventing one would be
exactly what those notes warn against. Its `parts[]` are real questions to expect
and its `reference_md` describes what a strong answer has to contain rather than
supplying one. Two people take turns answering and the reference is the rubric
they check each other against, which works for the product and is a different
contract from the rest of the bank.

---

## 7. The extraction cut, which is a security boundary

The lessons and the answers come out of the same source files, so extracting a
lesson means cutting each file before its drill section. **The cut is the whole
boundary**: everything above it is public teaching material, everything below it
is the answer key the reveal rule exists to withhold.

The first pattern anchored the phrase to the start of a heading:

```js
/^#{1,3}\s*\**\s*(high-value interview questions|interview questions)/i
```

That matches the overview files, headed `# **High-Value Interview Questions to
Drill**`. It does not match the day files, headed `## Part 6 — The Interview
Questions, Answered`. Three topics' worth of answers went into a table served on
a route with no authentication.

**Nothing about it was visible in review.** The migration applied, the tests
passed, the pages rendered, and the leaked text sat below the fold of a long
lesson. What found it was asking the database a question nobody had asked: *does
any slice of any answer appear in the lesson for its topic?*

That question is now a test in
[`repository.test.ts`](../../services/questions/src/repository.test.ts). Six
slices from each of the 27 answers are looked for in the lesson that teaches it.
Slices containing `;{}()=` are excluded, because the notes legitimately teach the
code snippet they later reference: the producer and consumer `pthread_cond_wait`
example is in both, correctly. Put the old pattern back and the test names the
topics that leak.

---

## 8. Content is fixed at the source, never at render time

Three things were being corrected in the browser and all three are now stored
correctly instead:

| Was stored | Was corrected in the browser | Now stored as |
|---|---|---|
| `## Process vs thread?` | a function rewrote headings to `1.` on every render | `### 1. Process vs thread?` |
| one lesson per topic, headed `Day 1`, `Day 2` | nothing could fix it, so it showed | one lesson per step, no day headings |
| em dashes in every string | nothing, and that is the point | removed from the seed |

The argument against display-time fixes is not that they are slow. It is that
they have to be remembered at **every** place the text is displayed, and the place
that gets forgotten is the one nobody looks at. The heading rewrite was applied on
the step page and in the session reveal, and would have needed applying again
anywhere else an answer appeared.

Both properties are asserted against the database rather than against a
component, so the question is settled where the data is. The module that did the
rewriting was deleted rather than left unused, so `grep -r numberReference
frontend/` finds nothing.

Editing an already-applied seed does nothing until its row is deleted from
`public.schema_migrations` — the recipe is in [`08-data.md`](08-data.md) §4.
