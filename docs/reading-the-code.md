# Reading the code

Everything you need to read every line of this repo without guessing. Written
after a session where the syntax — not the architecture — was the thing in the
way.

**The goal is bounded on purpose.** Not "learn JavaScript". The goal is that
[`packages/shared/src/service.ts`](../packages/shared/src/service.ts) and
[`services/stats/src/index.ts`](../services/stats/src/index.ts) read as ordinary
English by the end. Those two files use nearly every construct the rest of the
repo uses, so clearing them clears the repo.

Part 5 is a line-by-line walk of both. Parts 1–4 are what you need first. Part 6
covers the tests. Part 7 is a preview of what phases 1+ will put in front of you,
so nothing arrives cold.

**How to read it.** Every part opens with a paragraph on what the layer is *for*
before any syntax. Skim Parts 1–4, work through Part 5 with the real files open,
and come back to whatever stopped you.

---

## What is actually confusing you

A count of the foreign-looking things in `service.ts`:

**Fastify** — 6 calls. `Fastify()`, `app.get`, `app.addHook`, `app.listen`,
`app.close`, `app.log`. That's the entire framework surface in this repo.

**TypeScript** — every `: Type`, every `interface`, every `as`, every `<>`.
Roughly half the characters that look strange.

**Modern JavaScript** — `async`/`await`, arrow functions, destructuring, `??`,
`import`/`export`.

So the framework is the small part. Parts 1 and 2 are where the payoff is.

---

# Part 1 — Modern JavaScript

**The big picture.** JavaScript is the only thing that actually runs. TypeScript
is deleted before execution, Fastify is a library written in it, Node is the
program that hosts it. So every strange character in this repo is one of three
things: JavaScript, a type annotation on top of JavaScript, or a library call.

This part is the first. It's about ten constructs, and they make up most lines
you will ever read here.

## `const` and `let`

```js
const app = Fastify({ ... });   // cannot be reassigned
let count = 0;                   // can be reassigned
```

`const` stops **reassignment**, not modification. This is legal:

```js
const config = { port: 8080 };
config.port = 9090;      // fine — the object changed, not what config points at
config = { port: 9090 }; // error — reassigning config itself
```

Default to `const`. Use `let` only when you genuinely reassign. `var` is the old
one; treat seeing it as a sign you're reading old code.

## Arrow functions

Two ways to write a function. These are the same:

```js
function double(x) { return x * 2; }
const double = (x) => { return x * 2; };
const double = (x) => x * 2;        // one expression: return is implicit
```

The third form is why arrows are everywhere. From
[`services.ts`](../packages/shared/src/services.ts):

```ts
level: (label) => ({ severity: label.toUpperCase() })
```

Note the parentheses around `{ severity: ... }`. Without them, JavaScript reads
`{` as the start of a function body, not an object. **Returning an object from a
short arrow always needs the wrapping parens.** Forget them and you get a
function that silently returns `undefined`.

## Destructuring

Pulling fields out of an object by name.

```js
const options = { name: 'gateway', port: 8080 };

const name = options.name;    // the long way
const port = options.port;

const { name, port } = options;   // destructuring — same result
```

It works in **function parameters**, which is where you'll meet it here:

```ts
export function createService({ name, port }: ServiceOptions) {
```

The caller passes one object; the function immediately splits it into two
variables. From [`gateway/src/index.ts`](../services/gateway/src/index.ts):

```ts
createService({ name: 'gateway', port: SERVICES.gateway.port })
```

One object in. Inside `createService`, `name` is `'gateway'` and `port` is
`8080`.

It also works on the way **out**:

```ts
const { app, start } = createService({ ... });
```

`createService` returns `{ app: ..., start: ... }`, and this line takes both.

## Shorthand object properties

When a key and the variable have the same name, write it once:

```js
const app = Fastify({ ... });
const start = async () => { ... };

return { app: app, start: start };   // explicit
return { app, start };               // shorthand — identical
```

The last line of `createService` is the shorthand form. It is not special
syntax; it is the same object.

## `??` — nullish coalescing

"Use the left side, unless it's `null` or `undefined`."

```ts
process.env.LOG_LEVEL ?? 'info'
```

If the environment variable isn't set, use `'info'`.

**Why not `||`.** `||` falls back on *any* falsy value, which includes `0`, `''`
and `false`. That's a real bug source:

