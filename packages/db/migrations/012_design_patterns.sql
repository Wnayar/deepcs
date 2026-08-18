-- Design patterns as their own topic, and the OOP topic narrowed to make room
-- for it.
--
-- The catalogue was living inside `oop`: lesson 2 was SOLID *plus* creational
-- and structural patterns, lesson 3 was the behavioural ones *plus* composition
-- over inheritance. Two subjects sharing a lesson meant neither had room, and
-- the roadmap could not show that patterns were a thing you had finished.
--
-- Everything here is in this file rather than edited into 005 and 009. Those
-- two are re-runnable seeds, so changing a title in them would insert a second
-- row next to the old one on any database that already ran them. Migrations run
-- in order instead, so a fresh database gets 005, then 009, then this, and ends
-- where an existing one does.
--
-- Three lessons, not four. `step` and `difficulty` agree by construction (step 1
-- is easy) and there are exactly three difficulties, because Matching pairs
-- people on difficulty. A fourth lesson would have nothing to be. "What a design
-- pattern is" is therefore the opening section of lesson 1 rather than a lesson.

-- ── The topic ───────────────────────────────────────────────────────────────
-- Hangs off `oop`: the patterns are answers to problems the four pillars and
-- SOLID create, so reading them first is what makes the catalogue mean anything.
INSERT INTO questions.topics (topic, title, summary, depends_on, grid_x, grid_y) VALUES
  ('design-patterns', 'Design Patterns', 'The named solutions to problems that keep coming back in object-oriented code. Read it after OOP, because every pattern here is an answer to something the pillars and SOLID leave open.', ARRAY['oop']::text[], 7, 2)
ON CONFLICT (topic) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
  depends_on = EXCLUDED.depends_on, grid_x = EXCLUDED.grid_x, grid_y = EXCLUDED.grid_y;

-- ── OOP loses the patterns ──────────────────────────────────────────────────
-- Renamed by UPDATE rather than re-seeded, because `questions.bank` is unique on
-- title: inserting the new name would leave the old row beside it. Matching
-- nothing on a second run is the correct behaviour, not a failure.
UPDATE questions.bank SET title = 'SOLID Principles'
  WHERE title = 'SOLID Principles + Creational & Structural Patterns';

UPDATE questions.bank SET title = 'Composition over Inheritance'
  WHERE title = 'Behavioural Patterns + Composition vs Inheritance';

-- Their questions lose the pattern half too, or the Key summary would still be
-- asking about Singleton in a lesson that no longer mentions it.
UPDATE questions.bank SET parts = $parts$["An SRP violation and its fix?","What does Open/Closed mean in practice?","Explain LSP with a concrete violation.","What is the Interface Segregation Principle, and what does violating it cost?","How does DIP relate to dependency injection?"]$parts$
  WHERE title = 'SOLID Principles';

UPDATE questions.bank SET parts = $parts$["Why is inheritance called the tightest coupling in OO?","What is the fragile base class problem?","When is inheritance actually the right call?","How does delegation give you reuse without inheritance?","Is-a and has-a: how do you decide which one you have?"]$parts$
  WHERE title = 'Composition over Inheritance';

