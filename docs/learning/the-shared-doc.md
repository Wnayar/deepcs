# The shared document, explained simply

Two people, one editor, both typing. This page is what "one document"
actually means, where it lives, and how two people can change it at the same
time without wrecking it.

## What it actually is

It is never a file. At any moment there are up to **three live copies** of
the document, plus one saved copy:

- one in browser A's memory, driving A's editor,
- one in browser B's memory, driving B's editor,
- one in the Collab pod's memory (this is what a "room" holds),
- and a saved copy in Postgres — bytes in a table row, updated every 30
  seconds, on last disconnect, and before shutdown.

Each live copy is a **Yjs document**: not a plain string, but a data
structure that stores the text *plus enough bookkeeping that separate copies
can merge*. That bookkeeping is the entire subject of this page.

## Why a plain string can't work

Design it the obvious way first, and watch it fail. Server holds a string.
Browsers send edits like "insert `x` at position 12".

Now both people type in the same moment. A inserts a character at position
5. That shifts everything after it — so B's "insert at position 12", written
a heartbeat earlier, now points one spot too far left. B's edit lands in the
wrong place. Nothing errors; the text is just quietly wrong, and it gets
wronger the more the two people type. **Positions are the problem: they
mean different things depending on what has already happened.** Every
collaborative editor has to solve exactly this.

There are two known solutions. One is operational transforms: a central
server receives every edit and *rewrites the positions* of each one against
the edits that arrived just before it. It works — but it needs one server
through which every edit passes in order. The other is a CRDT, which is
what Yjs is, and it removes the need for a central decider entirely. Why
that mattered here is ADR-02.

## How Yjs gets rid of positions

Every character, when created, gets a **permanent identity**: the pair
(author number, counter). The author number is a random id each browser
picks for itself (Yjs calls it the clientID); the counter just counts that
author's insertions. Your fifth keystroke might be character (7134, 5), and
it is character (7134, 5) forever, in every copy.

Edits never say "at position 12". They say **"insert after character
(7134, 5)"**. And that instruction means the same thing in every copy, no
matter what else has happened, because identities never shift the way
positions do.

Two people insert after the *same* character at the same moment? Both new
characters name the same neighbour, and the data structure has one fixed
rule for which comes first (compare the author numbers). Every copy applies
the same rule, so every copy picks the same order — they agree without
talking. Deleting works by *marking* a character as gone rather than
erasing its bookkeeping, so other people's edits that name it still make
sense. (That's a real trim flagged: those markers stay around, which is why
a Yjs document's history grows as people type.)

Put together: any copy can apply any set of edits, **in any order, and every
copy ends up with the same text.** That property has a name — CRDT
[conflict-free replicated data type] — and it is the property that lets two
Collab pods serve one session without ever coordinating about order.

## Follow one keystroke

1. You type `a`. **Your own copy updates first, instantly.** The editor
   redraws from your local copy — no network involved. This is why typing
   feels immediate even on terrible wifi.
2. Your copy emits an **update**: a few bytes naming the new character's
   identity, its neighbour, and its content. A delta, not the document.
3. The update goes up your WebSocket.
4. Collab applies it to the room's copy. The server is now current too.
5. Collab sends it to every *other* socket in the room, and publishes it on
   the session's Redis channel for sockets attached to the other pod.
6. Your partner's copy applies it; their editor redraws.

Every copy applied the same update. Nobody computed a merge; the structure
of the update *is* the merge.

## Where the text comes from: the seed

When a room is opened for a brand-new session, Collab builds the starting
text — the question's parts, numbered, with blank lines to answer in — as a
Yjs document, and here is the subtle part: **under one fixed author number
(0), on every pod.**

Why fixed? Suppose two pods each built the seed independently under their
own random author numbers. The two documents would *read* identically —
same visible text — but be made of entirely different characters with
different identities. An edit made against pod A's copy says "insert after
character (0, 41)" in A's world; pod B's copy has no character with that
identity, so B's copy parks the edit and waits forever. Both pods look
healthy, and the two sides silently stop merging. One fixed author number
makes the seed **byte-identical everywhere**, so every copy shares one
past and every future edit lands.

## Catching up: state vectors and sync steps

Copies fall behind — a browser reconnects, a second pod opens the room.
Catching up cheaply needs a way to say *how far you've got*.

A **state vector** is exactly that: a short summary reading "for author
7134 I have their edits up to counter 88, for author 9201 up to 14, …".
Sync is then two steps. **Step 1:** send your state vector — "here's what I
have." **Step 2 (the reply):** exactly the updates you're missing, nothing
more. A freshly connected browser has nothing, so step 2 hands it
everything — which is why the guide says the initial sync is "effectively
the whole document" for a new editor.

Between pods the same idea runs in a cruder form: a pod opening a room
another pod holds just asks, and the holder replies with the entire
document encoded as one update. A full state is self-contained — it merges
onto whatever the asker has, including nothing.

## Saving: what the snapshot is

A snapshot is the whole document encoded as one binary update and written
into a Postgres row for the session. Rebuilding a room is: load those
bytes, apply them to an empty Yjs document, done. Three moments trigger it:
every 30 seconds, when the last person disconnects, and before the process
shuts down — that last one is the reason a killed pod costs a reconnect and
not any edits.

One rule about what may enter the document: **the reference answer never
does** (ADR-06). The snapshot makes anything typed into the document
permanent and reloadable by both people — so the answer, which is released
only after both consent, must never become part of it.

## What the server does *not* do

Worth saying explicitly, because it's the surprise: Collab makes **no
editorial decisions**. It doesn't order edits, doesn't lock lines, doesn't
resolve conflicts. It applies updates to its copy, fans them out, and saves
snapshots — a relay with a good memory. All the merging intelligence lives
in the data structure itself, identically in every copy. That is what
"conflict-free" buys: the hard part moved out of the server and into the
maths of the document.

## Say it out loud (drills)

1. Why does typing feel instant even on bad wifi? *(Your local copy applies
   the edit first and the editor redraws from it; the network happens
   after.)*
2. Two people insert at the same spot in the same millisecond. Walk it.
   *(Both new characters name the same neighbour; the fixed rule — compare
   author numbers — orders them; every copy applies the same rule, so all
   copies converge without any coordination.)*
3. Why is the seed built under one fixed author number? *(So every pod's
   starting document is byte-identical. Independently seeded copies would
   read the same but be different characters — edits referencing one would
   never apply to the other, and merging would silently stop.)*
4. What is a state vector? *(A per-author summary of "I have this author's
   edits up to counter N" — sent as sync step 1, so the reply can contain
   exactly what's missing.)*
5. What exactly is in Postgres? *(Not text. A binary blob per session: the
   whole document encoded as one update, replaced at each snapshot.)*
6. Why must the reference answer stay out of the document? *(The document
   is snapshotted and reloadable by both people forever; the answer is
   released only by mutual consent, so it must never become part of the
   shared, persistent state. ADR-06.)*