```js
const port = userPort || 8080;    // userPort = 0 -> 8080. Wrong: 0 was meant.
const port = userPort ?? 8080;    // userPort = 0 -> 0.    Right.
```

`??` only triggers on null/undefined. Prefer it unless you actually want the
falsy behaviour.

Related: `?.` (optional chaining) stops instead of throwing when something is
missing.

```js
config.db.host        // throws if config.db is undefined
config.db?.host       // gives undefined instead
```

## Template literals — backtick strings

```js
`service ${name} listening on ${port}`
```

Backticks instead of quotes, and `${...}` drops a value in. They also span
multiple lines without `\n`. Use them whenever you'd otherwise write `'a' + b +
'c'`.

## The ternary — `cond ? a : b`

An `if`/`else` that produces a value instead of running statements.

```ts
const listenPort = process.env.PORT ? Number(process.env.PORT) : port;
```

Read as: if `PORT` is set, use `Number(PORT)`, otherwise use `port`.

The long form is four lines and needs `let`:

```ts
let listenPort;
if (process.env.PORT) { listenPort = Number(process.env.PORT); }
else { listenPort = port; }
```

Fine to nest one level. Past that, use `if`.

## Array methods — `map`, `filter`, `reduce`

Three functions that replace almost every loop you'd write. Each takes a
function and applies it to every element. **None of them modify the original
array** — they return a new one.

```js
const ports = [8080, 8081, 8082];

ports.map((p) => p + 1000);        // [9080, 9081, 9082]  — transform each
ports.filter((p) => p > 8080);     // [8081, 8082]        — keep some
ports.reduce((sum, p) => sum + p, 0);  // 24243           — collapse to one value
```

`reduce` is the one that takes a moment. Two arguments: a function
`(accumulated, current) => newAccumulated`, and a starting value. It runs once
per element, carrying the result forward.

Also common:

```js
ports.find((p) => p > 8080);        // 8081  — first match, or undefined
ports.some((p) => p > 8081);        // true  — does any match?
ports.every((p) => p > 8000);       // true  — do all match?
ports.includes(8080);               // true
```

Chain them: `list.filter(...).map(...)` reads left to right in execution order.

## `try` / `catch`

Run code that might throw, and handle it if it does.

```ts
try {
  await app.listen({ port: 8080, host: '0.0.0.0' });
} catch (err: unknown) {
  app.log.error({ err }, 'failed to start');
  process.exit(1);
}
```

`await` on a Promise that rejects **throws**, so `try`/`catch` is how you handle
async failure. `finally` runs either way — use it for cleanup that must happen
whether or not things worked.

**Failure mode:** an `async` function that throws with nobody catching it
produces an *unhandled rejection*. Node logs it and, by default, kills the
process. That's why the Stats job passes a second function to `.then` — it's the
same protection in different syntax.

## Spread and rest — `...`

The same three dots do two jobs, distinguished by position.

**Spread** — unpack into a new thing:

```js
const base = { level: 'info' };
const full = { ...base, service: 'gateway' };   // { level: 'info', service: 'gateway' }
```

Later keys win, so `{ ...base, level: 'debug' }` overrides.

**Rest** — collect the leftovers:

```js
const { name, ...others } = { name: 'a', port: 1, host: 'b' };
// name = 'a', others = { port: 1, host: 'b' }
```

## `async` / `await` and Promises

A **Promise** is a value that isn't ready yet. Anything involving the network,
the disk, or a timer returns one.

```js
const p = app.listen({ port: 8080 });   // a Promise, not a result
```

`await` waits for it and unwraps it:

```js
await app.listen({ port: 8080 });   // pauses here until the server is listening
```

**The rule:** `await` is only legal inside a function marked `async`, or at the
top level of an ES module (which is why
[`gateway/src/index.ts:8`](../services/gateway/src/index.ts#L8) can just say
`await start();`).

**An `async` function always returns a Promise**, even if the body returns a
plain value:

```js
async function f() { return 1; }
f();          // Promise that resolves to 1 — NOT 1
await f();    // 1
```

**Failure mode to recognise:** forgetting `await` doesn't error. It gives you a
Promise object where you expected data, and the symptom shows up later as
`undefined` or `[object Promise]`.

### `.then()` — the older form

Before `await`, you chained:

```js
app.close().then(onSuccess, onFailure);
```

`.then()` takes up to two functions: the first runs if it succeeded, the second
if it threw. [`stats/src/index.ts`](../services/stats/src/index.ts) uses exactly
this two-argument form:

```ts
run().then(
  () => process.exit(0),
  (err: unknown) => { log.error({ err }, 'stats job failed'); process.exit(1); },
);
```

Read it as: run the job; exit 0 if it worked, log and exit 1 if it didn't.

**Why not `await` there.** `await` at the top level would work, but you'd then
need a `try`/`catch` around it to set the exit code. The two-argument `.then` is
the same thing in fewer lines, and the exit code is this file's entire contract.

## Modules — `import` and `export`

**Named exports** — any number per file, imported by exact name:

```ts
export function createService(...) { }
export interface ServiceOptions { }