-- ── The three lessons ───────────────────────────────────────────────────────
-- `tags[1]` is the topic, which is what the roadmap query groups on. The rest of
-- the tags are what Matching pairs on.
INSERT INTO questions.bank (title, difficulty, parts, reference_md, tags) VALUES
(
  'Creational Patterns',
  'easy',
  $parts$["What is a design pattern, and what is it not?","When does a factory beat calling the constructor?","Builder: what problem does it actually solve?","Why is Singleton usually an antipattern?","Factory Method vs Abstract Factory?"]$parts$,
  $md$### 1. What is a design pattern, and what is it not?

A named solution to a problem that keeps coming back in object-oriented code. It is a description of a shape, not code you import: you rewrite it each time to fit the situation, which is why the same pattern looks different in two codebases.

What it is not: a goal. Patterns are answers, so reaching for one before you have the problem gives you the cost (more classes, more indirection) with none of the benefit. The honest version in an interview is "I would not use one here yet", and knowing when not to is the part that separates people who have read the catalogue from people who have used it.

### 2. When does a factory beat calling the constructor?

When the caller should not know which class it is getting. `PaymentProcessor.for_country("DE")` can return a SEPA processor today and a different one tomorrow, and no caller changes. A constructor cannot do that: naming the class is the whole point of `SepaProcessor()`.

Three other cases: the construction takes work you do not want repeated (parsing config, reading env), you want to return a cached instance rather than a new one, or the decision depends on data only known at runtime. If none of those apply, the constructor is better, because it is one fewer thing to follow.

### 3. Builder: what problem does it actually solve?

Constructors that take a long list of arguments, most of them optional. `HttpRequest(url, None, None, 30, True, None)` is unreadable at the call site and impossible to extend without touching every caller.

A builder replaces the argument list with named steps, so a call says what it is setting, and the object can be validated once at `build()` rather than in a constructor that cannot see the whole picture yet. It earns its keep when the number of optional pieces is high; for two arguments it is ceremony.

### 4. Why is Singleton usually an antipattern?

Because it is global mutable state wearing a class. Three concrete costs: tests cannot get a clean instance, so they leak into each other; the dependency is invisible, because a class that calls `Config.instance()` looks like it needs nothing; and it hard-codes "exactly one", which is wrong the day you need one per tenant or one per test.

What people actually want from it is usually "one instance for this application", which is a lifetime decision, not a class design. Create one at startup and pass it in. That is dependency injection, it is testable, and the dependency is visible in the signature.

### 5. Factory Method vs Abstract Factory?

Factory Method is one method that decides which subclass to return. Abstract Factory is an object with several such methods that return a matched *family*, where the point is that the pieces go together: a `DarkTheme` factory returns a dark button and a dark menu, and you cannot accidentally mix a dark button with a light menu.

So: one product, use Factory Method. Several products that must agree with each other, use Abstract Factory. The second is much rarer, and interviewers ask the difference precisely because most people have only met the first.$md$,
  ARRAY['design-patterns','creational','factory','builder','singleton']
),
(
  'Structural Patterns',
  'medium',
  $parts$["Adapter vs Facade, what actually differs?","Decorator vs inheritance for adding behaviour?","Where does Proxy show up in a real backend?","When does a Facade turn into a god object?","Composition is in all of these. Why?"]$parts$,
  $md$### 1. Adapter vs Facade, what actually differs?

Adapter changes an interface you do not control into one your code expects. It wraps one thing, and the shape it exposes is dictated by the caller.

Facade hides several things behind one simpler entry point. It wraps many, and the shape it exposes is invented by you.

The tell is the count and the motive: one object and someone else chose the interface, that is Adapter. Several objects and you chose the interface, that is Facade.

### 2. Decorator vs inheritance for adding behaviour?

Inheritance decides at compile time and only once: a `TimedCache` is a cache with timing, forever. If you also want logging and retries you need `TimedLoggedRetryingCache`, and every combination is another class.

Decorator wraps at runtime, so the combinations compose: `Retrying(Logging(Timing(cache)))`. Each wrapper implements the same interface as the thing it wraps, which is what lets them stack in any order.

Use inheritance when the behaviour is part of what the thing *is*, and Decorator when it is something you are adding *around* what it does. Backend middleware is Decorator, which is worth saying out loud because it is the version interviewers recognise.

### 3. Where does Proxy show up in a real backend?

Everywhere, usually without the name. A proxy has the same interface as the real object and controls access to it: a caching layer in front of a repository, a lazy loader that does not hit the database until a field is read, a permissions check that refuses before the call lands, a client stub for a remote service.

The difference from Decorator is intent, not shape. Both wrap and both keep the interface. Decorator adds behaviour you want; Proxy controls whether and when you reach the original at all.

### 4. When does a Facade turn into a god object?

When it stops delegating and starts deciding. A Facade is meant to be a thin front door: it calls three subsystems in the right order and returns. It goes wrong when business logic drifts into it, because it is the one place that can see everything, and being able to see everything is exactly what makes it a magnet.

The smell is a Facade that has grown state, or a Facade that has to change every time any subsystem changes. The first means it is doing work; the second means it is not hiding anything.

### 5. Composition is in all of these. Why?

Because every structural pattern is about how objects are assembled at runtime rather than how classes are declared. Adapter holds the thing it adapts, Decorator holds the thing it wraps, Proxy holds the thing it guards, Facade holds the subsystems it fronts.

That is the same reasoning as composition over inheritance, applied to structure: a `has-a` relationship can be rearranged, replaced or stacked while the program is running, and an `is-a` relationship is fixed when you write it.$md$,
  ARRAY['design-patterns','structural','adapter','decorator','proxy']
),
(
  'Behavioural Patterns',
  'hard',
  $parts$["Strategy: a real backend example, not shapes.","Observer vs pub/sub, same thing?","When is Command the right answer?","State vs Strategy, what actually differs?","Template Method vs Strategy, and which ages better?"]$parts$,
  $md$### 1. Strategy: a real backend example, not shapes.

Pricing. The same checkout has to apply different discount rules per country, per campaign, per customer tier. Written as branches, that is one function growing an `elif` per rule, touched by every team, and impossible to test in isolation.

As Strategy, each rule is an object with the same interface, and checkout holds one. Adding a rule adds a file, and no existing code is edited, which is Open/Closed made concrete. Others: retry policies, rate limiter algorithms, compression codecs, auth schemes.

In Python the interface is often just a callable, so the pattern collapses to "pass a function". That is the same idea and worth saying, but say it as a language observation rather than as though the pattern disappeared.

### 2. Observer vs pub/sub, same thing?

Close but not the same, and the difference is who knows whom. In Observer the subject holds a list of its observers and calls them directly, so it knows they exist and the calls are synchronous and in-process.

In pub/sub a broker sits in the middle. Publishers do not know subscribers exist and often do not share a process, so delivery can be asynchronous, buffered, retried or lost. Observer is a design pattern inside one program; pub/sub is an architecture between programs.

Saying "same thing" is the common wrong answer. Naming the broker is the right one.

### 3. When is Command the right answer?

When an action has to become a value: something you can queue, log, retry, schedule, or undo. Wrapping a call in an object gives it an identity, so it can be stored and executed later by something that knows nothing about what it does.

Concretely: a job queue, an undo stack, a transactional outbox, a set of retryable operations. If the action only ever needs to happen now, a function call is the right answer and Command is overhead.

### 4. State vs Strategy, what actually differs?

They are the same shape and different intents, which is why the question gets asked. Both hold an object that implements an interface and delegate to it.

Strategy is chosen from outside and does not change on its own: the caller picks a pricing rule. State is chosen from inside and transitions itself: an order moves from pending to paid to shipped, and each state decides what the next one is.

So the tell is who does the swapping. If the object replaces its own delegate as a result of what happened, that is State.

### 5. Template Method vs Strategy, and which ages better?

Template Method fixes the order of steps in a base class and lets subclasses fill in some of them. Strategy hands the whole varying part to an object held at runtime.

Template Method uses inheritance, so the variation is decided once, the subclass is bound to the base class forever, and two variations cannot be combined. Strategy uses composition, so it can be changed while running and tested on its own.

Strategy ages better for exactly that reason, and Template Method is still the right answer when the *order* is the thing worth enforcing and only small holes vary.$md$,
  ARRAY['design-patterns','behavioural','strategy','observer','state']
)
ON CONFLICT (title) DO UPDATE SET
  difficulty = EXCLUDED.difficulty, parts = EXCLUDED.parts,
  reference_md = EXCLUDED.reference_md, tags = EXCLUDED.tags;

