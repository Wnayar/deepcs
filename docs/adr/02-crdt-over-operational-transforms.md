# ADR-02 — Yjs (CRDT) over operational transforms

**Decision:** the shared document is a CRDT, using Yjs.

**Why:** OT, the older approach and the one Google Docs uses, needs a central
server to order every edit. A CRDT converges without one, which is what lets two
Collab instances hold the same session and agree.

**Why not hand-roll the merge:** the interesting problem here is the sync
topology — cross-instance fanout, snapshots, reconnect — which is exactly the
part Yjs does *not* do for you. A hand-written merge would be subtly wrong in
ways that only surface under concurrent edits.

See [`../system/05-collab.md`](../system/05-collab.md).
