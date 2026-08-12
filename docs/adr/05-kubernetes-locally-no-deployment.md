# ADR-05 — Kubernetes locally, and no deployment at all

**Context:** the original plan was a hosted deployment, with Kubernetes as a side
detour.

**Decision:** invert it. The system runs on a local `kind` cluster and is not
deployed anywhere.

**Why:** the two claims worth making — no dropped requests during a rolling
update, and a killed pod costing a reconnect rather than any edits — need an
orchestrator and do not need a *hosted* one. A live URL, meanwhile, needs a
payment card the moment trial credits end.

**Rejected:** a hosted cluster, which bills by the hour whether or not anyone
visits. The deployment was designed and priced line by line first; that working
is [`../future/cost.md`](../future/cost.md).

**Tradeoff accepted:** nobody can look at this without cloning it and running
`make k8s-up`, and the measured results in
[`../system/09-running-it.md`](../system/09-running-it.md) carry that weight
instead.

If a change would reintroduce a cloud dependency, it is out of scope.