-- ── The three lesson bodies ─────────────────────────────────────────────────
-- One shape, repeated twelve times, because the reader's first question on every
-- screen is the same one: what is this and why would I use it.
--
--   ## <Name>: <what it does, in plain words>
--   **Use it when** <one sentence>
--   the problem, as prose
--   the code
--   ### <a real distinction, never scaffolding>
--
-- Two rules fall out of that and both were learned by getting it wrong. A `##`
-- heading always names one pattern, so a section title alone answers "is this a
-- pattern". And a `###` always marks a genuine sub-point, so "Start with the
-- problem" is not one: as a heading it sat at the same weight as "Push or pull",
-- which made scaffolding look like content. The problem is just the opening
-- paragraphs now.
--
-- Each lesson opens with a map of itself, because the step page shows one `##`
-- per screen and a reader who lands on "Observer" otherwise has no way to see
-- what else is in the lesson or where they are in it.

UPDATE questions.bank SET lesson_md = $body$## What a design pattern is

A **design pattern** [a named, reusable solution to a problem that keeps coming back in object-oriented code] is a description of a shape, not a library you install. You rewrite it every time, which is why the same pattern looks different in two codebases and why you cannot find one by grepping for a class name.

### Where they come from

You are writing the third payment integration this year. The first two both ended up with the same structure: something that decides which provider to use, a common interface so the rest of the app does not care, and one place where the provider-specific mess is contained.

Nobody told you to build it that way twice. You arrived at it because the forces were the same both times: callers who should not know the provider, providers that change independently, and a need to add a fourth without editing the first three.