import { createService } from '@deepcs/shared/service';
```

**Default export** — at most one per file, and you pick the name:

```ts
import Fastify from 'fastify';        // 'Fastify' is your choice
import F from 'fastify';              // also legal, same thing
```

**Both at once** — the default first, then the named ones in braces:

```ts
import Fastify, { LogController, type FastifyInstance } from 'fastify';
```

That's one default (`Fastify`) plus two named imports.

**Renaming:**

```ts
import { createService as makeService } from '@deepcs/shared/service';
```

### `node:` prefixed imports

```ts
import { randomUUID } from 'node:crypto';
```

The `node:` prefix means "this is Node's own built-in module, not a package from
npm". Without the prefix it still works, but if someone ever publishes a package
literally called `crypto`, the plain form becomes ambiguous. The prefix is
unambiguous, and it's the current convention.

### ESM vs CommonJS

Two module systems exist. You'll see both.

```js
import x from 'y';        // ESM  — the modern one. This repo uses it.
const x = require('y');   // CommonJS — the old one. Fastify is built this way.
```

`"type": "module"` in a `package.json` is what declares ESM. Every
`package.json` in this repo has it.

**Why it matters to you:** the comment at
[`service.ts:5-12`](../packages/shared/src/service.ts#L5) turns on this. A
bundler can strip unused code out of ESM (**tree-shaking**) because the imports
are fixed and readable ahead of time. It can't safely do that with CommonJS,
because `require()` can be called with a computed string at runtime. That's the
whole reason `@deepcs/shared` has three separate entry points instead of one.

---

# Part 2 — TypeScript

**The big picture.** TypeScript is a checker that runs *before* your program and
then deletes itself. It never executes. Its entire value is turning a class of
runtime crash into a build error you see while typing.

That framing explains everything in this part. Annotations exist so the checker
knows what you meant. `as` exists to switch the checker off for one expression.
`import type` exists because the checker's output has to be valid JavaScript.
And every strictness flag in `tsconfig.base.json` is a decision about how much
you want it to nag you.

It also explains the limit: data arriving from the network at runtime is
unchecked, because the checker finished before the program started. Validating
that is separate work — Part 7.

## What it is

JavaScript plus type annotations. The annotations are checked at build time and
then **deleted**. The JavaScript that runs has no types in it at all.

```ts
const port: number = 8080;   // what you write
const port = 8080;           // what runs
```

Consequence: types cannot check anything at runtime. If JSON arrives from the
network shaped wrong, TypeScript will not catch it — it already finished its job
before the program started. Validating input is separate work (phase 1 does it).

## Annotating things

```ts
const port: number = 8080;
function f(name: string): boolean { ... }        // param types, return type
const start = async (): Promise<void> => { ... }; // async always returns Promise
```

`void` means "returns nothing useful". `Promise<void>` means "an async function
that resolves with nothing".

You usually don't need annotations on variables — TypeScript infers them.
`const port = 8080` is already `number`. Annotate **function parameters and
return types**; let the rest infer.

## `interface`

A named shape.

```ts
export interface ServiceOptions {
  name: ServiceName;
  port: number;
}
```

Now `ServiceOptions` can be used anywhere a type goes:

```ts
export function createService({ name, port }: ServiceOptions)
```

Read that as: this function takes one object, that object must have `name` and
`port`, and immediately split it into two variables.

`type` does nearly the same job (`type ServiceOptions = { ... }`). Rule of thumb
in this repo: `interface` for object shapes, `type` for everything else
(unions, aliases, computed types).

## Function types

The return annotation on `createService`:

```ts
): {
  app: FastifyInstance;
  start: () => Promise<void>;
}
```

`start: () => Promise<void>` describes a **function**, not a value: takes no
arguments, returns a Promise of nothing. The `=>` here is type syntax, not an
arrow function.

So the caller knows `start` is callable, and `app` is a Fastify server.

## Generics — the `<>` brackets

A type that takes another type as a parameter.

```ts
Promise<void>      // a Promise that resolves with nothing
Promise<string>    // a Promise that resolves with a string
Array<number>      // same as number[]
Logger             // pino's type — no parameter needed
```

You will *use* generics constantly and rarely *write* one. Reading them is
enough for now: `X<Y>` means "an X containing/producing Y".

## Unions and `undefined`

```ts
type ServiceName = 'gateway' | 'users' | 'stats';   // one of exactly these
let x: string | undefined;                          // a string, or nothing
```

Your `tsconfig.base.json` sets `noUncheckedIndexedAccess: true`, which makes
this the default for array and object indexing:

```ts
const first = list[0];   // type is T | undefined, NOT T
```

**Why it's on:** `list[0]` on an empty array really is `undefined`. Without the
setting TypeScript lies to you and the crash happens at runtime. With it, you're
forced to handle the empty case. It will annoy you. It is catching a real bug
class.

## `as` — type assertions

```ts
req.headers['x-request-id'] as string
```

This says "trust me, it's a string." **TypeScript stops checking at that point.**
No conversion happens; nothing is validated. If it's actually `undefined`, you
now have `undefined` in a variable typed `string`.

Treat every `as` as a small debt. The one in `service.ts` is deliberate — HTTP
headers are typed `string | string[] | undefined`, and the `?? randomUUID()`
right after it handles the missing case. Read `as` and immediately look for what
covers the lie.

## `as const`

```ts
export const SERVICES = {
  gateway: { port: 8080 },
  ...
} as const;
```

Without `as const`, TypeScript widens: `port` becomes `number`, and the object
is mutable. With it, everything becomes **readonly** and **exact**: `port` is the
literal `8080`, and nothing can be reassigned.

That's what makes the next line work:

```ts
export type ServiceName = keyof typeof SERVICES;
```

Read it right to left:

- `SERVICES` — the value
- `typeof SERVICES` — its type
- `keyof ...` — the union of its keys

Result: `'gateway' | 'users' | 'questions' | 'matching' | 'collab' | 'stats'`.

**Why bother:** add a seventh service to `SERVICES` and `ServiceName` updates
itself. Typo a name anywhere in the repo and it fails to compile. The list of
services is written once.

Same trick in `service.ts:93`:

```ts
for (const signal of ['SIGTERM', 'SIGINT'] as const)
```

Without `as const` that array is `string[]`, and `process.once` — which wants
specific signal names — rejects it.

## `import type`

```ts
import type { ServiceName } from './services';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
```

Marks an import as **types only, delete it at build time**.

`FastifyInstance` is a type. `LogController` is a real class used at runtime.
Both come from `'fastify'`, so the `type` keyword marks which is which,
per-item.

**Why it's mandatory here.** `tsconfig.base.json` sets
`verbatimModuleSyntax: true`, which tells TypeScript to stop guessing what to
strip. Without the `type` keyword, the import survives into the output
JavaScript, and Node tries to load something at runtime that only ever existed
for the compiler. Your `eslint.config.js` enforces the same thing with
`@typescript-eslint/consistent-type-imports`.

## `unknown` vs `any`

```ts
(err: unknown) => { ... }
```

`unknown` means "I don't know what this is, and you must narrow it before using
it." `any` means "stop checking entirely."

Errors are `unknown` because JavaScript lets you `throw` literally anything — a
string, a number, an object. Prefer `unknown`. Reach for `any` only to unblock
yourself, and leave a comment when you do.

---

# Part 3 — Node

**The big picture.** Node is the program that runs JavaScript outside a browser.
It supplies everything the language itself has no concept of: files, network
sockets, environment variables, and the fact that an operating system can ask
your process to stop.

Your services touch four corners of it, and all four are about the boundary
between the process and whatever started it — reading config on the way in,
being told to shut down, and reporting success on the way out. That boundary is
exactly what Cloud Run interacts with, which is why these small things matter
more than they look.

## `process.env`

Environment variables, as strings, always:

```ts
const listenPort = process.env.PORT ? Number(process.env.PORT) : port;
```

Every value is a string or `undefined`. `Number(...)` is the conversion. Missing
variables are `undefined`, not an error — which is why `??` shows up so often
next to them.

## Signals

The operating system asks a process to stop by sending a **signal**.

```ts
process.once('SIGTERM', () => { ... });
```

- `SIGTERM` — "please stop." What Cloud Run and `docker stop` send. Catchable.
- `SIGINT` — what Ctrl-C sends. Catchable.
- `SIGKILL` — immediate termination. **Not** catchable; no code runs.

`process.once` rather than `process.on` because a handler that fires twice on a
double Ctrl-C would call `app.close()` twice. `once` removes itself after firing.

**Why this matters:** without a SIGTERM handler, a deploy kills the process
mid-request and whoever was mid-flight gets a dropped connection. The handler
lets in-flight work finish first — **graceful shutdown**.

## Exit codes

```ts
process.exit(0);   // success
process.exit(1);   // failure
```

`0` means success, anything else means failure. This is the contract every shell,
CI runner and container orchestrator reads. For the Stats job it's the *entire*
interface — Cloud Run Jobs decides whether to retry based on that number.

## `process.hrtime.bigint()`

A high-resolution timer in nanoseconds, used in
[`stats/src/index.ts`](../services/stats/src/index.ts):

```ts
const startedAt = process.hrtime.bigint();
const ms = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
```

`bigint` is a separate number type for integers too large for a normal
JavaScript number — that's why it needs `Number(...)` before dividing. The `_`
in `1_000_000` is a readability separator; JavaScript ignores it.

**Why not `Date.now()`:** `Date.now()` follows the wall clock, which can jump
backwards when the system syncs time. `hrtime` only ever moves forward. For
measuring a duration, that difference is the whole point.

---

# Part 4 — Fastify and pino

**The big picture.** A web server's job is: bytes arrive on a socket, become an
HTTP request, some function runs, and an HTTP response goes back. Fastify does
every part of that except the function — you supply the function, it does the
rest. pino does the same trick for logs: you supply the fields, it writes JSON.

Two things follow. First, the framework surface is tiny — six calls here, listed
below. Second, both are configured almost entirely by passing one options object
at construction, which is why `service.ts` looks like a big nested object with a
few lines of code around it. Reading that object *is* reading the setup.

## Fastify

The web framework. Six things, all of them in `service.ts`.

**Create a server:**

```ts
const app = Fastify({ ...options });
```

**Handle a route:**

```ts
app.get('/', async () => ({ service: 'gateway', phase: 0 }));
```

A path and a function. Return an object and Fastify serialises it to JSON and
sets the header. There is no `res.send()` in this style.

Note `async () => ({ ... })` — arrow returning an object, so the parens are
required.

**Run code on every request** (a **hook**):

```ts
app.addHook('onSend', async (req, reply) => {
  reply.header('x-request-id', req.id);
});
```

`onSend` fires just before the response goes out. Every response gets the header
without any route knowing about it.

**Start and stop:**

```ts
await app.listen({ port: 8080, host: '0.0.0.0' });
await app.close();
```

**Log:**

```ts
app.log.info({ signal }, 'shutting down');
```

Object first, message second. The object's fields become fields in the JSON log
line.

### `0.0.0.0` vs `localhost`

```ts
await app.listen({ port: listenPort, host: '0.0.0.0' });
```

`localhost` binds only the loopback interface — reachable from *inside* the
container and nowhere else. Docker forwarding port 8080 would hit nothing.
`0.0.0.0` binds every interface. This is a top-three cause of "the container is
running but I get connection refused."

## pino

The logger. Fastify uses it internally; the Stats job uses it directly because
it has no Fastify instance to borrow one from.

```ts
pino({
  level: process.env.LOG_LEVEL ?? 'info',
  messageKey: 'message',
  base: { service: name },
  formatters: { level: (label) => ({ severity: label.toUpperCase() }) },
});
```

- `level` — the minimum severity to emit. `debug` lines vanish at `info`.
- `messageKey` — pino defaults to `msg`; Google Cloud Logging reads `message`.
- `base` — fields stamped on **every** line from this logger.
- `formatters.level` — pino writes `level: 30`; Cloud Logging wants
  `severity: "INFO"`.

Those last three exist so that logs from six services land in one searchable
place with the same field names. A trace that changes key name halfway through
is not a trace.

---

# Part 5 — Read your own code

**The big picture.** Nothing new appears from here. This is Parts 1–4 applied to
two real files, in order, with the reasoning attached. If a line stops you, the
construct it uses is above.

Read `stats/src/index.ts` first — it's short and has no framework in it. Then
`service.ts`, which is the file every service is built from.

## `services/stats/src/index.ts`

```ts
import { createJobLogger } from '@deepcs/shared/logger';
```

Named import, from the `logger` door of `@deepcs/shared`. Deliberately **not**
the `service` door — that one loads Fastify, and this is a job.

```ts
const log = createJobLogger('stats');
```

`'stats'` is checked against `ServiceName`. Typo it and the build fails.

```ts
async function run(): Promise<void> {
```

Async, resolves with nothing.

```ts
const startedAt = process.hrtime.bigint();
log.info('stats job started');
const drained = 0;
const ms = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
log.info({ drained, duration_ms: ms }, 'stats job finished');
```

Monotonic timer, a placeholder for phase 7, then a log line. `{ drained, ... }`
is shorthand — the field is named `drained` because the variable is.

```ts
run().then(
  () => process.exit(0),
  (err: unknown) => { log.error({ err }, 'stats job failed'); process.exit(1); },
);
```

Call it, exit 0 on success, log and exit 1 on failure. The exit code is what
Cloud Run Jobs reads to decide whether the run succeeded.

## `packages/shared/src/service.ts`

```ts
import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import type { ServiceName } from './services';
```

Node built-in; default + two named (one of them type-only); a type-only import.

```ts
export interface ServiceOptions {
  name: ServiceName;
  port: number;
}
```

The shape callers must pass. `name` can only be one of the six.

```ts
class DeepcsLogController extends LogController {
  constructor() {
    super({ requestIdLogLabel: 'request_id' });
  }
}
```

A subclass. `extends` inherits everything from `LogController`; `constructor`
runs at creation; `super(...)` calls the parent's constructor with different
options. The only change is the label: Fastify writes `reqId`, everything else
in this system writes `request_id`.

```ts
export function createService({ name, port }: ServiceOptions): {
  app: FastifyInstance;
  start: () => Promise<void>;
} {
```

Destructured parameter, typed by the interface. Returns an object with a Fastify
server and a zero-argument async function.

```ts
  const app = Fastify({
    requestIdHeader: 'x-request-id',
    logController: new DeepcsLogController(),
    genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
```

`new` creates an instance of the class. `genReqId` is an arrow function Fastify
calls per request: take the incoming header if there is one, otherwise mint a
UUID. The `as string` is the assertion, and `??` is what covers it.

**Why:** a request crossing six services needs one id the whole way. Propagate if
present, mint if not.

```ts
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      messageKey: 'message',
      base: { service: name },
      formatters: { level: (label) => ({ severity: label.toUpperCase() }) },
    },
  });
```

The pino config from Part 4. `base: { service: name }` is why every line knows
which service wrote it.

```ts
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
```

Echo the id back on every response, so a browser or load test can correlate too.

```ts
  app.get('/health/live',  async () => ({ status: 'ok', service: name }));
  app.get('/health/ready', async () => ({ status: 'ok', service: name, checks: {} }));
```

Two routes, both returning objects.

**Why two.** *Live* answers "is this process wedged — restart it." *Ready*
answers "may traffic be routed here yet." A service still connecting to Postgres
is live but not ready. Merge them and the orchestrator kills a healthy process
that was merely still starting. At phase 0 there's nothing to check, so ready is
trivially true.

```ts
  const start = async (): Promise<void> => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => {
        app.log.info({ signal }, 'shutting down');
        app.close().then(
          () => process.exit(0),
          (err: unknown) => { app.log.error({ err }, 'error during shutdown'); process.exit(1); },
        );
      });
    }
