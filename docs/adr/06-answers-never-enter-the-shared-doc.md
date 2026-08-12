# ADR-06 — Reference answers never enter the shared document

**Decision:** the answer text is released over HTTP to one browser, and never
written into the Yjs document.

**Why:** a Yjs document replicates to every peer, so putting the answer there
would hand it to both people the instant one of them consented.

**How the release is split:** Questions holds `reference_md` and has no idea who
is in a session. Matching knows exactly who consented and never stores the
answer. Matching asks for the text over the internal network only after both
participants are in `reveal_consents`, so neither service can leak it alone —
which is a property of the data each one holds rather than of a check either
could forget.

See [`../system/04-matching.md`](../system/04-matching.md) §7.