That is all a pattern is. Somebody noticed a shape that keeps working, gave it a name, and wrote down when it applies. **The name is most of the value**, because it turns a paragraph of explanation into one word two engineers already share.

### The three families

The catalogue splits three ways, by what the pattern is about.

```
Creational   how objects get made        <- this lesson
Structural   how objects are assembled   <- lesson 2
Behavioural  how objects talk and decide <- lesson 3
```

### The three in this lesson

| Pattern | Use it when |
|---|---|
| **Factory Method** | the caller should not know which class it is getting |
| **Builder** | an object has many optional parts and must be valid when finished |
| **Singleton** | almost never, and knowing why is the point |

### When a pattern is the wrong answer

This matters more than the catalogue, and it is what separates people who have read it from people who have used it.

A pattern buys flexibility with indirection: more classes, and one more hop when you follow the code. That trade is worth it when the flexibility is one you will actually use, and a loss when it is not. A factory with exactly one product, forever, is a class that exists to call a constructor.

So the sequence is: write the simple thing, feel the problem, then reach for the name. **"I would not use one here yet" is a strong answer, not a dodge.**

## Factory Method Pattern: hide which class you are building

**Use it when** the caller should get a working object without naming the concrete class it gets.

Checkout needs a payment processor, and the obvious version puts the decision where the object is used:

```python
def checkout(order):
    if order.country == "DE":
        processor = SepaProcessor()
    elif order.country == "US":
        processor = AchProcessor()
    else:
        processor = CardProcessor()
    processor.charge(order.total)
```

Every place that needs a processor repeats that block, so adding a country means finding all of them. Worse, `checkout` now knows the name of every processor class, which gives it a reason to change that has nothing to do with checkout.

The factory moves the decision behind one function that returns the interface, not the class:

```python
def processor_for(country: str) -> PaymentProcessor:
    return {"DE": SepaProcessor, "US": AchProcessor}.get(country, CardProcessor)()

def checkout(order):
    processor_for(order.country).charge(order.total)
```

`checkout` now depends on `PaymentProcessor` and nothing else, and adding a country touches one dictionary.

### What it actually bought

Three specific things, not "flexibility" in the abstract:

- The caller no longer names a concrete class, so a swap is one edit rather than many.
- The choice became testable on its own: you can assert `processor_for("DE")` without running a checkout.
- Construction has somewhere to live. If a processor needs credentials from config, that work sits in the factory instead of at every call site.

If none of the three apply, the constructor was fine.

### Abstract Factory, in one paragraph

Same idea, several products that must match. A factory that returns a button *and* a menu *and* a dialog, all from one theme, so nothing can mix a dark button with a light menu. Much rarer than people expect, and the interview question is usually just the difference: one product is Factory Method, a matched family is Abstract Factory.

## Builder Pattern: assemble an object step by step

**Use it when** an object has many optional parts, and it should be checked once it is finished rather than half way through.

An object with many optional pieces gives you a constructor nobody can read:

```python
request = HttpRequest("https://api.example.com", None, None, 30, True, None, 3)
```

What is `True`? What is `3`? The call site cannot say, and adding an eighth option means editing every existing call.

A builder replaces the argument list with named steps:

```python
request = (
    HttpRequestBuilder("https://api.example.com")
    .timeout(30)
    .follow_redirects()
    .retries(3)
    .build()
)
```

### The part that is not just readability

`build()` is the one place that sees the finished object, so it is the only place validation can be complete. A constructor cannot check "a retry count is meaningless without a timeout" when the timeout arrives in a later setter, and **an object that is briefly invalid is an object somebody will use while it is**.

### Where Python differs

Keyword arguments and dataclasses already solve the readability half, so a full builder is rarer here than in Java:

```python
request = HttpRequest(url="https://api.example.com", timeout=30, retries=3)
```

Reach for a builder when there is real validation at the end, or when the object is assembled across several places rather than in one call.

## Singleton Pattern: the one to argue against

**Use it when** you have thought about it and still want exactly one instance forever. Which is rarer than the pattern's fame suggests.

You want one connection pool for the whole application, and the pattern says make the class hand out the only instance:

```python
class Config:
    _instance = None

    @classmethod
    def instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance
```

This is the most recognised pattern in the catalogue and the one most likely to be a mistake, for three concrete reasons:

- **Tests leak into each other.** There is no clean instance, so whatever ran first decides what the next test sees.
- **The dependency is invisible.** A class calling `Config.instance()` looks like it needs nothing. Its real requirements are only findable by reading its body.
- **"Exactly one" is hard-coded.** That is wrong the day you need one per tenant, one per test, or two during a migration.