```

`for...of` over a two-element array. `as const` makes the elements literal types
so `process.once` accepts them. Same two-argument `.then` as the Stats job.

**Why registered inside `start` and not next to `Fastify()`:** these are
*process*-wide handlers. A test that builds ten app instances would otherwise
leave ten SIGTERM listeners on one process.

```ts
    const listenPort = process.env.PORT ? Number(process.env.PORT) : port;
    await app.listen({ port: listenPort, host: '0.0.0.0' });
  };

  return { app, start };
}
```

Cloud Run injects `PORT` and expects the container to honour it; the value in
`SERVICES` is only the local default. Then bind all interfaces, and hand back
both pieces via shorthand.

---

# Part 6 — Tests

**The big picture.** A test here starts a real service **inside the test
process**, hands it a fake HTTP request, and checks the answer. No network, no
ports, no Docker. That's why `pnpm test` finishes in seconds and why CI can run
it without bringing anything up.

The whole vocabulary is four functions and a couple of matchers.

## The shape

From [`gateway/src/health.test.ts`](../services/gateway/src/health.test.ts):

```ts
import { describe, expect, it } from 'vitest';

describe('gateway service', () => {
  it('answers /health/live and /health/ready separately', async () => {
    // ... the test
  });
});
```

`describe(name, fn)` — a group. Purely for organising output.

`it(name, fn)` — one test. The name should read as a sentence: *it* answers
`/health/live` and `/health/ready` separately. Written well, a failure tells you
what broke without opening the file.

`expect(actual)` — starts a check. What follows is the **matcher**.

## Matchers

```ts
expect(res.statusCode).toBe(200);
expect(res.json()).toMatchObject({ status: 'ok', service: 'gateway' });
```

`toBe` — exact equality, for primitives (numbers, strings, booleans).

`toEqual` — deep equality for objects. `toBe` on two objects compares
*identity*, so `expect({a:1}).toBe({a:1})` **fails** — two different objects that
happen to look alike. This is the single most common early confusion.

`toMatchObject` — the object contains at least these fields. Extra fields are
allowed. That's the right choice here: the health response also carries
`checks`, and the test shouldn't break when a future phase adds another field.

Others you'll reach for: `toContain`, `toThrow`, `toBeDefined`, and `.not`
(`expect(x).not.toBe(1)`).

## `app.inject` — a request with no network

```ts
await app.ready();

