# How these docs are written

These pages exist to be read once and then re-explained from memory. That is a
harder target than "accurate": a page can be entirely correct and still leave
the reader unable to say *why* anything is the way it is.

Rules about content live in [../CLAUDE.md](../CLAUDE.md) — claims have to be
checkable, docs describe the present, a citation names its document. This file
is about shape: the order the beats go in, and the moves that make an
explanation stick.

## The spine

Four beats, in this order. A reader should be able to enter at any one of them
and still get value.

1. **The requirement.** What breaks without this thing, concretely, before a
   single term is defined.
2. **The parts.** One heading each, named the way the code names them.
3. **The wrong model, broken.** The belief the reader arrives holding, stated
   in their words, then dismantled. This is the highest-value section on most
   pages and the one most often missing.
4. **Practice.** Failure modes, the observable tell for each, code pointers,
   drills.

`docs/learning/websockets.md` runs 1-2-3. The `docs/system/` pages run 1-2-4.
Nothing should run 2 alone: a page that is only a parts list teaches the reader
to recognise words, not to rebuild the thing.

## The moves

**Headings are the reader's question.** Not "Signature verification" but "What
stops someone editing the payload?". Sometimes the heading is the reader's
objection, quoted: *"Surely something has to decide who wins?"*. Scanning the
contents should feel like scanning your own confusions.

**Name the wrong belief before correcting it.** Stating the right model is a
different act from replacing a wrong one, and replacing needs the wrong one on
the page, in the words people actually use. `websockets.md` does this in one
line: "the server can only ever answer. It can never start."

**Design it the obvious way first, and watch it fail.** The naive version is
the fastest route to the requirement, because the reader was already going to
build it in their head. Show it breaking, then show what the real design buys.

**Definition and instance in the same sentence.** Never an abstract definition
left standing alone, and never a glossary section. Terms get defined in square
brackets at first use: "a CRDT [conflict-free replicated data type]".

**Show the property as a scenario with an actor.** Not "the signature
guarantees integrity" but "somebody sets their role to `ADMIN`; verification
fails because the signature no longer matches". Actor, action, outcome, in that
order.

**Attach the tell.** Every failure mode names the symptom you would actually
observe. The best sentence in this repo is a tell: "five tests against real
Redis in 11 ms." A failure without its tell is trivia; with one, it is a
diagnostic the reader can run against their own screen.

**Say what a fix does not fix.** "HTTPS protects the connection; it does
nothing about XSRF." Residual risk stated in place is what makes the rest of
the page credible.

**Cost in the same breath as benefit.** No "limitations" section at the bottom
that nobody reaches. "Deleting marks a character rather than erasing it, which
is why a document's history grows as people type."

**Compare options by what goes wrong, same shape on both sides.** Enumerate the
concrete failures of option A, then show option B removing exactly those. See
"*Why Redis pub/sub and not sticky sessions?*" in `system/05-collab.md`.

**Flag every simplification in place.** Where a page trims detail, say so in
the sentence that trims it, so the reader knows the floor of what they were
told. Never simplify into mechanics that are false.

**Mark opinion as opinion.** "The hard part of the project, and the only piece
I would defend as genuinely difficult" is fine and useful. What is not fine is
leaving a decision open: decisions were made once and live in `docs/adr/`.
Point there rather than re-arguing.

**Diagram or formula first, prose second.** A sequence diagram, a one-line
formula, a numbered walk of one keystroke. Then the paragraph explaining it.
The artefact anchors the words; the words alone anchor nothing.

**Defer with a promise, and pay it.** "Why that mattered here is ADR-02" keeps
a section short without dropping the question. Every forward reference must
land somewhere real.

**Bold only the clause that must survive skimming.** One or two per section. If
half a paragraph is bold, none of it is.

## What not to do

- **No hype openers.** Nobody arrives at `05-collab.md` needing to be sold.
  Open on the requirement.
- **No unquantified superlatives.** "Massive scalability gain" is a claim
  without a number, which CLAUDE.md forbids. Either the measured figure with
  the machine it came from, or nothing.
- **No analogies that stand in for mechanism.** An analogy that replaces the
  real steps leaves the reader with a story they cannot debug.
- **No history.** "This used to be X" belongs in an ADR or nowhere.
- **No glossary section.** See above: brackets, at first use.

## Register

Second person, present tense, short paragraphs, one idea each. Plain sentences
over arrow-chain shorthand. Wrap at 78 characters. Em dashes are fine here;
they are banned only in text a user of the product sees.

## Before calling a page done

1. Does it open on what breaks without the thing?
2. Is the wrong model on the page, in the reader's words, before it is broken?
3. Does every failure mode carry its observable tell?
4. Does every heading read as a question someone actually has?
5. Could the reader rebuild the mechanism from the page, or only recognise its
   vocabulary?