### What people actually want instead

Not "one instance ever", but "one instance for this application". That is a lifetime decision, not a class design, so make it once at startup and pass it down:

```python
def main():
    config = Config.load()
    app = build_app(config)
```

The dependency is now in the signature, tests pass their own, and nothing is global. That is dependency injection, and it is the answer to give: **name the pattern, name the three costs, then say what you would do instead.**
$body$, step = 1
  WHERE title = 'Creational Patterns';

UPDATE questions.bank SET lesson_md = $body$## The four structural patterns

**Structural patterns are about how objects are assembled**, not how they are made. Every one of them holds another object rather than inheriting from it, which is composition over inheritance applied to structure.

| Pattern | Use it when |
|---|---|
| **Adapter** | an interface you do not control has to fit one you do |
| **Decorator** | you want to add behaviour without a class per combination |
| **Facade** | several subsystems need one simple front door |
| **Proxy** | something must control access to the real object |

Two of these come up as comparison questions almost every time, so they are answered where they arise: Adapter against Facade, and Proxy against Decorator.

## Adapter Pattern: make a foreign interface fit yours

**Use it when** you own one side of a mismatch and not the other.

Your code sends email through one interface:

```python
class Mailer:
    def send(self, to: str, subject: str, body: str) -> None: ...
```

Marketing buys a service whose client looks nothing like that:

```python
vendor.dispatch({"recipient": to, "headline": subject, "content": body, "format": "html"})
```

There are two bad options and one good one. Bad: change every caller to speak the vendor's shape, which spreads the vendor through your codebase and makes the next vendor a rewrite. Bad: fork the vendor's client. Good: write the translation once.

The adapter implements the interface your code expects and holds the thing that does not:

```python
class VendorMailer(Mailer):
    def __init__(self, vendor):
        self._vendor = vendor

    def send(self, to, subject, body):
        self._vendor.dispatch(
            {"recipient": to, "headline": subject, "content": body, "format": "html"}
        )
```

Nothing else in the codebase learns the vendor exists, so swapping vendors is a new adapter and the interface you own stays the one everything speaks.

### When not to

If you control both sides, change one of them so they agree. **An adapter you did not need is a layer somebody has to read through forever.**

## Decorator Pattern: add behaviour by wrapping

**Use it when** several optional behaviours have to combine, and you do not want a class per combination.

You have a cache and you want timing on it. Then logging. Then retries.

Inheritance gives you a class per combination: `TimedCache`, `TimedLoggingCache`, `TimedLoggingRetryingCache`. Three features is seven classes, and the choice is fixed when you write it.

A decorator implements the same interface as the thing it wraps and holds one of them, so wrappers stack at runtime:

```python
class Cache:
    def get(self, key: str) -> str | None: ...

class Timed(Cache):
    def __init__(self, inner: Cache, clock):
        self._inner, self._clock = inner, clock

    def get(self, key):
        started = self._clock()
        try:
            return self._inner.get(key)
        finally:
            record(self._clock() - started)

class Retrying(Cache):
    def __init__(self, inner: Cache, attempts: int = 3):
        self._inner, self._attempts = inner, attempts

    def get(self, key):
        for attempt in range(self._attempts):
            try:
                return self._inner.get(key)
            except TransientError:
                if attempt == self._attempts - 1:
                    raise
```

The composition is then the configuration:

```python
cache = Retrying(Timed(RedisCache(), clock=time.monotonic))
```

### This is the one to remember

**Backend middleware is Decorator.** An HTTP handler wrapped in auth, wrapped in rate limiting, wrapped in request logging is exactly this shape, and saying so is what shows you have met the pattern rather than read about it.

### Order is behaviour

Two details that get asked. The wrapper must implement the *same* interface or it cannot stack. And the nesting order changes what you measure: retrying inside timing times each attempt, timing inside retrying times the whole thing.

## Facade Pattern: one door in front of many rooms

**Use it when** a common job needs several subsystems called in the right order.

Placing an order touches inventory, payments, shipping and email. Every caller that wants to place an order has to know all four, call them in order, and handle the third one failing.

The facade is one entry point that does the sequencing:

```python
class Checkout:
    def __init__(self, inventory, payments, shipping, mail):
        self._inventory, self._payments = inventory, payments
        self._shipping, self._mail = shipping, mail

    def place(self, order) -> OrderResult:
        self._inventory.reserve(order)
        self._payments.charge(order)
        self._shipping.schedule(order)
        self._mail.confirm(order)
        return OrderResult(order.id)
```