const res = await app.inject({
  method: 'GET',
  url: '/health/live',
  headers: { 'x-request-id': 'trace-me-across-six-services' },
});
```

`app.ready()` waits for Fastify to finish registering routes and hooks. Skip it
and you can hit a route before it exists.

`app.inject(...)` builds a fake request and runs it through the **entire** real
stack — hooks, routing, serialisation — then returns the response object. It
never opens a socket.

**Why this matters more than it looks.** `app.listen` is never called, so no port
is bound. Six services' tests can run in parallel, in CI, with nothing else
running. The alternative — start a server, pick a free port, make an HTTP
request, tear it down — is slower and flaky.

`res` gives you `res.statusCode`, `res.headers`, `res.body` (raw string), and
`res.json()` (parsed).

## The rest of that test

```ts
const { app } = createService({ name: 'gateway', port: SERVICES.gateway.port });
```

Destructuring again — the test wants `app` and ignores `start`, because it never
starts a real server.

```ts
for (const url of ['/health/live', '/health/ready']) {
  const res = await app.inject({ method: 'GET', url });
  expect(res.statusCode).toBe(200);
}
```

One loop, two routes, same assertions. `{ method: 'GET', url }` is shorthand —
the key is `url` because the variable is.

```ts
await app.close();
```

Every test that builds an app closes it. Fastify holds resources; leaked
instances make later tests fail in ways that look unrelated to their cause.

## Running them

```
pnpm test                                  # all packages
pnpm --filter @deepcs/gateway test         # one
```

`vitest run` executes once and exits — that's what the scripts use. Plain
`vitest` watches for changes instead, which is what you want while writing.

---

# Part 7 — What's coming

**The big picture.** Nothing below is in the repo yet. This exists so that when
phase 1 drops a new shape into a file, you recognise it instead of stopping.
Each block is enough to read the code, not enough to write it from scratch —
that comes when you build the thing.

## Input validation

Part 2 ended on the limit: types are gone at runtime, so JSON from the network
is unchecked. A **schema** is the runtime check.

```ts
const CreateUser = z.object({ email: z.string().email(), age: z.number().min(13) });