The subsystems are unchanged and still usable directly, which is the point: **a facade is a convenience, not a wall.**

### How it goes wrong

It turns into a god object when it stops delegating and starts deciding. It is the one place that can see everything, and being able to see everything is exactly what makes it a magnet for logic.

Two smells worth naming: it has grown state of its own, which means it is doing work rather than routing; or it changes whenever any subsystem changes, which means it is not hiding anything.

### Adapter or Facade?

The count and the motive. **One object and someone else chose the interface: Adapter. Several objects and you invented the interface: Facade.**

## Proxy Pattern: stand in front of the real thing

**Use it when** something has to happen before, instead of, or around reaching the real object.

Reading a user loads their entire order history, and most pages never look at it. A proxy has the same interface as the real object and controls access to it, here by not doing the work until somebody asks:

```python
class LazyOrders:
    def __init__(self, user_id, repo):
        self._user_id, self._repo, self._loaded = user_id, repo, None

    def __iter__(self):
        if self._loaded is None:
            self._loaded = self._repo.orders_for(self._user_id)
        return iter(self._loaded)
```

### The four you will actually meet

- **Virtual**: defer expensive construction until first use, as above.
- **Caching**: return a stored answer instead of calling through.
- **Protection**: check permissions and refuse before the call lands.
- **Remote**: a local stand-in for something running elsewhere, which is what an RPC client is.

### Proxy or Decorator?

The shape does not answer it, because both wrap and both keep the interface. **The difference is intent: Decorator adds behaviour you want on top, Proxy decides whether, when, or for whom you reach the original at all.**
$body$, step = 2
  WHERE title = 'Structural Patterns';

UPDATE questions.bank SET lesson_md = $body$## The behavioural patterns

**Behavioural patterns are about how objects decide and how they talk to each other.** The first three below are the ones worth knowing cold; the last two are almost always asked as comparisons against the first.

| Pattern | Use it when |
|---|---|
| **Strategy** | the same job has to be done a different way per case |
| **Observer** | one thing changes and several others must react |
| **Command** | an action must become a value you can queue, retry or undo |
| **Template Method** | the *order* of steps is fixed and only the steps vary |
| **State** | an object's behaviour changes as it moves through a lifecycle |

## Strategy Pattern: swap the algorithm, keep the caller

**Use it when** one decision has several interchangeable answers and new ones keep arriving.

Checkout applies discounts, and the rules differ by country, campaign and customer tier:

```python
def discount(order):
    if order.country == "DE" and order.total > 100:
        return order.total * 0.1
    elif order.customer.tier == "gold":
        return order.total * 0.15
    elif order.campaign == "BLACKFRIDAY":
        return order.total * 0.3
    return 0
```

Every new rule edits this function, and every team that owns a rule edits this function. Testing one rule means building an order that avoids all the others, and the branches quietly start to overlap.

Strategy makes each rule an object with the same interface, and the caller holds one:

```python
class DiscountRule(Protocol):
    def apply(self, order: Order) -> Decimal: ...

class GoldTier:
    def apply(self, order):
        return order.total * Decimal("0.15") if order.customer.tier == "gold" else Decimal(0)

class Checkout:
    def __init__(self, rule: DiscountRule):
        self._rule = rule

    def total(self, order):
        return order.total - self._rule.apply(order)
```

**Adding a rule adds a file and edits nothing.** That is Open/Closed made concrete, and naming SOLID here is what ties the two lessons together.

### Where Python differs

If the interface is one method, a strategy is a function:

```python
Checkout(rule=lambda order: order.total * Decimal("0.15"))
```

Duck typing means no interface declaration is needed to make that work. Say it as a language observation rather than as though the pattern vanished, because the design decision is unchanged: **the varying part is passed in, not branched on.**

### Others you have already used

Retry policies, rate limiter algorithms, compression codecs, auth schemes, sort comparators. Anything where "the same job, done a different way" is a real axis of change.

## Observer Pattern: tell many listeners that something happened

**Use it when** one thing changes and several others must react, and it should not know who they are.

When an order is paid, four things must happen: email the customer, decrement stock, notify the warehouse, update analytics. Written directly, the payment code imports all four and grows a fifth line every time somebody adds a consequence.

Observer lets the subject keep a list of interested parties and tell them, without knowing what they do:

```python
class Order:
    def __init__(self):
        self._observers = []

    def subscribe(self, observer) -> None:
        self._observers.append(observer)

    def pay(self) -> None:
        self._status = "paid"
        for observer in self._observers:
            observer.on_paid(self)
```

Payment now knows that observers exist, and nothing about what they are for.

### Push or pull

Two shapes, differing in what the notification carries.

- **Push**: the subject sends the data, `observer.on_paid(order_id, total)`. Fewer round trips, but the subject has to guess what every observer wants.
- **Pull**: the subject sends itself and observers take what they need, `observer.on_paid(self)`.

**Pull is the safer default**, because adding a field one observer needs does not change the subject's signature.

### Why this is not pub/sub

The question that gets asked, and "same thing" is the wrong answer. The difference is who knows whom.

```
Observer                          Pub/sub
subject holds the list            a broker sits in the middle
subject knows observers exist     publisher knows nothing of subscribers
same process, synchronous         often across processes, asynchronous
a slow observer blocks the rest   the broker buffers, retries, or drops
```

**Observer is a pattern inside one program. Pub/sub is an architecture between programs.** Naming the broker is what shows you know the difference.

One shared weakness worth mentioning: with a synchronous list, a single slow or throwing observer takes the whole notification down with it, so anything real either isolates failures or hands off to a queue.

## Command Pattern: turn an action into a value

**Use it when** an action has to be stored, moved or repeated rather than just performed.

A job runner needs to execute work later, retry it if it fails, and record what it ran. A function call cannot be stored or inspected, because by the time it exists it has already happened.

Command turns the action into an object, so it becomes a value with an identity:

```python
class SendInvoice:
    def __init__(self, order_id: str):
        self.order_id = order_id

    def execute(self, deps) -> None:
        deps.mailer.send_invoice(self.order_id)

queue.push(SendInvoice(order.id))
```

The runner executes anything with `execute` and knows nothing about invoices.

### What it unlocks

- **Queueing and scheduling**: the action can wait somewhere.
- **Retries**: the same object can run again, which is why commands should be safe to repeat.
- **Undo**: add `revert()` and the stack of executed commands is an undo history.
- **An audit trail**: the object records what was asked for, not only what happened.

If the action only ever needs to happen right now, this is overhead and a function call is the answer.

## Template Method Pattern: fix the order, vary the steps

**Use it when** the sequence is the thing worth enforcing and only small holes differ.

A base class fixes the order of steps and subclasses fill some of them in. Report generation is the standard example: fetch, transform, render, deliver, where only transform and render vary.

Its cost is that the variation happens through inheritance, so it is decided once and permanently, and two variations cannot be combined.

### Template Method or Strategy?

**Strategy ages better**, because composition can be swapped at runtime and tested on its own while a subclass is bound to its base class forever. Template Method is still right when the order itself is the contract and the holes are small.

## State Pattern: let the object change its own behaviour

**Use it when** an object moves through a lifecycle and what it may do depends on where it is.

Same shape as Strategy, different intent, which is why the comparison gets asked.

```python
class PendingOrder:
    def pay(self, order):
        order.state = PaidOrder()        # the state chooses the next state

class PaidOrder:
    def pay(self, order):
        raise AlreadyPaid()
```

Strategy is chosen from outside and does not change itself: the caller picks a discount rule. State is chosen from inside and transitions itself: the order moves from pending to paid to shipped, and each state decides what may happen next.

**The tell is who does the swapping.** If the object replaces its own delegate as a result of what just happened, that is State. If something else hands it in, that is Strategy.
$body$, step = 3
  WHERE title = 'Behavioural Patterns';

-- ── The two OOP lessons lose their pattern halves ───────────────────────────
-- Cut in place rather than re-pasted here. 009_roadmap.sql stays the one home
-- for that prose; copying it into this file would leave two versions to keep in
-- step, and the one nobody updates is always the copy.
--
-- Both statements are idempotent, which they have to be because a migration can
-- be re-applied by hand. `split_part` with a separator that is no longer present
-- returns the whole string, and `position` returning 0 makes `substring from 0`
-- do the same, so a second run changes nothing.

-- Everything from "## Creational Patterns" onward now lives in the new topic.
UPDATE questions.bank
SET lesson_md = rtrim(split_part(lesson_md, '## Creational Patterns', 1))
WHERE title = 'SOLID Principles';