const parsed = CreateUser.parse(req.body);   // throws if wrong
```

The payoff is that the library also *derives* the TypeScript type, so one
declaration gives you the runtime check and the compile-time type together.
Fastify can also do this with JSON Schema in the route definition.

**Why it matters:** without it, a request with `age: "twelve"` reaches your
database code holding a value typed `number`.

## Optional and nullable properties

```ts
interface User {
  email: string;
  name?: string;          // may be absent — type is string | undefined
  deletedAt: Date | null; // always present, may be null
}
```

`?` and `| null` mean different things. Absent versus present-but-empty is a
distinction your database will care about.

## Type narrowing

When something is a union, TypeScript won't let you use it until you've proved
which side you're on.

```ts
function handle(err: unknown) {
  if (err instanceof Error) {
    err.message;      // fine here — narrowed to Error
  }
  err.message;        // error — back to unknown outside the if
}
```

`typeof x === 'string'`, `instanceof`, `'field' in obj`, and `x !== undefined`
all narrow. This is most of what you do with `unknown`.

## Utility types

Types built from other types. You'll read these constantly and rarely write one.

```ts
Partial<User>              // every field optional
Pick<User, 'email'>        // just that field
Omit<User, 'password'>     // everything except
Record<string, number>     // an object with string keys and number values
```

## Database queries

```ts
const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
```

Two things to notice permanently. It's `await` — every database call is a
Promise. And the value is `$1` with the data passed **separately**, never
concatenated into the string. String-concatenating user input into SQL is how
SQL injection happens; parameters are the fix, and there is no situation where
the shortcut is acceptable.

## Middleware and auth

Fastify hooks again, from Part 4 — the same `addHook` mechanism, doing real
work:

```ts
app.addHook('onRequest', async (req, reply) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return reply.code(401).send({ error: 'unauthorized' });
  req.user = await verifyToken(token);
});
```

Returning a reply from a hook **stops** the request — the route never runs. That
short-circuit is the entire mechanism behind auth, rate limits, and CORS.

## WebSockets

HTTP is one request, one response, done. A WebSocket stays open and both sides
can send at any time — which is what the collab service needs, because one
person typing has to reach the other without them asking.

```ts
socket.on('message', (data) => { ... });
socket.send(JSON.stringify({ type: 'edit', ... }));
```

Event handlers instead of request/response. The shape of the code changes more
than the syntax does.

## Redis and streams

Redis is memory-speed key/value storage. Phase 7's Stats job reads a **stream** —
an append-only log that remembers how far each consumer got, so a job that
crashes resumes rather than reprocessing or skipping.

```ts
await redis.xreadgroup('GROUP', 'stats', 'worker-1', 'COUNT', 100, 'STREAMS', 'events', '>');
```

Unfamiliar-looking, but it's still just an `await`ed call returning data.

---

# What to skip for now

Real parts of the language that this project will not make you learn. Skipping
them is a decision, not an omission — pick them up if something forces you to.

- **Classes and inheritance** beyond the four lines in Part 5. Almost nothing
  here is object-oriented.
- **`this`** and its binding rules. Arrow functions sidestep the problem, and
  this repo uses arrows.
- **Writing your own generics** (`function f<T>(x: T)`). Reading `Promise<void>`
  is enough.
- **Decorators**, **namespaces**, **`enum`**. Not used here.
- **Prototypes**, **`Symbol`**, **generators** (`function*`). Interesting, not
  load-bearing.
- **RxJS / observables**. Not in this stack.
- **Callback-style Node APIs** (`fs.readFile(path, (err, data) => ...)`). The
  older pattern that `async`/`await` replaced. You'll see it in old tutorials;
  prefer the `node:fs/promises` versions.

# Where to go after this

**TypeScript Handbook** — free, official, and the "TypeScript for JavaScript
Programmers" page covers most of Part 2 in more depth.

**MDN** — the reference for anything in Part 1. Search `MDN <thing>`.

**Fastify docs** — genuinely small. Getting Started plus the Hooks page is most
of it.

For video, search by topic rather than framework: "modern JavaScript async
await", "TypeScript for JavaScript developers". Skip anything titled as a
framework crash course — Part 4 is the entire framework you need here.

**One honest note.** None of this appears in a Google interview. That's DS&A and
system design, a separate track. This is what lets you *build* the thing.