-- Lesson 3 kept only its last section, so the cut runs the other way.
UPDATE questions.bank
SET lesson_md = substring(lesson_md from position('## Composition over Inheritance' in lesson_md))
WHERE title = 'Composition over Inheritance';

-- What that section did not have room for while it was sharing a lesson with
-- six patterns. Appended rather than pasted whole for the same reason as above,
-- and guarded so re-running does not add it twice.
UPDATE questions.bank
SET lesson_md = rtrim(lesson_md) || $body$

### The fragile base class problem

Inheritance is the tightest coupling in object-oriented code, because a subclass depends on how its parent works and not only on what it does.

```python
class Counter:
    def __init__(self):
        self.total = 0

    def add(self, item):
        self.total += 1

    def add_all(self, items):
        for item in items:
            self.add(item)          # calls its own add

class DoubleCounter(Counter):
    def add(self, item):
        self.total += 2
```

`DoubleCounter().add_all([1, 2])` gives 4, which looks right. Now the author of `Counter` optimises `add_all` to `self.total += len(items)` without calling `add`. Nothing about the public behaviour of `Counter` changed, every test on it still passes, and `DoubleCounter` silently returns 2.

That is the fragile base class problem: **a private implementation detail of the parent was load-bearing for the child**, and nothing in the type system said so. It is the concrete reason "prefer composition" is advice rather than taste.

### Delegation is what you use instead

Hold the object and forward what you need:

```python
class DoubleCounter:
    def __init__(self):
        self._counter = Counter()

    def add(self, item):
        self._counter.add(item)
        self._counter.add(item)

    @property
    def total(self):
        return self._counter.total
```

More typing, and that is the real trade. What you get back is that `Counter` can change however it likes as long as `add` still means what it said, because you are using its interface rather than living inside it.

### Mixins, and where Python differs

Python has multiple inheritance, so shared behaviour is often a **mixin** [a small class that adds one capability and is never instantiated on its own]:

```python
class TimestampMixin:
    def touch(self):
        self.updated_at = datetime.now(timezone.utc)

class Order(TimestampMixin, Model): ...
```

This is real reuse without a deep chain, and it is idiomatic. It is still inheritance, so the fragile base class problem still applies. The reason it hurts less is that a mixin is small and stateless enough for its whole implementation to be obvious.

### When inheritance is actually right

Three conditions, and it wants all three:

- The relationship is genuinely **is-a**, and stays true forever. A `SavingsAccount` is an `Account`. A `Car` is not an `Engine`.
- **Liskov holds**: anywhere the parent is accepted, the child works without the caller checking which it got.
- The parent is **designed** to be inherited from: documented extension points, and behaviour that does not depend on which of its own methods it calls internally.

Miss any of the three and you want composition.

### The question to ask out loud

"Is this a kind of that, or does this have one of those?"

A `GuideDog` is a kind of `Dog`, so inheritance is defensible. A dog that swims **has** a swimming ability, so that is a part to hold, not a class to become. Getting that sentence right is most of the decision, and it is the answer to give when an interviewer asks how you choose.
$body$
WHERE title = 'Composition over Inheritance'
  AND position('The fragile base class problem' in lesson_md) = 0;

-- ── Both trimmed lessons page again ─────────────────────────────────────────
-- Removing their second and third `##` sections left each lesson as one heading
-- and several thousand words, and the step page shows one `##` section per
-- screen. So the parts that were already the lesson's real divisions are
-- promoted to be those sections.
--
-- `replace` on the exact heading text, which is idempotent because a heading
-- that is already `##` no longer matches `### `.
UPDATE questions.bank SET lesson_md =
  replace(replace(replace(replace(replace(lesson_md,
    '### S: Single Responsibility',  '## S: Single Responsibility'),
    '### O: Open/Closed',            '## O: Open/Closed'),
    '### L: Liskov Substitution',    '## L: Liskov Substitution'),
    '### I: Interface Segregation',  '## I: Interface Segregation'),
    '### D: Dependency Inversion',   '## D: Dependency Inversion')
WHERE title = 'SOLID Principles';

UPDATE questions.bank SET lesson_md =
  replace(replace(replace(replace(replace(lesson_md,
    '### The fragile base class problem',   '## The fragile base class problem'),
    '### Delegation is what you use instead', '## Delegation is what you use instead'),
    '### Mixins, and where Python differs',  '## Mixins, and where Python differs'),
    '### When inheritance is actually right', '## When inheritance is actually right'),
    '### The question to ask out loud',      '## The question to ask out loud')
WHERE title = 'Composition over Inheritance';
